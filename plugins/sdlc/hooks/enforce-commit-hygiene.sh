#!/bin/bash
# Enforces the commit conventions the resolved config carries: the subject, the trailer, a live
# backtick and a `git add` of the whole tree, each in README.md#guards. A lexer of its own, since BSD
# `xargs -n1` dies on a quoted newline; it keys off a `git` token, so a launcher before one needs nothing.
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

guard_read_payload "$@" || exit 0
[[ -n "$GUARD_COMMAND" ]] || exit 0
RAW="$GUARD_COMMAND"
# Cheap bail-out before the per-character scans.
[[ "$RAW" == *git* ]] || exit 0
case "$RAW" in
  *commit* | *add*) ;;
  *) exit 0 ;;
esac

# --- the policies -----------------------------------------------------------------------------------
# A commit is judged by the config of the repository it runs in, which the walk below follows.
PATTERN=""
TRAILER=""
POLICY_DIR=""

# policies <dir> — PATTERN and TRAILER from the config of the repository holding <dir>, read once per
# directory in a row. 1 without jq.
policies() {
  [[ -n "$POLICY_DIR" && "$1" == "$POLICY_DIR" ]] && return 0
  guard_config_load "$1" || return 1
  POLICY_DIR="$1"
  PATTERN=$(guard_config_get '.commit.pattern')
  TRAILER=$(guard_config_get '.commit.trailer')
}

# --- the lexer --------------------------------------------------------------------------------------
# TOKENS, the command split as a shell would, and per token a live backtick (TOKEN_LIVE_BT) or a live
# `$(`, `${` or `$name` (TOKEN_LIVE_DOLLAR), outside single quotes and unescaped; `;&|()` stand alone.
TOKENS=()
TOKEN_LIVE_BT=()
TOKEN_LIVE_DOLLAR=()
lex() {
  # Two statements, not one `local s="$1" n=${#s}`: every word of a `local` is expanded BEFORE the
  # builtin runs, so `${#s}` would read an `s` that is not set yet — under `set -u` that aborts the
  # hook at exit 1, which is a guard saying nothing.
  local s="$1"
  local n=${#s}
  local i=0 ch cur="" have=0 live=0 dollar=0 state=plain
  TOKENS=()
  TOKEN_LIVE_BT=()
  TOKEN_LIVE_DOLLAR=()
  while ((i < n)); do
    ch=${s:i:1}
    case "$state" in
      plain)
        case "$ch" in
          "'")
            state=sq
            have=1
            ;;
          '"')
            state=dq
            have=1
            ;;
          '\')
            i=$((i + 1))
            cur+=${s:i:1}
            have=1
            ;;
          '`')
            live=1
            cur+=$ch
            have=1
            ;;
          '$')
            case "${s:i+1:1}" in [\(\{A-Za-z_]) dollar=1 ;; esac
            cur+=$ch
            have=1
            ;;
          ' ' | $'\t' | $'\n')
            if ((have)); then
              TOKENS+=("$cur")
              TOKEN_LIVE_BT+=("$live")
              TOKEN_LIVE_DOLLAR+=("$dollar")
              cur=""
              have=0
              live=0
              dollar=0
            fi
            ;;
          ';' | '&' | '|' | '(' | ')')
            if ((have)); then
              TOKENS+=("$cur")
              TOKEN_LIVE_BT+=("$live")
              TOKEN_LIVE_DOLLAR+=("$dollar")
              cur=""
              have=0
              live=0
              dollar=0
            fi
            TOKENS+=("$ch")
            TOKEN_LIVE_BT+=("0")
            TOKEN_LIVE_DOLLAR+=("0")
            ;;
          *)
            cur+=$ch
            have=1
            ;;
        esac
        ;;
      sq)
        # Inside single quotes NOTHING is special — not the backslash, not the `$`, and not the
        # backtick, which is the whole reason this state is tracked apart.
        case "$ch" in
          "'") state=plain ;;
          *) cur+=$ch ;;
        esac
        ;;
      dq)
        case "$ch" in
          '"') state=plain ;;
          '\')
            i=$((i + 1))
            cur+=${s:i:1}
            ;;
          '`')
            live=1
            cur+=$ch
            ;;
          '$')
            case "${s:i+1:1}" in [\(\{A-Za-z_]) dollar=1 ;; esac
            cur+=$ch
            ;;
          *) cur+=$ch ;;
        esac
        ;;
    esac
    i=$((i + 1))
  done
  if ((have)); then
    TOKENS+=("$cur")
    TOKEN_LIVE_BT+=("$live")
    TOKEN_LIVE_DOLLAR+=("$dollar")
  fi
  return 0
}

