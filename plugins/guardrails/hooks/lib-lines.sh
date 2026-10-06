#!/bin/bash
# The line scanners lib.sh sources — heredoc openers and bodies, continuation lines: what the shell
# reads across a newline. Not a hook and not sourced on its own: lib.sh sets the locale and
# GUARD_LIB_DIR first, then sources this file ahead of lib-text.sh.
# --- the lines ----------------------------------------------------------------------------------

# A heredoc BODY is the text of a file being written, not commands being run, and every guard
# matches line by line — so `npm install` inside one reads exactly like an invocation. That false
# refusal stops the agent from writing its own test fixtures, so bodies are dropped once, here.
# The opener line is KEPT, because a redirect target on it (`cat > .env <<EOF`) is a real path that
# must still count — but its `<<` is collapsed to `<`, so no second pass mistakes a kept opener for a
# fresh heredoc and swallows every real command after it. An opener is only what the shell would
# read as one: a `<<` outside quotes and before a comment, so `echo "a << EOF"` and `# see << EOF`
# open nothing and the line after them is judged; a `<<` that did open one would otherwise hide every
# command after it. What follows the `<<`: 1 the `-` that strips a body's leading tabs, 2 the quote
# that keeps it literal, 3 the delimiter.
GUARD_HEREDOC_DELIM='^(-?)[[:space:]]*(["'"'"'\]?)([A-Za-z_][A-Za-z0-9_]*)'

