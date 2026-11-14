#!/bin/bash
# The library every guard sources: docs/contributing/plugin-internals.md#layout. Not a security
# boundary: a command can always be spelled so a text scan misses it. Without jq every reader returns
# 1 and the guard exits 0; the SessionStart report and the doctor say so.

# Bytes, not characters: every scanner below splits only on ASCII — quotes, whitespace, separators —
# and a UTF-8 continuation byte is never ASCII, so the verdicts are the same. Under a UTF-8 locale
# bash finds `${s:i:1}` by counting characters from the start, and a 10 KB command took seconds.
export LC_ALL=C

GUARD_LIB_DIR="$(cd "${BASH_SOURCE[0]%/*}" && pwd)"
GUARD_PLUGIN_ROOT="${GUARD_LIB_DIR%/*}"
GUARD_SCHEMA="$GUARD_PLUGIN_ROOT/dw-sdlc/config/agentic.config.schema.json"
GUARD_COMMITTED_FILE=".ai/agentic.config.json"
GUARD_LOCAL_FILE=".ai/agentic.config.local.json"

GUARD_UNREADABLE=3
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

# guard_read_payload [--bash-command <cwd>] — the GUARD_* fields, GUARD_GLOB a Grep's file filter,
# from the payload on stdin; with the flag, stdin is the bare command, the dispatcher's fast path.
# Returns 1 on no jq or empty stdin, GUARD_UNREADABLE on a payload jq cannot read, \001 included.
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
    (.tool_input.command // "")] | map(tostring + "\u0001") | add' <<<"$GUARD_PAYLOAD" 2>/dev/null) || return $GUARD_UNREADABLE
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
  [[ $count -eq 6 ]] || return $GUARD_UNREADABLE
  [[ -n "$GUARD_CWD" ]] || GUARD_CWD="$PWD"
  GUARD_SHELL_DIR="$GUARD_CWD"
  return 0
}

# guard_read_file_payload <hook> <consequence> [args…] — guard_read_payload for a file-tool guard: a
# payload jq cannot read, \001 included, exits 2 with a message saying why, then <consequence>; no jq
# or empty stdin returns 1.
guard_read_file_payload() {
  local hook="$1" consequence="$2" rc
  shift 2
  guard_read_payload "$@"
  rc=$?
  if [[ $rc -eq $GUARD_UNREADABLE ]]; then
    echo "$hook: the payload cannot be read: it is not JSON, or a field holds U+0001, the byte the reader splits on. $consequence" >&2
    exit 2
  fi
  return $rc
}

# --- the text — the scanners in the files below --------------------------------------------------
source "$GUARD_LIB_DIR/lib-lines.sh"
source "$GUARD_LIB_DIR/lib-text.sh"
source "$GUARD_LIB_DIR/lib-live.sh"
source "$GUARD_LIB_DIR/lib-mask.sh"
source "$GUARD_LIB_DIR/lib-words.sh"
source "$GUARD_LIB_DIR/lib-git.sh"

# --- segments and scopes ------------------------------------------------------------------------

# guard_segments <scan> — guard_scopes without its scope lines: one command per line, a substitution
# one word of the command around it and its body commands of their own.
guard_segments() {
  guard_scopes "$1" | sed -e $'/^\001/d'
}

# guard_pipelines <scan> — the masked scan split into pipelines, one per line, at `;`, `&&`, `||`, a
# lone `&` and a newline; a redirect's `&` (`2>&1`, `&>`, `|&`) becomes \003. sed splits, since bash
# 3.2 rescans the text on each `${s//…/…}` match: seconds on a few thousand separators.
guard_pipelines() {
  printf '%s\n' "$1" |
    sed -E -e $'s/[|][|]|&&|;/\\\n/g' -e $'s/>&/>\003/g' -e $'s/<&/<\003/g' -e $'s/[|]&/|\003/g' \
      -e $'s/&>/\003>/g' -e $'s/&/\\\n/g' |
    sed -E '/^[[:space:]]*$/d'
}

# guard_scopes <scan> — the masked scan one command a line, a line of \001 and `(` or `)` where a
# scope opens or closes, each substitution lifted first: docs/contributing/bash-guard.md#commands-and-scopes. A redirect's
# `&` becomes \003 and cuts nothing. Split by sed, as guard_pipelines is.
guard_scopes() {
  local scan="$1" bt='`'
  if [[ "$scan" == *'$('* || "$scan" == *"$bt"* ]]; then
    guard_lift_substitutions "$scan"
    scan=$GUARD_LIFTED
  fi
  printf '%s\n' "$scan" |
    sed -e $'s/>&/>\003/g' -e $'s/<&/<\003/g' -e $'s/&>/\003>/g' \
      -e $'s/[(\004]/\\\n\001(\\\n/g' -e $'s/[)\005]/\\\n\001)\\\n/g' -e $'s/`/\\\n\001`\\\n/g' |
    tr ';&|' '\n\n\n' | sed -E '/^[[:space:]]*$/d'
}

# guard_lift_substitutions <scan> — GUARD_LIFTED, each `$(…)` and backtick span made the word `$_` and
# its body put between \004 and \005 before its command; unbalanced, the scan as typed. Read through a
# window, as guard_qw_walk reads, so a long scan costs no copy of itself per step.
GUARD_LIFTED=""
guard_lift_substitutions() {
  local src="$1" total=${#1} pos=0 win run ch len out="" buf="" seg=0 kind="" paren=0 depth=0 body
  local bt='`'
  local -a bufs=() segs=() kinds=() parens=()
  win=${src:0:GUARD_QW_WINDOW}
  while :; do
    ((${#win} < 2 && pos + ${#win} < total)) && win=${src:pos:GUARD_QW_WINDOW}
    [[ -n "$win" ]] || break
    run=${win%%[\$\`\(\)\\\;\&\|$'\n']*}
    if [[ -n "$run" ]]; then
      buf+=$run
      win=${win:${#run}}
      pos=$((pos + ${#run}))
      continue
    fi
    ch=${win:0:1}
    len=1
    case "$ch" in
      '\')
        len=2
        buf+=${win:0:2}
        ;;
      '$')
        case "${win:1:1}" in
          '$')
            len=2
            buf+='$$'
            ;;
          '(')
            len=2
            guard_lift_open U
            ;;
          *) buf+='$' ;;
        esac
        ;;
      '`' | ')')
        if [[ "$ch" == ")" && ("$kind" != U || $paren -gt 0) ]]; then
          paren=$((paren - 1))
          buf+=')'
          seg=${#buf}
        elif [[ "$ch" == ")" ]] && guard_in_case "$buf"; then
          # A case pattern's `)`: the arm's command starts after it.
          buf+=';'
          seg=${#buf}
        elif [[ "$ch" == "$bt" && "$kind" != B ]]; then
          guard_lift_open B
        else
          body=$buf
          depth=$((depth - 1))
          buf=${bufs[depth]} seg=${segs[depth]} kind=${kinds[depth]} paren=${parens[depth]}
          buf="${buf:0:seg}"$'\004'"$body"$'\005'"${buf:seg}"'$_'
          seg=$((seg + ${#body} + 2))
        fi
        ;;
      *)
        # `(`, a separator or a newline: a command starts after it.
        [[ "$ch" == "(" ]] && paren=$((paren + 1))
        buf+=$ch
        seg=${#buf}
        ;;
    esac
    win=${win:len}
    pos=$((pos + len))
    # At the top level nothing is lifted to before a command that is done.
    if ((depth == 0 && seg == ${#buf})); then
      out+=$buf
      buf="" seg=0
    fi
  done
  if ((depth > 0)); then
    GUARD_LIFTED=$1
  else
    GUARD_LIFTED=$out$buf
  fi
}

# guard_lift_open <kind> — guard_lift_substitutions opens a substitution of <kind>, U or B: the
# enclosing one's state is saved on its stacks, in the caller's locals.
guard_lift_open() {
  bufs[depth]=$buf segs[depth]=$seg kinds[depth]=$kind parens[depth]=$paren
  depth=$((depth + 1))
  buf="" seg=0 kind=$1 paren=0
}

# guard_in_case <text> — 0 when the text holds a `case` with no `esac` after it, so a `)` there ends
# a pattern, not the substitution the text is the body of.
GUARD_CASE_WORD='[[:space:];&|(](case|esac)([[:space:];]|$)'
guard_in_case() {
  local text=" $1" open=0
  [[ "$text" == *case* ]] || return 1
  while [[ "$text" =~ $GUARD_CASE_WORD ]]; do
    if [[ "${BASH_REMATCH[1]}" == case ]]; then
      open=$((open + 1))
    else
      open=$((open - 1))
    fi
    text=${text#*"${BASH_REMATCH[0]}"}
  done
  ((open > 0))
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
# The directories `pushd` saved, top last, each behind a \037.
GUARD_DIR_STACK=""

# guard_scope_step <line> — one line of guard_scopes against GUARD_SHELL_DIR and GUARD_DIR_STACK: a
# subshell opening saves them, its end restores them, a `cd`, `pushd` or `popd` (words in WORDS) moves
# them: docs/contributing/bash-guard.md#commands-and-scopes. Returns 1 for a scope line, which holds no command.
guard_scope_step() {
  local word verb entry i=1 keep=0 bt_line=$'\001`'
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
      GUARD_SCOPE_STACK+=$'\n'"$GUARD_SHELL_DIR"$'\036'"$GUARD_DIR_STACK"
      return 1
      ;;
    $'\001)')
      if [[ -n "$GUARD_SCOPE_STACK" ]]; then
        entry=${GUARD_SCOPE_STACK##*$'\n'}
        GUARD_SHELL_DIR=${entry%%$'\036'*} GUARD_DIR_STACK=${entry#*$'\036'}
        GUARD_SCOPE_STACK="${GUARD_SCOPE_STACK%$'\n'*}"
      fi
      return 1
      ;;
  esac
  guard_read_words "$1"
  guard_unwrap_words
  verb=${WORDS[0]:-}
  [[ "$verb" == cd || "$verb" == pushd || "$verb" == popd ]] || return 0
  # `cd -P dir`: the options name no directory, and `--` ends them. `-n` keeps the shell where it is.
  while [[ "${WORDS[i]:-}" == -[LPen@]* ]]; do
    [[ "${WORDS[i]}" == *n* ]] && keep=1
    i=$((i + 1))
  done
  [[ "${WORDS[i]:-}" == -- ]] && i=$((i + 1))
  word=${WORDS[i]:-}
  case "$verb:$word" in
    pushd:[+-][0-9]* | popd:[+-][0-9]*)
      # A turn of the stack, which the guard does not follow.
      GUARD_SHELL_DIR=$GUARD_CWD GUARD_DIR_STACK=""
      ;;
    popd:*)
      entry=${GUARD_DIR_STACK##*$'\037'}
      [[ -n "$GUARD_DIR_STACK" ]] && ! ((keep)) && GUARD_SHELL_DIR=$entry
      GUARD_DIR_STACK=${GUARD_DIR_STACK%$'\037'*}
      ;;
    pushd:)
      # The top two swap; with nothing saved, the shell stays.
      [[ -n "$GUARD_DIR_STACK" ]] || return 0
      entry=${GUARD_DIR_STACK##*$'\037'}
      GUARD_DIR_STACK=${GUARD_DIR_STACK%$'\037'*}$'\037'"$GUARD_SHELL_DIR"
      GUARD_SHELL_DIR=$entry
      ;;
    pushd:*)
      if ((keep)); then
        GUARD_DIR_STACK+=$'\037'"$(guard_cd_dir "$word")"
      else
        GUARD_DIR_STACK+=$'\037'"$GUARD_SHELL_DIR"
        GUARD_SHELL_DIR=$(guard_cd_dir "$word")
      fi
      ;;
    *) ((keep)) || GUARD_SHELL_DIR=$(guard_cd_dir "$word") ;;
  esac
  return 0
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
  printf 'Refused by the sdlc plugin. If this is genuinely needed, the user runs it.\n' >&2
  exit 2
}

# guard_ask <reason> — a permission prompt instead of a refusal; in auto mode it forces one too.
guard_ask() {
  jq -cn --arg r "$1" \
    '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason: $r}}'
  exit 0
}

# --- the config ---------------------------------------------------------------------------------

# guard_config_load <cwd> — the config of the repository holding <cwd>, resolved as
# dw-sdlc/src/agentic-config.ts does: GUARD_CONFIG one line of JSON, GUARD_CONFIG_ROOT the worktree's
# top level, GUARD_CONFIG_PROBLEMS one `file: path: message` a line. Returns 1 without jq.
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
  # One jq: the config on the first line, each problem of a loosening local layer on the lines after.
  resolved=$(jq -rn -L "$GUARD_LIB_DIR" --argjson inferred "$inferred" --argjson committed "$committed" \
    --argjson local "$local_layer" --arg earlier "$GUARD_CONFIG_PROBLEMS" '
    include "config";
    resolve($inferred; $committed; $local) as $r
    | ($r.problems | map("\(.file): \(.path): \(.message)")) as $loosened
    | (if ($earlier != "" or ($loosened | length) > 0) then ($r.config | on_strictest) else $r.config end | tojson),
      $loosened[]')
  GUARD_CONFIG=${resolved%%$'\n'*}
  loosened=""
  [[ "$resolved" == *$'\n'* ]] && loosened=${resolved#*$'\n'}
  [[ -n "$loosened" ]] && GUARD_CONFIG_PROBLEMS+="${GUARD_CONFIG_PROBLEMS:+$'\n'}$loosened"
  return 0
}

# guard_config_get <jq-filter> — one value out of the resolved config, empty when unset or null.
guard_config_get() {
  jq -r "$1 // empty" <<<"$GUARD_CONFIG"
}

# guard_config_infer <root> — the bottom layer on stdout: the conventional commit preset, the Node
# package manager from the lockfile, and the Gate command from the manifest's `check` script.
guard_config_infer() {
  local root="$1" node="" manifest=(--arg manifest "")
  if [[ -f "$root/pnpm-lock.yaml" ]]; then
    node=pnpm
  elif [[ -f "$root/package-lock.json" ]]; then
    node=npm
  elif [[ -f "$root/yarn.lock" ]]; then
    node=yarn
  elif [[ -f "$root/bun.lock" || -f "$root/bun.lockb" ]]; then
    node=bun
  fi
  [[ -f "$root/package.json" ]] && manifest=(--rawfile manifest "$root/package.json")
  jq -cn --arg node "$node" "${manifest[@]}" '
    (try ($manifest | fromjson | .scripts.check) catch null) as $check
    | {
        commit: {convention: "conventional"},
        packageManagers: (if $node != "" then {node: $node} else {} end)
      }
    + if ($check | type) == "string" then {gate: {command: "pnpm check"}} else {} end'
}

# guard_config_layer <root> <main> <file> — GUARD_LAYER_JSON becomes the document at <root>, else at
# <main> when it is set, or null when the file is absent or invalid; an invalid one adds its problems
# to GUARD_CONFIG_PROBLEMS. A layer jq cannot validate is a problem too, never a pass.
guard_config_layer() {
  local path="$1/$3" problems line
  GUARD_LAYER_JSON="null"
  [[ ! -f "$path" && -n "$2" ]] && path="$2/$3"
  [[ -f "$path" ]] || return 0
  if ! jq empty "$path" >/dev/null 2>&1; then
    guard_config_problem "$3" "" "not JSON: $(jq empty "$path" 2>&1 | head -n1)"
    return 0
  fi
  if ! problems=$(guard_config_validate "$path" 2>/dev/null); then
    if [[ -f "$GUARD_SCHEMA" ]]; then
      guard_config_problem "$3" "" \
        "not validated against $GUARD_SCHEMA: $(guard_config_validate "$path" 2>&1 >/dev/null | head -n1)"
    else
      guard_config_problem "$3" "" \
        "not validated: the schema $GUARD_SCHEMA is missing; an install from GitHub needs packages in its --sparse set"
    fi
    return 0
  fi
  if [[ -n "$problems" ]]; then
    while IFS= read -r line; do
      guard_config_problem "$3" "${line%%$'\001'*}" "${line#*$'\001'}"
    done <<<"$problems"
    return 0
  fi
  GUARD_LAYER_JSON=$(jq -c . "$path")
}

# guard_config_validate <path> — the schema's problems with the document at <path>, one
# `path\001message` per line. A schema jq cannot read is exit 2 with nothing on stdout, the same
# output as a valid document, so the caller reads the exit code.
guard_config_validate() {
  jq -r -L "$GUARD_LIB_DIR" --slurpfile schema "$GUARD_SCHEMA" \
    'include "schema"; validate($schema[0])[] | "\(.path)\u0001\(.message)"' "$1"
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
