#!/bin/bash
# Enforces the commit conventions the resolved config carries: the subject, the trailer, a live
# backtick and a `git add` of the whole tree, each in README.md#guards. It reads the command as typed
# through the walker's words, and keys off a `git` word, so launchers need no handling.
set -uo pipefail
source "${BASH_SOURCE[0]%/*}/lib.sh"

guard_read_payload "$@" || exit 0
[[ -n "$GUARD_COMMAND" ]] || exit 0
RAW="$GUARD_COMMAND"
# Cheap bail-out before the walk.
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

# --- the words ----------------------------------------------------------------------------------
# TOKENS, the command as typed read as docs/contributing/bash-guard.md#the-commit-guards-reading
# says, each cut a token of its own, and TOKEN_LIVE each word's live marks.
guard_split_heredocs "$RAW"
COMMAND=$(printf '%s' "$GUARD_HD_SPLIT" | guard_join_continuations)
TOKENS=()
TOKEN_LIVE=()
guard_top_level "$COMMAND"
for top in "${GUARD_TOP[@]}"; do
  if [[ "$top" == "$GUARD_TOP_MARK"? ]]; then
    TOKENS+=("${top:1}")
    TOKEN_LIVE+=("")
    continue
  fi
  guard_split_words "$top"
  TOKENS+=("${GUARD_WORDS[@]+"${GUARD_WORDS[@]}"}")
  TOKEN_LIVE+=("${GUARD_WORD_LIVE[@]+"${GUARD_WORD_LIVE[@]}"}")
done

# heredoc_index <delimiter> — HD_INDEX becomes the body a tagged delimiter names; 1 when it names none.
HD_INDEX=-1
heredoc_index() {
  [[ "$1" =~ __HD([0-9]+)$ ]] || return 1
  HD_INDEX="${BASH_REMATCH[1]}"
  ((HD_INDEX < ${#GUARD_HD_BODIES[@]}))
}

# The word a `-m "$(cat <<'EOF' … EOF)"` leaves once its body is split out: `$(cat <HD__HD0`, a newline
# and the closing parenthesis.
SUBSTITUTED='^\$\(cat[[:space:]]+<[[:space:]]*["'"'"'\]?([A-Za-z_][A-Za-z0-9_]*)["'"'"']?[[:space:]]*\)$'

# expands <text> — 1 when the shell would expand something in an unquoted heredoc body, else 0. A
# `-m` value carries that knowledge in its live marks instead, read where the quotes still stood.
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

# add_path <word> — one pathspec of a `git add`, a trailing `/` dropped (`./` is `.`, `:/` is `:`): `.`, `*`, `:/`, `:(top)`, `$PWD` are the whole tree.
add_path() {
  case "${1%/}" in
    . | ./. | '*' | './*' | : | :/. | ':/*' | ':(top)' | ':(top).' | ':(top)*' | '$PWD' | '${PWD}' | '$(pwd)') ADD_WHOLE="$1" ;;
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
  local body="${GUARD_HD_BODIES[$1]}" live=0 shell=0
  if [[ "${GUARD_HD_LITERAL[$1]}" == 0 ]]; then
    [[ "$body" == *'`'* ]] && live=1
    shell=$(expands "$body")
  fi
  add_msg "$body" "$live" "$shell"
}

# message <token> <live marks> — one -m value; a heredoc substitution stands for its body.
message() {
  local bt=0 dollar=0
  if [[ "$1" =~ $SUBSTITUTED ]] && heredoc_index "${BASH_REMATCH[1]}"; then
    heredoc_msg "$HD_INDEX"
    return 0
  fi
  [[ "$2" == *'`'* ]] && bt=1
  [[ "$2" == *'$'* ]] && dollar=1
  add_msg "$1" "$bt" "$dollar"
}

# has_trailer <key> <message> — a line whose start, past its blanks, matches <key>, case-blind. One
# `tr` for the whole message: a fork a line cost a 40-line message 140 ms.
has_trailer() {
  local key line lower
  key=$(printf '%s' "$1" | tr 'A-Z' 'a-z')
  lower=$(printf '%s' "$2" | tr 'A-Z' 'a-z')
  while IFS= read -r line; do
    line="${line#"${line%%[![:space:]]*}"}"
    case "$line" in
      "$key"*) return 0 ;;
    esac
  done <<<"$lower"
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
            message "${TOKENS[i + 1]}" "${TOKEN_LIVE[i + 1]}"
            i=$((i + 2))
            continue
          fi
          ;;
        --message=*)
          message "${t#--message=}" "${TOKEN_LIVE[i]}"
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
                  message "${TOKENS[i + 1]}" "${TOKEN_LIVE[i + 1]}"
                  i=$((i + 2))
                  continue
                fi
              else
                message "$tail" "${TOKEN_LIVE[i]}"
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