# guard_heredoc_opener <line> [<state>] — the first heredoc opener on the line, or 1 when there is
# none. Sets GUARD_HD_HEAD (the text before `<<`), GUARD_HD_DASH, GUARD_HD_QUOTE, GUARD_HD_DELIM
# and GUARD_HD_TAIL (from the character after the delimiter on, its closing quote included). Always
# sets GUARD_HD_STATE, the quote state the line ends in, to hand back as the next line's <state>:
# a `-m` body spanning lines is quoted from where it opened. The state is a stack, one character
# per open context: `s` single quotes, `d` double quotes, `(` a `$(` and a backtick its own —
# inside those the shell reads plain text again even within double quotes, which is why
# `-m "$(cat <<'EOF'` opens. A `<<<` is a here-string, not an opener.
guard_heredoc_opener() {
  local s="$1"
  local n=${#s}
  local st="${2-}" i=0 ch top prev found=0
  GUARD_HD_HEAD="" GUARD_HD_DASH="" GUARD_HD_QUOTE="" GUARD_HD_DELIM="" GUARD_HD_TAIL=""
  while ((i < n)); do
    ch=${s:i:1}
    top=${st:${#st}-1}
    if [[ "$top" == s ]]; then
      [[ "$ch" == "'" ]] && st=${st%s}
      i=$((i + 1))
      continue
    fi
    case "$ch" in
      '\')
        i=$((i + 2))
        continue
        ;;
      "'") [[ "$top" != d ]] && st+=s ;;
      '"') if [[ "$top" == d ]]; then st=${st%d}; else st+=d; fi ;;
      '$') [[ "${s:i+1:1}" == '(' ]] && {
        st+='('
        i=$((i + 1))
      } ;;
      '`') if [[ "$top" == '`' ]]; then st=${st%\`}; else st+='`'; fi ;;
      ')') [[ "$top" == '(' ]] && st=${st%\(} ;;
      '#')
        # A comment starts a word: the rest of the line is text, and the state is settled.
        prev=""
        ((i > 0)) && prev=${s:i-1:1}
        case "$prev" in
          '' | ' ' | $'\t' | ';' | '&' | '|' | '(' | ')') [[ "$top" != d ]] && break ;;
        esac
        ;;
      '<')
        prev=""
        ((i > 0)) && prev=${s:i-1:1}
        if [[ "$top" != d && $found -eq 0 && "$prev" != '<' && "${s:i+1:1}" == '<' && "${s:i+2:1}" != '<' ]] &&
          [[ "${s:i+2}" =~ $GUARD_HEREDOC_DELIM ]]; then
          found=1
          GUARD_HD_HEAD=${s:0:i}
          GUARD_HD_DASH=${BASH_REMATCH[1]}
          GUARD_HD_QUOTE=${BASH_REMATCH[2]}
          GUARD_HD_DELIM=${BASH_REMATCH[3]}
          i=$((i + 2 + ${#BASH_REMATCH[0]}))
          GUARD_HD_TAIL=${s:i}
          # The quote closing a quoted delimiter opens nothing.
          [[ -n "$GUARD_HD_QUOTE" && "$GUARD_HD_QUOTE" != '\' && "${s:i:1}" == "$GUARD_HD_QUOTE" ]] && i=$((i + 1))
          continue
        fi
        ;;
    esac
    i=$((i + 1))
  done
  GUARD_HD_STATE="$st"
  ((found))
}

# guard_strip_heredocs — stdin to stdout.
guard_strip_heredocs() {
  local line delim="" body=0 state=""
  while IFS= read -r line; do
    if [[ $body -eq 1 ]]; then
      [[ "$line" =~ ^[[:space:]]*$delim[[:space:]]*$ ]] && {
        body=0
        delim=""
      }
      continue
    fi
    if guard_heredoc_opener "$line" "$state"; then
      delim="$GUARD_HD_DELIM"
      body=1
      line="${GUARD_HD_HEAD}<${GUARD_HD_QUOTE}${GUARD_HD_DELIM}${GUARD_HD_TAIL}"
    fi
    state="$GUARD_HD_STATE"
    printf '%s\n' "$line"
  done
  # The loop's own status is that last read, false at the end of every input.
  return 0
}

# guard_join_continuations — stdin to stdout. A line ending in an odd run of backslashes continues on
# the next one, and the shell runs the two as one line: judged apart, `git push \` and `--force` each
# looked harmless, while a quoted argument that opened a continuation line read as a command of its
# own. Runs after the heredoc pass, so a body line ending in a backslash cannot swallow its terminator.
# Inside single quotes the shell keeps a backslash-newline, and joining it there changes quoted text:
# a word split that way, `'.env.lo\⏎cal'`, reads joined. Rare enough to take.
GUARD_CONTINUED='(^|[^\])(\\\\)*\\$'
guard_join_continuations() {
  local line joined=""
  while IFS= read -r line; do
    if [[ "$line" =~ $GUARD_CONTINUED ]]; then
      joined+="${line%\\}"
      continue
    fi
    printf '%s\n' "$joined$line"
    joined=""
  done
  [[ -z "$joined" ]] || printf '%s\n' "$joined"
  return 0
}

# guard_mask_heredoc_bodies — stdin to stdout: a heredoc body is text, so its separators, backticks
# and quotes become \002 and an apostrophe in a message cannot open a quote; the openers, the
# terminators and the rest of the text stay as typed, line starts included. A body a shell reads
# (`bash <<EOF`, `cat <<EOF | sh`) stays as typed throughout.
guard_mask_heredoc_bodies() {
  local line delim="" body=0 state="" mode=""
  while IFS= read -r line; do
    if [[ $body -eq 1 ]]; then
      if [[ "$line" =~ ^[[:space:]]*$delim[[:space:]]*$ ]]; then
        body=0
        delim=""
      else
        case "$mode" in
          text) line="${line//[;&|()\`\'\"]/$'\002'}" ;;
          expanded) line="${line//[;&|\'\"]/$'\002'}" ;;
        esac
      fi
      printf '%s\n' "$line"
      continue
    fi
    if guard_heredoc_opener "$line" "$state"; then
      delim="$GUARD_HD_DELIM"
      body=1
      # A body a shell reads is a script, judged as typed. An unquoted delimiter leaves `$(…)` and
      # backticks to run, so those stay live in an otherwise masked body.
      if [[ "$line" =~ $GUARD_SHELL_STDIN ]]; then
        mode=script
      elif [[ -n "$GUARD_HD_QUOTE" ]]; then
        mode=text
      else
        mode=expanded
      fi
    fi
    state="$GUARD_HD_STATE"
    printf '%s\n' "$line"
  done
  return 0
}