# --- heredocs ---------------------------------------------------------------------------------------
# Each body by index: HD_BODIES, and HD_LITERAL for a quoted delimiter. Parallel arrays: bash 3.2 has
# no associative ones and errors on "${arr[@]}" for an empty one under `set -u`.
HD_BODIES=()
HD_LITERAL=()
STRIPPED=""
# split_heredocs — STRIPPED, the command with every body dropped and each opener's `<<` made `<`, its
# delimiter tagged with the body's index, `EOF__HD0`, so a `-m "$(cat <<'EOF' …)"` or `-F - <<'EOF'`
# names its own body even when an earlier `cat > file <<'EOF'` shares the delimiter.
split_heredocs() {
  local line delim="" dash="" literal=0 body="" lines=0 inbody=0 state=""
  while IFS= read -r line; do
    if ((inbody)); then
      if [[ "$line" =~ ^[[:space:]]*$delim[[:space:]]*$ ]]; then
        # `$( )` and git's own cleanup both drop the trailing blank lines.
        while [[ "$body" == *$'\n' ]]; do body="${body%$'\n'}"; done
        HD_BODIES+=("$body")
        HD_LITERAL+=("$literal")
        inbody=0
        continue
      fi
      [[ -n "$dash" ]] && line="${line#"${line%%[!$'\t']*}"}"
      if ((lines)); then
        body+=$'\n'"$line"
      else
        body="$line"
      fi
      lines=$((lines + 1))
      continue
    fi
    if guard_heredoc_opener "$line" "$state"; then
      dash="$GUARD_HD_DASH"
      literal=0
      [[ -n "$GUARD_HD_QUOTE" ]] && literal=1
      delim="$GUARD_HD_DELIM"
      line="${GUARD_HD_HEAD}<${GUARD_HD_QUOTE}${delim}__HD${#HD_BODIES[@]}${GUARD_HD_TAIL}"
      body=""
      lines=0
      inbody=1
    fi
    state="$GUARD_HD_STATE"
    STRIPPED+="$line"$'\n'
  done <<<"$RAW"
  return 0
}
split_heredocs
# The walk reads the command the way the shell runs it: heredoc bodies dropped, continuation lines joined.
COMMAND=$(printf '%s' "$STRIPPED" | guard_join_continuations)

