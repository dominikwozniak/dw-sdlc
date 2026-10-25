#!/bin/bash
# Refuses reading, editing or writing an env file the repository's config does not vouch for. The
# name finds the candidates — `.env`, `.env.*`, `.envrc` — and `guardrails.envFiles` in the resolved
# config gives the verdict, in this order: a path listed in `deny` is refused; one listed in `allow`
# passes; then `policy: deny` refuses the rest, and `policy: git` asks git — a tracked file passes,
# because a committed env file is secret-free by the repository's own rule, while an ignored or
# untracked one is refused, because that is where the secrets live. The lists are globs against the
# path relative to the repository root, `**/` meaning at any depth; the defaults are policy `git`,
# allow `**/.env.example`, `**/.env.sample`, `**/.env.template`, deny nothing. From a linked
# worktree its main checkout is the same repository: a path there is judged against the main
# checkout's root and git. A path outside the repository root, or outside any repository, is judged
# by its basename against the `**/` entries alone, and there is no git to vouch for it.
#
# Wired for the file tools (Read, Edit, Write, MultiEdit, NotebookEdit, Grep) on tool_input's path,
# for a Grep of a directory on the env files its `glob` reaches, and for Bash through bash-guard.sh
# on the command's tokens: heredoc bodies and quoted prose — a quoted span holding whitespace — are
# dropped first, so a commit message naming a file does not count, while a quoted path such as
# `cat ".env.local"` and the words of a `$(…)` or backtick substitution the shell runs, in double
# quotes or an unquoted heredoc body, still do. Guardrail against accidental secret exposure, not a
# security boundary.
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

guard_read_payload "$@" || exit 0

# is_env_name <path-or-token> — 0 for a candidate: basename .env, .env.*, .envrc.
is_env_name() {
  local base="${1##*/}"
  [[ "$base" =~ ^\.env(\..+)?$ || "$base" == ".envrc" ]]
}

REPO_ROOT=""
MAIN_ROOT=""
CWD=""
POLICY=""
ALLOW_LIST=""
DENY_LIST=""
REASON=""

# prepare — the repository, the real cwd and the policy, resolved once and only when a candidate
# showed up. The cwd is resolved through symlinks so a path under it lands under the repository root
# git reports.
prepare() {
  [[ -n "$POLICY" ]] && return 0
  REPO_ROOT=$(git -C "$GUARD_CWD" rev-parse --show-toplevel 2>/dev/null) || REPO_ROOT=""
  MAIN_ROOT=$(guard_worktree_main "$GUARD_CWD") || MAIN_ROOT=""
  CWD=$(cd "$GUARD_CWD" 2>/dev/null && pwd -P) || CWD="$GUARD_CWD"
  POLICY=git
  ALLOW_LIST=$'**/.env.example\n**/.env.sample\n**/.env.template'
  if guard_config_load "$GUARD_CWD"; then
    POLICY=$(guard_config_get '.guardrails.envFiles.policy')
    [[ -n "$POLICY" ]] || POLICY=git
    ALLOW_LIST=$(guard_config_get '.guardrails.envFiles.allow | .[]')
    DENY_LIST=$(guard_config_get '.guardrails.envFiles.deny | .[]')
  fi
}

# normalize <abs-path> — `.` and `..` segments folded, repeated slashes collapsed.
normalize() {
  local seg rest="$1" out=""
  while [[ -n "$rest" ]]; do
    seg="${rest%%/*}"
    if [[ "$rest" == */* ]]; then rest="${rest#*/}"; else rest=""; fi
    case "$seg" in
      '' | .) ;;
      ..) out="${out%/*}" ;;
      *) out="$out/$seg" ;;
    esac
  done
  printf '%s' "${out:-/}"
}

# physical <abs-path> — the directory part with its symlinks resolved, the way git reports the
# repository root; the file itself may not exist yet (a Write), so only the directory is resolved.
physical() {
  local dir="${1%/*}" base="${1##*/}" real
  real=$(cd "${dir:-/}" 2>/dev/null && pwd -P) || real="$dir"
  printf '%s/%s' "${real%/}" "$base"
}

