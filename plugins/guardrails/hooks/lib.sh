#!/bin/bash
# The library every guard in this plugin sources: `source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"`.
# One copy of what each guard used to carry itself — the payload reader, the heredoc strip, the
# quote masking, the wrapper boundary, the refusal — plus the config lookup that turns
# .ai/agentic.config.json and its local override into what a guard may act on.
#
# Guardrails against agent accidents, not a security boundary: a command can always be spelled in a
# way a text scan does not see. Fails open without jq — every reader returns 1 and the guard exits 0;
# the SessionStart report and the doctor are where a missing jq gets said out loud.

# Bytes, not characters: every scanner below splits only on ASCII — quotes, whitespace, separators —
# and a UTF-8 continuation byte is never ASCII, so the verdicts are the same. Under a UTF-8 locale
# bash finds `${s:i:1}` by counting characters from the start, and a 10 KB command took seconds.
export LC_ALL=C

GUARD_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GUARD_PLUGIN_ROOT="$(dirname "$GUARD_LIB_DIR")"
GUARD_SCHEMA="$GUARD_PLUGIN_ROOT/config/agentic.config.schema.json"
GUARD_COMMITTED_FILE=".ai/agentic.config.json"
GUARD_LOCAL_FILE=".ai/agentic.config.local.json"

GUARD_PAYLOAD=""
GUARD_EVENT=""
GUARD_TOOL=""
GUARD_CWD=""
GUARD_COMMAND=""
GUARD_FILE_PATH=""
GUARD_CONFIG=""
GUARD_CONFIG_ROOT=""
GUARD_CONFIG_PROBLEMS=""
GUARD_LAYER_JSON="null"

# --- the payload --------------------------------------------------------------------------------

# guard_read_payload [--bash-command <cwd>] — fills GUARD_EVENT, GUARD_TOOL, GUARD_CWD,
# GUARD_FILE_PATH, GUARD_GLOB (a Grep's file filter) and GUARD_COMMAND from the hook payload on
# stdin. On the dispatcher's fast path the stdin is the bare command it already extracted and the
# cwd travels as argv: the flag is argv too, never an environment variable, so a stray one cannot
# skip a check. Returns 1 when there is nothing to judge — no jq, empty or malformed stdin — so a
# guard writes `guard_read_payload "$@" || exit 0`.
guard_read_payload() {
  GUARD_FILE_PATH=""
  GUARD_GLOB=""
  if [[ "${1:-}" == "--bash-command" ]]; then
    GUARD_EVENT="PreToolUse"
    GUARD_TOOL="Bash"
    GUARD_CWD="${2:-$PWD}"
    GUARD_COMMAND=$(cat)
    [[ -n "$GUARD_COMMAND" ]]
    return
  fi
  command -v jq >/dev/null 2>&1 || return 1
  GUARD_PAYLOAD=$(cat)
  [[ -n "$GUARD_PAYLOAD" ]] || return 1
  # One jq call for the six fields, each closed by \001 so a multi-line command survives `read`.
  local fields field count=0
  fields=$(jq -j '[.hook_event_name // "", .tool_name // "", .cwd // "",
    (.tool_input.file_path // .tool_input.notebook_path // .tool_input.path // ""),
    (.tool_input.glob // ""),
    (.tool_input.command // "")] | map(tostring + "\u0001") | add' <<<"$GUARD_PAYLOAD" 2>/dev/null) || return 1
  while IFS= read -r -d $'\001' field; do
    case $count in
      0) GUARD_EVENT="$field" ;;
      1) GUARD_TOOL="$field" ;;
      2) GUARD_CWD="$field" ;;
      3) GUARD_FILE_PATH="$field" ;;
      4) GUARD_GLOB="$field" ;;
      5) GUARD_COMMAND="$field" ;;
    esac
    count=$((count + 1))
  done <<<"$fields"
  [[ $count -eq 6 ]] || return 1
  [[ -n "$GUARD_CWD" ]] || GUARD_CWD="$PWD"
  return 0
}

# --- the text — the scanners in lib-lines.sh, lib-text.sh, lib-live.sh and lib-words.sh -----------
source "$GUARD_LIB_DIR/lib-lines.sh"
source "$GUARD_LIB_DIR/lib-text.sh"
source "$GUARD_LIB_DIR/lib-live.sh"
source "$GUARD_LIB_DIR/lib-words.sh"