# heredoc_index <delimiter> — HD_INDEX becomes the body a tagged delimiter names; 1 when it names none.
HD_INDEX=-1
heredoc_index() {
  [[ "$1" =~ __HD([0-9]+)$ ]] || return 1
  HD_INDEX="${BASH_REMATCH[1]}"
  ((HD_INDEX < ${#HD_BODIES[@]}))
}

# What a `-m "$(cat <<'EOF' … EOF)"` leaves in the walk once its body is dropped: `$(cat <'EOF'`, a
# newline and the closing parenthesis.
SUBSTITUTED='^\$\(cat[[:space:]]+<[[:space:]]*["'"'"'\]?([A-Za-z_][A-Za-z0-9_]*)["'"'"']?[[:space:]]*\)$'

# expands <text> — 1 when the shell would expand something in an unquoted heredoc body, else 0. A
# `-m` value carries that knowledge from the lexer instead, where the quotes were still there to read.
expands() {
  if printf '%s' "$1" | grep -q '\$[({A-Za-z_]'; then echo 1; else echo 0; fi
}

# --- the checks over one `git commit` ---------------------------------------------------------------
# Group state as scalars rather than arrays: bash 3.2 errors on "${arr[@]}" for an empty array
# under `set -u`, and the group only needs the first message, all of them joined, and one flag.
MSG_COUNT=0
MSG_FIRST=""
MSG_ALL=""
MSG_LIVE_BT=0
MSG_EXPANDS=0
MSG_FROM_FILE=0
MSG_FROM_STDIN=0
STDIN_DELIM=""
MSG_TRAILERS=""
# One `git add`: the -A or --all it carries, the whole-tree pathspec it names, whether it names any
# other path, and whether it is a dry run.
ADD_ALL=""
ADD_WHOLE=""
ADD_NAMED=0
ADD_DRY=0
ADD_PATHS_ONLY=0

reset_group() {
  MSG_COUNT=0
  MSG_FIRST=""
  MSG_ALL=""
  MSG_LIVE_BT=0
  MSG_EXPANDS=0
  MSG_FROM_FILE=0
  MSG_FROM_STDIN=0
  STDIN_DELIM=""
  MSG_TRAILERS=""
  ADD_ALL=""
  ADD_WHOLE=""
  ADD_NAMED=0
  ADD_DRY=0
  ADD_PATHS_ONLY=0
}

# add_path <word> — one pathspec of a `git add`: `.`, `./` and `:/` are the whole tree.
add_path() {
  case "$1" in
    . | ./ | :/) ADD_WHOLE="$1" ;;
    *) ADD_NAMED=1 ;;
  esac
}

# check_add — a `git add` staging the whole tree: a whole-tree pathspec, or -A/--all with no path to
# narrow it. A dry run stages nothing.
check_add() {
  ((ADD_DRY)) && return 0
  local why="Stage session work by name — 'git add path1 path2' — so an unrelated or half-finished file cannot ride along into the commit."
  [[ -n "$ADD_WHOLE" ]] && guard_block "'git add $ADD_WHOLE' stages the whole working tree. $why"
  [[ -n "$ADD_ALL" ]] && ! ((ADD_NAMED)) && guard_block "'git add' is staging the whole working tree ($ADD_ALL). $why"
  return 0
}

# add_msg <text> <live-backtick> <expands>
add_msg() {
  if ((MSG_COUNT == 0)); then
    MSG_FIRST="$1"
    MSG_ALL="$1"
  else
    # Repeated `-m` is how git builds a body: each one becomes its own paragraph.
    MSG_ALL="$MSG_ALL"$'\n\n'"$1"
  fi
  MSG_COUNT=$((MSG_COUNT + 1))
  [[ "$2" == "1" ]] && MSG_LIVE_BT=1
  [[ "$3" == "1" ]] && MSG_EXPANDS=1
  return 0
}

# heredoc_msg <index> — that body as a message: literal behind a quoted delimiter, expanded by the
# shell otherwise, where a backtick is live.
heredoc_msg() {
  local body="${HD_BODIES[$1]}" live=0 shell=0
  if [[ "${HD_LITERAL[$1]}" == 0 ]]; then
    [[ "$body" == *'`'* ]] && live=1
    shell=$(expands "$body")
  fi
  add_msg "$body" "$live" "$shell"
}

# message <token> <live-backtick> <live-dollar> — one -m value; a heredoc substitution stands for its body.
message() {
  if [[ "$1" =~ $SUBSTITUTED ]] && heredoc_index "${BASH_REMATCH[1]}"; then
    heredoc_msg "$HD_INDEX"
    return 0
  fi
  add_msg "$1" "$2" "$3"
}

# has_trailer <key> <message> — a line whose start matches <key>, case-blind.
has_trailer() {
  local key line
  key=$(printf '%s' "$1" | tr 'A-Z' 'a-z')
  while IFS= read -r line; do
    line=$(printf '%s' "$line" | sed -e 's/^[[:space:]]*//' | tr 'A-Z' 'a-z')
    case "$line" in
      "$key"*) return 0 ;;
    esac
  done <<<"$2"
  return 1
}

