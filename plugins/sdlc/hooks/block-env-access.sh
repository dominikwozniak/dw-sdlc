#!/bin/bash
# Refuses reading, editing or writing an env file the config does not vouch for, by the order, globs
# and defaults in README.md#guards. A file tool is judged on its path, a Grep of a directory on what
# its glob reaches, a Bash command on its words: docs/contributing/bash-guard.md#paths-in-a-command. Not a security boundary.
set -uo pipefail
source "${BASH_SOURCE[0]%/*}/lib.sh"

guard_read_file_payload block-env-access.sh "Refused: no guard could judge this call; send it without the byte." "$@" || exit 0

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

# shell_dir_physical — where the shell stands, GUARD_SHELL_DIR, resolved through symlinks as CWD is.
shell_dir_physical() {
  if [[ "$GUARD_SHELL_DIR" == "$GUARD_CWD" ]]; then
    printf '%s' "$CWD"
  else
    (cd "$GUARD_SHELL_DIR" 2>/dev/null && pwd -P) || printf '%s' "$GUARD_SHELL_DIR"
  fi
}

# relative_to_root <path> <base> — REL, the path relative to FILE_ROOT: the repository root or, from a
# linked worktree, its main checkout's. Outside both REL is the basename and OUTSIDE is set, so only the
# `**/` entries apply. Globals, not stdout: a subshell would lose the flag.
REL=""
FILE_ROOT=""
OUTSIDE=0
relative_to_root() {
  local abs
  abs=$(physical "$(normalize "$(guard_absolute "$1" "$2")")")
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

# env_glob_matches <glob> <relative-path> — 0 when a config entry selects the file: a shell pattern on
# the whole path, `*` crossing `/`, a leading `**/` at any depth. `[` and `\` are literal, as in
# dw-sdlc/src/agentic-config.ts, whose settings backstop has no bracket expression.
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

# refused <path> — 0 when the path must be refused; REASON says why. A relative path is read from where
# the shell stands.
refused() {
  local path="$1" abs base
  is_env_name "$path" || return 1
  prepare
  base=$(shell_dir_physical)
  relative_to_root "$path" "$base"
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
  # A path is a name, never a pathspec: as one, `.env.*` matches the tracked .env.example.
  abs=$(guard_absolute "$path" "$base")
  git -C "$FILE_ROOT" --literal-pathspecs ls-files --error-unmatch -- "$abs" >/dev/null 2>&1 && return 1
  if git -C "$FILE_ROOT" --literal-pathspecs check-ignore -q -- "$abs" 2>/dev/null; then
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
# Each env file under the path that the glob matches gets the verdict a Read of it gets. Only a glob
# that could name one lists the tree: `*.ts` cannot, `.env*`, `*` or `.env.{local,production}` can.

# could_name_env <glob> — 0 when the glob's last segment, one `{a,b}` group expanded, is an env name
# or fits a probe name. Probes, not a listing: listing the ignored files costs every `*.ts` Grep a
# walk of node_modules.
ENV_PROBES=".env .envrc .env.local .env.development .env.dev .env.production .env.prod .env.staging .env.test .env.ci"
could_name_env() {
  local glob="$1" pat pre post alts alt name
  if [[ "$glob" == *"{"*"}"* ]]; then
    pre="${glob%%\{*}"
    post="${glob#*\}}"
    alts="${glob#*\{}"
    alts="${alts%%\}*}"
    while IFS= read -r alt; do
      could_name_env "$pre$alt$post" && return 0
    done <<<"${alts//,/$'\n'}"
    return 1
  fi
  pat="${glob##*/}"
  is_env_name "$pat" && return 0
  for name in $ENV_PROBES; do
    [[ "$name" == $pat ]] && return 0
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

# env_files <dir> — every env-named file under <dir>, relative to it: in a repository what git sees,
# tracked, untracked, then ignored; outside one, what find sees. The directory decides, not the cwd:
# a Grep may aim outside the repository it runs from.
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

# --- a Bash command ------------------------------------------------------------------------------

# env_paths <token> — the paths a word names, one a line, from where the shell stands: a glob the
# files it expands to; a word with a `:` both sides, `./.env:/app/.env` a volume's source and target,
# `HEAD:apps/.env` a path from the root unless `./`, `../` or `/` opens it.
env_paths() {
  local tok="$1" head path top
  case "$tok" in
    *[*?[]*)
      # The words lost their quotes: a quoted glob stays a word. `*`, `?` and `[…]` never match a
      # leading dot, so only a last segment opening with `.` can reach an env file.
      if [[ "$GUARD_COMMAND" == *"'$tok'"* || "$GUARD_COMMAND" == *"\"$tok\""* ]]; then
        printf '%s\n' "$tok"
        return 0
      fi
      [[ "${tok##*/}" == .* ]] || return 0
      [[ "$tok" == "~/"* ]] && tok="$HOME/${tok#"~/"}"
      (cd "$GUARD_SHELL_DIR" 2>/dev/null && compgen -G "$tok")
      return 0
      ;;
  esac
  if [[ "$tok" == *:* ]]; then
    head=${tok%%:*}
    path=${tok#*:}
    [[ "$tok" == :[0-3]:* ]] && path=${tok#:?:}
    is_env_name "$head" && printf '%s\n' "$head"
    if is_env_name "$path"; then
      case "$path" in
        ./* | ../* | /*) ;;
        *) top=$(git -C "$GUARD_SHELL_DIR" rev-parse --show-toplevel 2>/dev/null) && path="$top/$path" ;;
      esac
      printf '%s\n' "$path"
    fi
    return 0
  fi
  printf '%s\n' "$tok"
}

# The first line holds the command's own words, each line after it a substitution's or those of a
# quote handed to a shell, and the refusal says which. Each line starts at the payload's cwd. Every
# env name holds `.env` and a glob reaching one a `.` before its glob character.
DOT_GLOB='(^|[[:space:]/=:])\.[^[:space:]/]*[][*?]'
STRIPPED=""
[[ -n "$GUARD_COMMAND" ]] && STRIPPED=$(guard_strip_quoted "$GUARD_COMMAND")
if [[ "$STRIPPED" == *.env* || "$STRIPPED" =~ $DOT_GLOB ]]; then
  WHO="'$GUARD_COMMAND'"
  NOTE=""
  while IFS= read -r words; do
    GUARD_SHELL_DIR="$GUARD_CWD"
    GUARD_SCOPE_STACK=""
    GUARD_SCOPE_BACKTICK=0
    GUARD_DIR_STACK=""
    while IFS= read -r segment; do
      guard_scope_step "$segment" || continue
      while IFS= read -r token; do
        # Only a glob or a `<rev>:<path>` names a path other than itself, so only it costs a fork.
        if [[ "$token" != *[*?:]* && "$token" != *"["* ]]; then
          refused "$token" && refuse "$WHO" "$token" "$NOTE"
          continue
        fi
        while IFS= read -r path; do
          refused "$path" && refuse "$WHO" "$path" "$NOTE"
        done < <(env_paths "$token")
      done < <(guard_tokens "$segment")
    done < <(guard_scopes "$words")
    WHO="A command substitution or a quoted command in '$GUARD_COMMAND'"
    NOTE="The shell runs the quote handed to bash -c, eval or rtk run, and a \$(…) or a backtick span inside double quotes and an unquoted heredoc body too; to keep a substitution as text, escape it, single-quote it, or quote the heredoc's delimiter (<<'EOF')."
  done <<<"$STRIPPED"
fi

exit 0