# relative_to_root <path> — REL becomes the path relative to the repository root, the form the
# config lists, and FILE_ROOT that root. From a linked worktree its main checkout is the same
# repository under the same config, so a path there is relative to the main checkout. Outside the
# root, or outside a repository, REL is the basename and OUTSIDE is set: there only a `**/` entry
# applies, since a plain entry names a path in this repository and nothing else. Globals, not
# stdout: a subshell would lose the flag.
REL=""
FILE_ROOT=""
OUTSIDE=0
relative_to_root() {
  local abs
  abs=$(physical "$(normalize "$(guard_absolute "$1" "$CWD")")")
  OUTSIDE=0
  FILE_ROOT="$REPO_ROOT"
  if [[ -n "$REPO_ROOT" && "$abs" == "$REPO_ROOT/"* ]]; then
    REL="${abs#"$REPO_ROOT"/}"
  elif [[ -n "$MAIN_ROOT" && "$abs" == "$MAIN_ROOT/"* ]]; then
    FILE_ROOT="$MAIN_ROOT"
    REL="${abs#"$MAIN_ROOT"/}"
  else
    OUTSIDE=1
    REL="${abs##*/}"
  fi
}

# env_glob_matches <glob> <relative-path> — 0 when a config entry selects the file: a shell pattern
# against the whole relative path, `*` crossing `/`; with a leading `**/`, at any depth. `[` and `\`
# are literal, so the rule is the one dw-sdlc/src/agentic-config.ts applies for the settings backstop,
# where a bracket expression does not exist.
env_glob_matches() {
  local glob="$1" rel="$2"
  glob="${glob//\\/\\\\}"
  glob="${glob//\[/\\[}"
  if [[ "$glob" == "**/"* ]]; then
    glob="${glob#\*\*/}"
    [[ "$rel" == $glob || "$rel" == */$glob ]]
    return
  fi
  [[ "$rel" == $glob ]]
}

# listed <list> <relative-path> — 0 when an entry of the newline-separated list matches; MATCHED
# names it. For a path OUTSIDE the root only the `**/` entries are tried.
MATCHED=""
listed() {
  local glob
  MATCHED=""
  while IFS= read -r glob; do
    [[ -n "$glob" ]] || continue
    ((OUTSIDE)) && [[ "$glob" != "**/"* ]] && continue
    if env_glob_matches "$glob" "$2"; then
      MATCHED="$glob"
      return 0
    fi
  done <<<"$1"
  return 1
}

# refused <path> — 0 when the path must be refused; REASON says why.
refused() {
  local path="$1" abs
  is_env_name "$path" || return 1
  prepare
  relative_to_root "$path"
  if listed "$DENY_LIST" "$REL"; then
    REASON="'$MATCHED' in guardrails.envFiles.deny names it"
    return 0
  fi
  listed "$ALLOW_LIST" "$REL" && return 1
  if [[ "$POLICY" == "deny" ]]; then
    REASON="this repository refuses every env file outside guardrails.envFiles.allow (policy: deny)"
    return 0
  fi
  if [[ -z "$REPO_ROOT" ]]; then
    REASON="outside a repository only guardrails.envFiles.allow lets an env file through"
    return 0
  fi
  abs=$(guard_absolute "$path" "$CWD")
  git -C "$FILE_ROOT" ls-files --error-unmatch -- "$abs" >/dev/null 2>&1 && return 1
  if git -C "$FILE_ROOT" check-ignore -q -- "$abs" 2>/dev/null; then
    REASON="git ignores it"
  else
    REASON="git does not track it"
  fi
  return 0
}

# refuse <who> <path> [<note>]
refuse() {
  guard_block "$1 touches '$2' and $REASON. ${3:+$3 }guardrails.envFiles in .ai/agentic.config.json decides: a listed deny is refused, a listed allow passes, and for the rest a tracked env file is secret-free by the repository's own rule while anything else may hold secrets."
}

if [[ -n "$GUARD_FILE_PATH" ]]; then
  refused "$GUARD_FILE_PATH" && refuse "${GUARD_TOOL:-The tool}" "$GUARD_FILE_PATH"
fi

# --- a directory Grep with a glob ----------------------------------------------------------------
# A Grep of a directory opens every file its glob selects, so the glob is judged by the env files it
# reaches: each env-named file under the path that the glob matches gets the verdict a Read of it
# gets. Only a glob that could name one is worth listing the tree for — `*.ts` cannot, `.env*`, `*`
# or `.env.{local,production}` can.