# --- git ----------------------------------------------------------------------------------------

# `git` and the global options git takes before the verb: `-C <path>` aims the same command at another
# repository — often a sibling worktree of the one being protected — and `-c <key=value>`,
# `--git-dir <path>`, `--no-pager` and the rest change nothing about what the verb destroys. An option
# argument is ONE word, a quoted span or a run of non-space characters, never `[^;&|]*`: nothing but
# options may sit between `git` and the verb, or `git commit -m "never reset --hard"` would match a
# reset arm. Compose as "${GUARD_BOUNDARY}${GUARD_GIT} push".
GUARD_GIT_ARG="(\"[^\"]*\"|'[^']*'|[^[:space:];&|]+)"
GUARD_GIT="git( +(-[Cc] +${GUARD_GIT_ARG}|--(git-dir|work-tree|namespace)( +|=)${GUARD_GIT_ARG}|--[a-z][a-z-]*(=[^[:space:];&|]*)?|-[pP]))*"

# guard_segments <scan> — the masked scan split at real separators, parentheses and backticks (the
# masked ones inside quotes stay), one non-empty segment per line; `&&` and `||` leave empty segments,
# dropped here.
guard_segments() {
  printf '%s\n' "$1" | tr ';&|()`' '\n\n\n\n\n\n' | sed -E '/^[[:space:]]*$/d'
}

# guard_pipelines <scan> — the masked scan split into pipelines, one non-empty per line: at `;`, `&&`,
# `||`, a lone `&` and a newline, never at `|`. The `&` of a redirect (`2>&1`, `&>`, `|&`) becomes
# \003, no separator. It stays \003: bash 5.2 reads a `&` in a `${s//…/…}` replacement as the match,
# so putting it back would differ by shell.
guard_pipelines() {
  local s="$1"
  s="${s//||/$'\n'}"
  s="${s//&&/$'\n'}"
  s="${s//;/$'\n'}"
  s="${s//>&/>$'\003'}"
  s="${s//<&/<$'\003'}"
  s="${s//|&/|$'\003'}"
  s="${s//&>/$'\003'>}"
  s="${s//&/$'\n'}"
  printf '%s\n' "$s" | sed -E '/^[[:space:]]*$/d'
}