check_group() {
  local subject
  check_add
  # -F - reads the message from stdin: a heredoc on this command is readable, a pipe is not.
  if ((MSG_FROM_STDIN)); then
    if [[ -n "$STDIN_DELIM" ]] && heredoc_index "$STDIN_DELIM"; then
      heredoc_msg "$HD_INDEX"
    else
      return 0
    fi
  fi
  ((MSG_COUNT == 0)) && return 0 # editor commit — the message is not here to read
  ((MSG_FROM_FILE)) && return 0  # -F <file> — likewise

  if ((MSG_LIVE_BT)); then
    guard_block "this commit message carries a live backtick inside a double-quoted -m, so the shell will run the backticked span and splice its output in — the commit succeeds with that phrase GONE. Drop the backticks, single-quote the message, escape them (\\\`), or write the message to a file and use 'git commit -F <file>'."
  fi

  subject=${MSG_FIRST%%$'\n'*}

  guard_subject_by_git "$subject" && return 0
  # A message the shell assembles, `-m "$MSG"`, is not the text read here, so it goes unchecked.
  # "costs $5" expands nothing, and single quotes, a backslash or a quoted heredoc delimiter keep
  # `$HOME` literal: those stay checked.
  ((MSG_EXPANDS)) && return 0
  policies "$GROUP_DIR" || return 0

  if ! guard_subject_fits "$subject" "$PATTERN"; then
    guard_block "commit subject \"$subject\" does not match this repository's commit pattern.
  pattern: $PATTERN
  from commit.pattern in .ai/agentic.config.json, or the preset commit.convention names; '.+' accepts any subject.
Rewrite the subject to match."
  fi

  if [[ -n "$TRAILER" ]] && ! has_trailer "$TRAILER" "$MSG_ALL$MSG_TRAILERS"; then
    guard_block "commit message is missing this repository's trailer.
  trailer: $TRAILER
  from commit.trailer in .ai/agentic.config.json.
Add it as the last line of the message — with repeated -m, that is a final -m of its own."
  fi
  return 0
}

# --- the walk ---------------------------------------------------------------------------------------
lex "$COMMAND"