# could_name_env <glob> — 0 when the glob's last segment can match an env file's name: it is one
# itself, or a pattern one of the probe names fits. A brace group is not a bash pattern, so there the
# literal text before it decides.
could_name_env() {
  local pat="${1##*/}" head name
  is_env_name "$pat" && return 0
  head="${pat%%\{*}"
  for name in .env .env.local .envrc; do
    [[ "$name" == $pat ]] && return 0
    [[ "$pat" == *"{"* && "$name" == "$head"* ]] && return 0
  done
  return 1
}

# glob_matches <glob> <relative-path> — 0 when ripgrep's glob selects the file: matched whole against
# the path, or against its name when the glob has no directory part, which a leading `**/` also is.
# One `{a,b}` group is expanded, by recursion, each alternative in turn.
glob_matches() {
  local glob="$1" rel="$2" base="${2##*/}" pre post alts alt
  if [[ "$glob" == *"{"*"}"* ]]; then
    pre="${glob%%\{*}"
    post="${glob#*\}}"
    alts="${glob#*\{}"
    alts="${alts%%\}*}"
    while IFS= read -r alt; do
      glob_matches "$pre$alt$post" "$rel" && return 0
    done <<<"${alts//,/$'\n'}"
    return 1
  fi
  [[ "$glob" == "**/"* ]] && glob="${glob#\*\*/}"
  [[ "$rel" == $glob ]] && return 0
  [[ "$glob" != */* && "$base" == $glob ]] && return 0
  return 1
}

# env_files <dir> — every env-named file under <dir>, relative to it: in a repository the ones git
# knows or sees, tracked and untracked, then ignored; outside one, what find sees. The directory
# decides, not the cwd: a Grep may aim outside the repository it runs from. The verdict on each is
# refused's.
env_files() {
  local f
  if ! git -C "$1" rev-parse --show-toplevel >/dev/null 2>&1; then
    find "$1" -type f \( -name '.env' -o -name '.env.*' -o -name '.envrc' \) 2>/dev/null |
      while IFS= read -r f; do printf '%s\n' "${f#"$1"/}"; done
    return 0
  fi
  {
    git -C "$1" ls-files -co --exclude-standard 2>/dev/null
    git -C "$1" ls-files -oi --exclude-standard 2>/dev/null
  } | while IFS= read -r f; do
    is_env_name "$f" && printf '%s\n' "$f"
  done
  return 0
}

if [[ "$GUARD_TOOL" == "Grep" && -n "$GUARD_GLOB" ]] && could_name_env "$GUARD_GLOB"; then
  DIR=$(guard_absolute "${GUARD_FILE_PATH:-$GUARD_CWD}")
  if [[ -d "$DIR" ]]; then
    prepare
    while IFS= read -r f; do
      glob_matches "$GUARD_GLOB" "$f" && refused "$DIR/$f" && refuse "Grep with glob '$GUARD_GLOB'" "$DIR/$f"
    done < <(env_files "$DIR")
  fi
fi

# The first line holds the command's own words, each line after it a substitution's or those of a
# quote handed to a shell: a markdown backtick span in a double-quoted `--body` is one, and the
# refusal says so. Every env name holds `.env`, so a text without one has no token to read.
STRIPPED=""
[[ -n "$GUARD_COMMAND" ]] && STRIPPED=$(guard_strip_quoted "$GUARD_COMMAND")
if [[ "$STRIPPED" == *.env* ]]; then
  WHO="'$GUARD_COMMAND'"
  NOTE=""
  while IFS= read -r words; do
    while IFS= read -r token; do
      refused "$token" && refuse "$WHO" "$token" "$NOTE"
    done < <(guard_tokens "$words")
    WHO="A command substitution or a quoted command in '$GUARD_COMMAND'"
    NOTE="The shell runs the quote handed to bash -c, eval or rtk run, and a \$(…) or a backtick span inside double quotes and an unquoted heredoc body too; to keep a substitution as text, escape it, single-quote it, or quote the heredoc's delimiter (<<'EOF')."
  done <<<"$STRIPPED"
fi

exit 0
