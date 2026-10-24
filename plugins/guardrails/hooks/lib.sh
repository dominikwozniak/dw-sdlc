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
# Where the shell stands at the segment being judged: the payload's cwd, moved by a literal `cd`.
GUARD_SHELL_DIR=""
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
    GUARD_SHELL_DIR="$GUARD_CWD"
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
  GUARD_SHELL_DIR="$GUARD_CWD"
  return 0
}

# --- the text — the scanners in lib-lines.sh, lib-text.sh, lib-live.sh, lib-words.sh, lib-git.sh ---
source "$GUARD_LIB_DIR/lib-lines.sh"
source "$GUARD_LIB_DIR/lib-text.sh"
source "$GUARD_LIB_DIR/lib-live.sh"
source "$GUARD_LIB_DIR/lib-words.sh"
source "$GUARD_LIB_DIR/lib-git.sh"

# --- segments and scopes ------------------------------------------------------------------------

# guard_segments <scan> — the masked scan split at real separators, parentheses and backticks (the
# masked ones inside quotes stay), one non-empty segment per line; `&&` and `||` leave empty segments,
# dropped here.
guard_segments() {
  printf '%s\n' "$1" | tr ';&|()`' '\n\n\n\n\n\n' | sed -E '/^[[:space:]]*$/d'
}

# guard_pipelines <scan> — the masked scan split into pipelines, one non-empty per line: at `;`, `&&`,
# `||`, a lone `&` and a newline, never at `|`. The `&` of a redirect (`2>&1`, `&>`, `|&`) becomes
# \003, no separator. sed splits, not `${s//…/…}`, which bash 3.2 makes rescan the text for every
# match: seconds on a command of a few thousand separators. A newline in a sed replacement is a
# backslash and a newline, for BSD and GNU sed alike.
guard_pipelines() {
  printf '%s\n' "$1" |
    sed -E -e $'s/[|][|]|&&|;/\\\n/g' -e $'s/>&/>\003/g' -e $'s/<&/<\003/g' -e $'s/[|]&/|\003/g' \
      -e $'s/&>/\003>/g' -e $'s/&/\\\n/g' |
    sed -E '/^[[:space:]]*$/d'
}

# guard_scopes <scan> — guard_segments that keeps the subshells: a line of \001 and `(`, `)` or a
# backtick stands where one opens or closes, so a `cd` inside one ends with it. Split by sed, as
# guard_pipelines is.
guard_scopes() {
  printf '%s\n' "$1" |
    sed -e $'s/[(]/\\\n\001(\\\n/g' -e $'s/[)]/\\\n\001)\\\n/g' -e $'s/`/\\\n\001`\\\n/g' |
    tr ';&|' '\n\n\n' | sed -E '/^[[:space:]]*$/d'
}