verb=""
i=0
count=${#TOKENS[@]}
# Where the shell stands is GUARD_SHELL_DIR; a subshell saves it on SCOPES and gives it back at its
# end. GROUP_DIR is where the current `git` runs, AT_START whether the token opens a command.
SCOPES=""
GROUP_DIR="$GUARD_CWD"
AT_START=1
while ((i < count)); do
  t="${TOKENS[i]}"
  case "$t" in
    ';' | '&' | '|' | '(' | ')')
      check_group
      reset_group
      verb=""
      if [[ "$t" == "(" ]]; then
        SCOPES+=$'\n'"$GUARD_SHELL_DIR"
      elif [[ "$t" == ")" && -n "$SCOPES" ]]; then
        GUARD_SHELL_DIR="${SCOPES##*$'\n'}"
        SCOPES="${SCOPES%$'\n'*}"
      fi
      AT_START=1
      i=$((i + 1))
      continue
      ;;
    cd)
      if ((AT_START)); then
        # The directory is the first word that is no option (`-L`, `-P`); none is the home directory.
        dir=""
        i=$((i + 1))
        while ((i < count)); do
          case "${TOKENS[i]}" in
            ';' | '&' | '|' | '(' | ')') break ;;
            -[LPe@]*) i=$((i + 1)) ;;
            *)
              dir="${TOKENS[i]}"
              i=$((i + 1))
              break
              ;;
          esac
        done
        GUARD_SHELL_DIR=$(guard_cd_dir "$dir")
        AT_START=0
        continue
      fi
      ;;
    git | */git)
      check_group
      reset_group
      verb=""
      GROUP_DIR="$GUARD_SHELL_DIR"
      AT_START=0
      i=$((i + 1))
      # Consume everything before the subcommand: `-C <path>`, `-c k=v`, `--git-dir=…`.
      while ((i < count)); do
        case "${TOKENS[i]}" in
          -C)
            GROUP_DIR=$(guard_located "${TOKENS[i + 1]:-}")
            i=$((i + 2))
            ;;
          -C?*)
            GROUP_DIR=$(guard_located "${TOKENS[i]#-C}")
            i=$((i + 1))
            ;;
          -c | --git-dir | --work-tree | --namespace)
            i=$((i + 2))
            ;;
          -*)
            i=$((i + 1))
            ;;
          *)
            verb="${TOKENS[i]}"
            i=$((i + 1))
            break
            ;;
        esac
      done
      continue
      ;;
  esac
  AT_START=0

  case "$verb" in
    commit)
      case "$t" in
        -F | --file)
          if [[ "${TOKENS[i + 1]:-}" == "-" ]]; then
            MSG_FROM_STDIN=1
          else
            MSG_FROM_FILE=1
          fi
          i=$((i + 2)) # the flag and its filename
          continue
          ;;
        --file=- | -F-)
          MSG_FROM_STDIN=1
          ;;
        --file=* | -F?*)
          MSG_FROM_FILE=1
          ;;
        # A heredoc on this command, its `<<` collapsed to `<` by the heredoc pass: `<EOF` or `< EOF`.
        '<'*)
          STDIN_DELIM="${t#<}"
          if [[ -z "$STDIN_DELIM" ]]; then
            STDIN_DELIM="${TOKENS[i + 1]:-}"
            i=$((i + 2))
            continue
          fi
          ;;
        --message)
          if ((i + 1 < count)); then
            message "${TOKENS[i + 1]}" "${TOKEN_LIVE_BT[i + 1]}" "${TOKEN_LIVE_DOLLAR[i + 1]}"
            i=$((i + 2))
            continue
          fi
          ;;
        --message=*)
          message "${t#--message=}" "${TOKEN_LIVE_BT[i]}" "${TOKEN_LIVE_DOLLAR[i]}"
          ;;
        # git writes `token: value` (or `token=value`) as a trailer line that starts with the token.
        --trailer)
          MSG_TRAILERS+=$'\n'"${TOKENS[i + 1]:-}"
          i=$((i + 2))
          continue
          ;;
        --trailer=*)
          MSG_TRAILERS+=$'\n'"${t#--trailer=}"
          ;;
        --*) ;; # every other long option is none of this guard's business
        -*)
          # A short-option cluster carrying `m`: -m, -am, -sm, and the glued forms -mfix: … where
          # the message starts right after the `m`. Anything without an `m` is skipped.
          rest="${t#-}"
          case "$rest" in
            *m*)
              tail="${rest#*m}"
              if [[ -z "$tail" ]]; then
                if ((i + 1 < count)); then
                  message "${TOKENS[i + 1]}" "${TOKEN_LIVE_BT[i + 1]}" "${TOKEN_LIVE_DOLLAR[i + 1]}"
                  i=$((i + 2))
                  continue
                fi
              else
                message "$tail" "${TOKEN_LIVE_BT[i]}" "${TOKEN_LIVE_DOLLAR[i]}"
              fi
              ;;
          esac
          ;;
      esac
      ;;
    add)
      if ((ADD_PATHS_ONLY)); then
        add_path "$t"
      else
        case "$t" in
          --) ADD_PATHS_ONLY=1 ;;
          --all) ADD_ALL="$t" ;;
          --dry-run) ADD_DRY=1 ;;
          --pathspec-from-file*) ADD_NAMED=1 ;;
          # Every other long option is none of this guard's business — and this arm has to precede
          # the short-cluster one, which would read the `A` in a long name.
          --*) ;;
          -*)
            [[ "$t" == *A* ]] && ADD_ALL="$t"
            [[ "$t" == *n* ]] && ADD_DRY=1
            ;;
          *) add_path "$t" ;;
        esac
      fi
      ;;
  esac
  i=$((i + 1))
done

check_group

exit 0
