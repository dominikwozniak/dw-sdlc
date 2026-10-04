#!/bin/bash
# Enforces the commit conventions the resolved config carries, so the rules a session is trusted to
# follow are checked instead. Four refusals:
#
#   1. a subject that misses `commit.pattern`, a POSIX ERE — the preset `commit.convention` names
#      when nothing declares it; `.+` declares that any subject is fine. The message is read from
#      `-m`, and from the heredoc a `-m "$(cat <<'EOF' … EOF)"` or a `-F - <<'EOF'` hands git
#   2. a message missing the `commit.trailer` line, when one is declared
#   3. a LIVE backtick inside a `-m` string or an unquoted heredoc — command substitution that
#      mangles the message and still exits 0, so nobody notices until they read the log
#   4. `git add -A` / `git add .` — stage session work by name
#
# Guardrail against agent sloppiness, not a security boundary; check 4 is a habit rule. Spawned by
# bash-guard.sh when the command names git with commit or add, and handed the command as typed,
# heredoc bodies included; runs alone on the JSON payload too.
#
# WHY A LEXER AND NOT `xargs -n1`: BSD xargs dies with "unterminated quote" the moment a quoted
# argument contains a newline, and a multi-line `-m` body is the normal shape here. The scanner
# below has no such limit and carries the one state checks 1 and 3 need: whether a backtick or a
# `$` sat in a single-quoted span (inert) or a double-quoted one (live). Wrapper prefixes need no
# handling: the walk keys off a `git` token, and every token before one — `sudo`, `rtk`,
# `rtk proxy` — is simply not that token.
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
guard_config_load "$GUARD_CWD" || exit 0
PATTERN=$(guard_config_get '.commit.pattern')
TRAILER=$(guard_config_get '.commit.trailer')

# --- the lexer --------------------------------------------------------------------------------------
# Splits the command into TOKENS the way a shell would — quotes removed, escapes honoured — and
# records per token whether a LIVE backtick appeared in it (TOKEN_LIVE_BT) and whether a LIVE
# expansion did (TOKEN_LIVE_DOLLAR, a `$` opening `(`, `{` or a name): outside single quotes and not
# backslash-escaped. `;` `&` `|` `(` `)` become tokens of their own so a chained command or a
# subshell closes off.
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
# One pass over the command as typed that does what guard_strip_heredocs does — openers found by
# guard_heredoc_opener, bodies dropped, so a body that writes a file never reads as commands, openers
# kept with `<<` collapsed to `<` — and keeps each body by index, with whether the shell leaves it
# literal (a quoted delimiter) or expands it. The kept opener's delimiter carries that index, `EOF`
# becoming `EOF__HD0`, so a `-m "$(cat <<'EOF' …)"` or a `-F - <<'EOF'` names its own body even when
# an earlier `cat > file <<'EOF'` shares the delimiter. Parallel arrays read by index: bash 3.2 has no
# associative arrays and errors on "${arr[@]}" for an empty one under `set -u`.
HD_BODIES=()
HD_LITERAL=()
STRIPPED=""
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

reset_group() {
  MSG_COUNT=0
  MSG_FIRST=""
  MSG_ALL=""
  MSG_LIVE_BT=0
  MSG_EXPANDS=0
  MSG_FROM_FILE=0
  MSG_FROM_STDIN=0
  STDIN_DELIM=""
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

  # git's own machine-written subjects, which no project pattern describes.
  case "$subject" in
    "Merge "* | "Revert "* | "fixup! "* | "squash! "* | "amend! "*) return 0 ;;
  esac
  # A message assembled by the shell is not the message: `-m "$MSG"` reaches here as the literal
  # dollars-and-a-name, and checking that would be checking nothing. A message reading "costs $5"
  # holds no expansion, and single quotes, an escaping backslash or a quoted heredoc delimiter keep
  # `$HOME` literal: all of those stay checked.
  ((MSG_EXPANDS)) && return 0

  if [[ -n "$PATTERN" ]] && ! printf '%s' "$subject" | grep -qE "$PATTERN"; then
    guard_block "commit subject \"$subject\" does not match this repository's commit pattern.
  pattern: $PATTERN
  from commit.pattern in .ai/agentic.config.json, or the preset commit.convention names; '.+' accepts any subject.
Rewrite the subject to match."
  fi

  if [[ -n "$TRAILER" ]] && ! has_trailer "$TRAILER" "$MSG_ALL"; then
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
while ((i < count)); do
  t="${TOKENS[i]}"
  case "$t" in
    ';' | '&' | '|' | '(' | ')')
      check_group
      reset_group
      verb=""
      i=$((i + 1))
      continue
      ;;
    git)
      check_group
      reset_group
      verb=""
      i=$((i + 1))
      # Consume everything before the subcommand: `-C <path>`, `-c k=v`, `--git-dir=…`.
      while ((i < count)); do
        case "${TOKENS[i]}" in
          -C | -c | --git-dir | --work-tree | --namespace)
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
      case "$t" in
        --all)
          guard_block "'git add' is staging the whole working tree ($t). Stage session work by name — 'git add path1 path2' — so an unrelated or half-finished file cannot ride along into the commit."
          ;;
        # Every other long option, and the `--` separator, are none of this guard's business — and
        # this arm has to precede the short-cluster one, which would read the `A` in a long name.
        --*) ;;
        -*A*)
          guard_block "'git add' is staging the whole working tree ($t). Stage session work by name — 'git add path1 path2' — so an unrelated or half-finished file cannot ride along into the commit."
          ;;
        . | ./)
          guard_block "'git add $t' stages the whole working tree. Stage session work by name — 'git add path1 path2' — so an unrelated or half-finished file cannot ride along into the commit."
          ;;
      esac
      ;;
  esac
  i=$((i + 1))
done

check_group

exit 0