# guard_absolute <path> [<base>] — the path made absolute against <base>, GUARD_CWD by default: a
# relative path is the session's, not the hook process's.
guard_absolute() {
  case "$1" in
    /*) printf '%s' "$1" ;;
    *) printf '%s/%s' "${2:-$GUARD_CWD}" "$1" ;;
  esac
}

# guard_located <path> — the repository a `-C`, `--git-dir` or `--work-tree` points at, against cwd.
guard_located() {
  case "$1" in
    /*) printf '%s' "$1" ;;
    "") printf '%s' "$GUARD_CWD" ;;
    *) printf '%s/%s' "$GUARD_CWD" "$1" ;;
  esac
}

GUARD_PUSH_LOC=""
GUARD_PUSH_BARE=0
GUARD_PUSH_LEASE=0
GUARD_PUSH_DELETE=0
GUARD_PUSH_MIRROR=0
GUARD_PUSH_ALL=0
GUARD_PUSH_TAGS=0
GUARD_PUSH_DRY=0
GUARD_PUSH_REMOTE=""
GUARD_PUSH_REFSPECS=""
GUARD_GIT_VERB=""
WORD_INDEX=0

# guard_git_verb <segment> — words in WORDS with the wrappers off; sets GUARD_GIT_VERB, GUARD_PUSH_LOC
# (where git runs) and WORD_INDEX (the first word after the verb). Returns 1 when the segment is not a
# git command. Globals, not stdout: a caller capturing stdout would run this in a subshell and lose
# the words.
guard_git_verb() {
  local word i n
  GUARD_PUSH_LOC="$GUARD_CWD"
  GUARD_GIT_VERB=""
  WORDS=()
  while IFS= read -r word; do WORDS+=("$word"); done < <(guard_words "$1")
  guard_unwrap_words
  n=${#WORDS[@]}
  [[ $n -gt 0 && "${WORDS[0]}" == "git" ]] || return 1
  i=1
  while ((i < n)); do
    word="${WORDS[$i]}"
    case "$word" in
      -C)
        i=$((i + 1))
        GUARD_PUSH_LOC=$(guard_located "${WORDS[$i]:-}")
        ;;
      -C?*) GUARD_PUSH_LOC=$(guard_located "${word#-C}") ;;
      --git-dir=* | --work-tree=*) GUARD_PUSH_LOC=$(guard_located "${word#*=}") ;;
      -c | --git-dir | --work-tree | --namespace | --exec-path) i=$((i + 1)) ;;
      -*) ;;
      *)
        WORD_INDEX=$((i + 1))
        GUARD_GIT_VERB="$word"
        return 0
        ;;
    esac
    i=$((i + 1))
  done
  return 1
}

# guard_parse_push <segment> — 0 when the segment is a `git … push` once the wrappers are off. Fills
# GUARD_PUSH_LOC (where git runs), GUARD_PUSH_BARE (--force, -f, +refspec), GUARD_PUSH_LEASE
# (--force-with-lease, --force-if-includes), GUARD_PUSH_DELETE (--delete, -d, a `:branch` refspec
# with no source; a bare `:` is the matching refspec and deletes nothing), GUARD_PUSH_MIRROR
# (--mirror, which force-updates and deletes every remote ref), GUARD_PUSH_ALL (--all, --branches:
# every local branch), GUARD_PUSH_TAGS (--tags: no branch unless a refspec names one), GUARD_PUSH_DRY
# (--dry-run, -n: nothing is written), GUARD_PUSH_REMOTE and GUARD_PUSH_REFSPECS, one per line with a
# leading + stripped.
guard_parse_push() {
  local word i n
  GUARD_PUSH_BARE=0
  GUARD_PUSH_LEASE=0
  GUARD_PUSH_DELETE=0
  GUARD_PUSH_MIRROR=0
  GUARD_PUSH_ALL=0
  GUARD_PUSH_TAGS=0
  GUARD_PUSH_DRY=0
  GUARD_PUSH_REMOTE=""
  GUARD_PUSH_REFSPECS=""
  guard_git_verb "$1" || return 1
  [[ "$GUARD_GIT_VERB" == "push" ]] || return 1
  n=${#WORDS[@]}
  i=$WORD_INDEX
  while ((i < n)); do
    word="${WORDS[$i]}"
    case "$word" in
      --force) GUARD_PUSH_BARE=1 ;;
      --force-with-lease | --force-with-lease=* | --force-if-includes) GUARD_PUSH_LEASE=1 ;;
      --delete | -d) GUARD_PUSH_DELETE=1 ;;
      --mirror) GUARD_PUSH_MIRROR=1 ;;
      --all | --branches) GUARD_PUSH_ALL=1 ;;
      --tags) GUARD_PUSH_TAGS=1 ;;
      --dry-run) GUARD_PUSH_DRY=1 ;;
      --repo=*) GUARD_PUSH_REMOTE="${word#*=}" ;;
      --repo)
        i=$((i + 1))
        GUARD_PUSH_REMOTE="${WORDS[$i]:-}"
        ;;
      -o | --push-option | --receive-pack | --exec) i=$((i + 1)) ;;
      --*) ;;
      -*f*) GUARD_PUSH_BARE=1 ;;
      -*n*) GUARD_PUSH_DRY=1 ;;
      -*) ;;
      +*)
        GUARD_PUSH_BARE=1
        [[ "$word" == +:?* ]] && GUARD_PUSH_DELETE=1
        GUARD_PUSH_REFSPECS+="${GUARD_PUSH_REFSPECS:+$'\n'}${word#+}"
        ;;
      *)
        if [[ -z "$GUARD_PUSH_REMOTE" ]]; then
          GUARD_PUSH_REMOTE="$word"
        else
          [[ "$word" == :?* ]] && GUARD_PUSH_DELETE=1
          GUARD_PUSH_REFSPECS+="${GUARD_PUSH_REFSPECS:+$'\n'}$word"
        fi
        ;;
    esac
    i=$((i + 1))
  done
  return 0
}

# guard_push_matching — the branches the matching refspec `:` writes to: every local branch the
# remote has too, read from its remote-tracking refs. A remote with none, such as a URL, gives no way
# to tell, so every local branch counts.
guard_push_matching() {
  local remote="${GUARD_PUSH_REMOTE:-origin}" heads tracked branch
  heads=$(git -C "$GUARD_PUSH_LOC" for-each-ref --format='%(refname:short)' refs/heads/ 2>/dev/null)
  tracked=$(git -C "$GUARD_PUSH_LOC" for-each-ref --format='%(refname)' "refs/remotes/$remote/" 2>/dev/null)
  while IFS= read -r branch; do
    [[ -n "$branch" ]] || continue
    if [[ -z "$tracked" || $'\n'"$tracked"$'\n' == *$'\n'"refs/remotes/$remote/$branch"$'\n'* ]]; then
      printf '%s\n' "$branch"
    fi
  done <<<"$heads"
}

# guard_push_targets — the branches the parsed push writes to, one per line: every local branch of
# GUARD_PUSH_LOC for --all, else the destination side of each refspec (the matching refspec `:` by
# guard_push_matching), or the current branch when none names one. Returns 1 when those branches
# cannot be read.
guard_push_targets() {
  local spec target specs="$GUARD_PUSH_REFSPECS"
  if ((GUARD_PUSH_ALL)); then
    git -C "$GUARD_PUSH_LOC" for-each-ref --format='%(refname:short)' refs/heads/ 2>/dev/null
    return
  fi
  [[ -n "$specs" ]] || specs="HEAD"
  while IFS= read -r spec; do
    if [[ "$spec" == ":" ]]; then
      guard_push_matching
      continue
    fi
    target="${spec##*:}"
    target="${target#refs/heads/}"
    if [[ "$target" == "HEAD" ]]; then
      target=$(git -C "$GUARD_PUSH_LOC" symbolic-ref --short -q HEAD 2>/dev/null) || return 1
    fi
    printf '%s\n' "$target"
  done <<<"$specs"
}

# guard_protected <branch> — 0 when the resolved config lists it in guardrails.protectedBranches.
guard_protected() {
  [[ -n "$(jq -r --arg b "$1" '.guardrails.protectedBranches[] | select(. == $b)' <<<"$GUARD_CONFIG")" ]]
}

# guard_worktree_main <cwd> — prints the main checkout of the linked worktree holding <cwd>; returns 1
# for a main checkout or no repository. A linked worktree's --git-dir differs from --git-common-dir.
guard_worktree_main() {
  local git_dir common_dir
  git_dir=$(git -C "$1" rev-parse --path-format=absolute --git-dir 2>/dev/null) || return 1
  common_dir=$(git -C "$1" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || return 1
  [[ "$git_dir" != "$common_dir" ]] || return 1
  dirname "$common_dir"
}

# guard_subject_by_git <subject> — 0 for git's own machine-written subjects, which no project pattern
# or trailer rule describes.
guard_subject_by_git() {
  case "$1" in
    "Merge "* | "Revert "* | "fixup! "* | "squash! "* | "amend! "*) return 0 ;;
  esac
  return 1
}

# guard_subject_fits <subject> <pattern> — 0 when the subject matches the POSIX ERE or git wrote it.
# An empty pattern fits all.
guard_subject_fits() {
  guard_subject_by_git "$1" && return 0
  [[ -z "$2" ]] || printf '%s' "$1" | grep -qE "$2"
}

# --- the verdicts -------------------------------------------------------------------------------

# guard_block <message> — exit 2 stops the call before permission rules run, so it beats an allow
# rule, and the text reaches the model, which self-corrects. Report the command the user typed,
# never the masked scan.
guard_block() {
  printf 'BLOCKED: %s\n' "$1" >&2
  printf 'Refused by the guardrails plugin. If this is genuinely needed, the user runs it.\n' >&2
  exit 2
}

# guard_ask <reason> — a permission prompt instead of a refusal; in auto mode it forces one too.
guard_ask() {
  jq -cn --arg r "$1" \
    '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason: $r}}'
  exit 0
}

# --- the config ---------------------------------------------------------------------------------

# guard_config_load <cwd> — resolves the config of the repository holding <cwd>: local over
# committed over inferred, as scripts/agentic-config.ts does (its tests are the reference and run
# this too). Sets GUARD_CONFIG (the effective object as one line of JSON), GUARD_CONFIG_ROOT and
# GUARD_CONFIG_PROBLEMS, one `file: path: message` per line. Any problem drops that layer whole and
# puts `guardrails` on the strictest set. Returns 1 without jq.
guard_config_load() {
  local cwd="$1" root inferred committed local_layer resolved loosened
  command -v jq >/dev/null 2>&1 || return 1
  GUARD_CONFIG_PROBLEMS=""
  root=$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null) || root="$cwd"
  GUARD_CONFIG_ROOT="$root"
  inferred=$(guard_config_infer "$root")
  guard_config_layer "$root" "$GUARD_COMMITTED_FILE"
  committed="$GUARD_LAYER_JSON"
  guard_config_layer "$root" "$GUARD_LOCAL_FILE"
  local_layer="$GUARD_LAYER_JSON"
  resolved=$(jq -cn -L "$GUARD_LIB_DIR" --argjson inferred "$inferred" --argjson committed "$committed" \
    --argjson local "$local_layer" 'include "config"; resolve($inferred; $committed; $local)')
  loosened=$(jq -r '.problems[] | "\(.file): \(.path): \(.message)"' <<<"$resolved")
  [[ -n "$loosened" ]] && GUARD_CONFIG_PROBLEMS+="${GUARD_CONFIG_PROBLEMS:+$'\n'}$loosened"
  if [[ -n "$GUARD_CONFIG_PROBLEMS" ]]; then
    GUARD_CONFIG=$(jq -c -L "$GUARD_LIB_DIR" 'include "config"; .config | .guardrails = strictest' <<<"$resolved")
  else
    GUARD_CONFIG=$(jq -c '.config' <<<"$resolved")
  fi
  return 0
}

# guard_config_get <jq-filter> — one value out of the resolved config, empty when unset or null.
guard_config_get() {
  jq -r "$1 // empty" <<<"$GUARD_CONFIG"
}

# guard_config_infer <root> — the bottom layer on stdout: the conventional commit preset, and the Node
# package manager from the lockfile.
guard_config_infer() {
  local root="$1" node=""
  if [[ -f "$root/pnpm-lock.yaml" ]]; then
    node=pnpm
  elif [[ -f "$root/package-lock.json" ]]; then
    node=npm
  elif [[ -f "$root/yarn.lock" ]]; then
    node=yarn
  elif [[ -f "$root/bun.lock" || -f "$root/bun.lockb" ]]; then
    node=bun
  fi
  jq -cn --arg node "$node" '{
    commit: {convention: "conventional"},
    packageManagers: (if $node != "" then {node: $node} else {} end)
  }'
}

# guard_config_layer <root> <file> — GUARD_LAYER_JSON becomes the document, or null when the file is
# absent or invalid; an invalid one adds its problems to GUARD_CONFIG_PROBLEMS.
guard_config_layer() {
  local path="$1/$2" problems line
  GUARD_LAYER_JSON="null"
  [[ -f "$path" ]] || return 0
  if ! jq empty "$path" >/dev/null 2>&1; then
    guard_config_problem "$2" "" "not JSON: $(jq empty "$path" 2>&1 | head -n1)"
    return 0
  fi
  problems=$(jq -r -L "$GUARD_LIB_DIR" --slurpfile schema "$GUARD_SCHEMA" \
    'include "schema"; validate($schema[0])[] | "\(.path)\u0001\(.message)"' "$path")
  if [[ -n "$problems" ]]; then
    while IFS= read -r line; do
      guard_config_problem "$2" "${line%%$'\001'*}" "${line#*$'\001'}"
    done <<<"$problems"
    return 0
  fi
  GUARD_LAYER_JSON=$(jq -c . "$path")
}

# guard_config_problem <file> <path> <message> — appends one line to GUARD_CONFIG_PROBLEMS.
guard_config_problem() {
  local line
  if [[ -n "$2" ]]; then
    line="$1: $2: $3"
  else
    line="$1: $3"
  fi
  GUARD_CONFIG_PROBLEMS+="${GUARD_CONFIG_PROBLEMS:+$'\n'}$line"
}