# guard_absolute <path> [<base>] — the path made absolute against <base>, GUARD_CWD by default: a
# relative path is the session's, not the hook process's.
guard_absolute() {
  case "$1" in
    /*) printf '%s' "$1" ;;
    *) printf '%s/%s' "${2:-$GUARD_CWD}" "$1" ;;
  esac
}

# guard_located <path> — the repository a `-C`, `--git-dir` or `--work-tree` points at, against where
# the shell stands. A path computed at runtime cannot be followed, so it is where the shell stands.
guard_located() {
  local bt='`'
  case "$1" in
    /*) printf '%s' "$1" ;;
    "" | *'$'* | *"$bt"*) printf '%s' "${GUARD_SHELL_DIR:-$GUARD_CWD}" ;;
    *) printf '%s/%s' "${GUARD_SHELL_DIR:-$GUARD_CWD}" "$1" ;;
  esac
}

# guard_cd_dir <word> — where `cd <word>` leaves the shell, from GUARD_SHELL_DIR: no word is the home
# directory. A word computed at runtime, `cd -` and a directory that is not there give the payload's
# cwd back, since the guard cannot follow them.
guard_cd_dir() {
  local dir bt='`'
  case "$1" in
    "" | "~") dir="$HOME" ;;
    "~/"*) dir="$HOME/${1#"~/"}" ;;
    - | *'$'* | *"$bt"*) dir="$GUARD_CWD" ;;
    *) dir=$(guard_absolute "$1" "${GUARD_SHELL_DIR:-$GUARD_CWD}") ;;
  esac
  [[ -d "$dir" ]] || dir="$GUARD_CWD"
  printf '%s' "$dir"
}

GUARD_SCOPE_STACK=""
GUARD_SCOPE_BACKTICK=0

# guard_scope_step <line> — one line of guard_scopes against GUARD_SHELL_DIR: a subshell opening saves
# it, its end restores it, a `cd` (words in WORDS) moves it. Returns 1 for a scope line, which holds
# no command.
guard_scope_step() {
  local word bt_line=$'\001`'
  case "$1" in
    "$bt_line")
      if ((GUARD_SCOPE_BACKTICK)); then
        GUARD_SCOPE_BACKTICK=0
        guard_scope_step $'\001)'
      else
        GUARD_SCOPE_BACKTICK=1
        guard_scope_step $'\001('
      fi
      return 1
      ;;
    $'\001(')
      GUARD_SCOPE_STACK+=$'\n'"$GUARD_SHELL_DIR"
      return 1
      ;;
    $'\001)')
      if [[ -n "$GUARD_SCOPE_STACK" ]]; then
        GUARD_SHELL_DIR="${GUARD_SCOPE_STACK##*$'\n'}"
        GUARD_SCOPE_STACK="${GUARD_SCOPE_STACK%$'\n'*}"
      fi
      return 1
      ;;
  esac
  guard_read_words "$1"
  guard_unwrap_words
  if [[ ${#WORDS[@]} -gt 0 && "${WORDS[0]}" == cd ]]; then
    # `cd -P dir`, `cd -L dir`: the options name no directory.
    word=""
    for word in "${WORDS[@]:1}"; do
      [[ "$word" == -[LPe@]* ]] || break
      word=""
    done
    GUARD_SHELL_DIR=$(guard_cd_dir "$word")
  fi
  return 0
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
# this too). A linked worktree reads a layer it lacks from its main checkout, where a repository that
# keeps `.ai/` out of git has the only copy. Sets GUARD_CONFIG (the effective object as one line of
# JSON), GUARD_CONFIG_ROOT (the worktree's own top level) and GUARD_CONFIG_PROBLEMS, one
# `file: path: message` per line. Any problem drops that layer whole and puts `guardrails` on the
# strictest set. Returns 1 without jq.
guard_config_load() {
  local cwd="$1" root git_dir common_dir main="" paths inferred committed local_layer resolved loosened
  command -v jq >/dev/null 2>&1 || return 1
  GUARD_CONFIG_PROBLEMS=""
  # One git call for the three paths; a linked worktree's git dir differs from the common one.
  if paths=$(git -C "$cwd" rev-parse --path-format=absolute --show-toplevel --git-dir --git-common-dir 2>/dev/null); then
    { IFS= read -r root && IFS= read -r git_dir && IFS= read -r common_dir; } <<<"$paths"
    [[ "$git_dir" != "$common_dir" ]] && main=$(dirname "$common_dir")
  else
    root="$cwd"
  fi
  GUARD_CONFIG_ROOT="$root"
  inferred=$(guard_config_infer "$root")
  guard_config_layer "$root" "$main" "$GUARD_COMMITTED_FILE"
  committed="$GUARD_LAYER_JSON"
  guard_config_layer "$root" "$main" "$GUARD_LOCAL_FILE"
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

# guard_config_layer <root> <main> <file> — GUARD_LAYER_JSON becomes the document at <root>, else at
# <main> when it is set, or null when the file is absent or invalid; an invalid one adds its problems
# to GUARD_CONFIG_PROBLEMS.
guard_config_layer() {
  local path="$1/$3" problems line
  GUARD_LAYER_JSON="null"
  [[ ! -f "$path" && -n "$2" ]] && path="$2/$3"
  [[ -f "$path" ]] || return 0
  if ! jq empty "$path" >/dev/null 2>&1; then
    guard_config_problem "$3" "" "not JSON: $(jq empty "$path" 2>&1 | head -n1)"
    return 0
  fi
  problems=$(jq -r -L "$GUARD_LIB_DIR" --slurpfile schema "$GUARD_SCHEMA" \
    'include "schema"; validate($schema[0])[] | "\(.path)\u0001\(.message)"' "$path")
  if [[ -n "$problems" ]]; then
    while IFS= read -r line; do
      guard_config_problem "$3" "${line%%$'\001'*}" "${line#*$'\001'}"
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
