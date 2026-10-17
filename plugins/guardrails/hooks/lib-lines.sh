#!/bin/bash
# The line scanners lib.sh sources — heredoc openers and bodies, continuation lines: what the shell
# reads across a newline. Not a hook and not sourced on its own: lib.sh sets the locale and
# GUARD_LIB_DIR first, then sources this file ahead of lib-text.sh, whose quote walker each scanner
# here reads a line with; it reads GUARD_HEREDOC_DELIM from here. Neither runs while being sourced.
# --- the lines ----------------------------------------------------------------------------------

# A heredoc BODY is the text of a file being written, not commands being run, and every guard
# matches line by line — so `npm install` inside one reads exactly like an invocation. That false
# refusal stops the agent from writing its own test fixtures, so bodies are dropped once, here. A
# body a shell reads as its script (`bash <<EOF`, `cat <<EOF | sh`) is commands, and stays.
# What the shell runs in a body stays: an unquoted delimiter leaves a `$(…)` or a backtick in it to
# run, so `cat <<EOF` / `$(cat .env.local)` / `EOF` reads the file before cat sees a line.
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
# sets GUARD_HD_STATE, guard_quote_walk's stack at the end of the line, to hand back as the next
# line's <state>: a `-m` body spanning lines is quoted from where it opened, and inside a `$(…)` the
# shell reads commands again even within double quotes, which is why `-m "$(cat <<'EOF'` opens.
guard_heredoc_opener() {
  local i n found=0
  GUARD_HD_HEAD="" GUARD_HD_DASH="" GUARD_HD_QUOTE="" GUARD_HD_DELIM="" GUARD_HD_TAIL=""
  guard_quote_walk "$1" 0 "${2:-P}"
  GUARD_HD_STATE="$GUARD_QW_STATE"
  n=${#GUARD_QW_KIND[@]}
  for ((i = 0; i < n; i++)); do
    if ((found)); then
      GUARD_HD_TAIL+=${GUARD_QW_TEXT[i]}
    elif [[ "${GUARD_QW_KIND[i]}" == h ]]; then
      found=1
      [[ "${GUARD_QW_TEXT[i]:2}" =~ $GUARD_HEREDOC_DELIM ]]
      GUARD_HD_DASH=${BASH_REMATCH[1]}
      GUARD_HD_QUOTE=${BASH_REMATCH[2]}
      GUARD_HD_DELIM=${BASH_REMATCH[3]}
    else
      GUARD_HD_HEAD+=${GUARD_QW_TEXT[i]}
    fi
  done
  ((found))
}

# guard_heredoc_substitutions <line> <state> — GUARD_HD_SUBS becomes the substitutions a line of an
# unquoted heredoc body runs, each `$(…)` and backtick span as typed, joined by a space, the text
# around them dropped. <state> is where the line starts, H outside every substitution, and
# GUARD_QW_STATE where it ends, for the next body line.
GUARD_HD_SUBS=""
guard_heredoc_substitutions() {
  local i n kind depth=$((${#2} - 1))
  GUARD_HD_SUBS=""
  if [[ "$2" == H && "$1" != *[\$\`]* ]]; then
    GUARD_QW_STATE=H
    return 0
  fi
  guard_quote_walk "$1" 0 "$2"
  n=${#GUARD_QW_KIND[@]}
  for ((i = 0; i < n; i++)); do
    kind=${GUARD_QW_KIND[i]}
    if [[ "$kind" == o? ]]; then
      [[ $depth -eq 0 && -n "$GUARD_HD_SUBS" ]] && GUARD_HD_SUBS+=" "
      depth=$((depth + 1))
    fi
    ((depth > 0)) && GUARD_HD_SUBS+=${GUARD_QW_TEXT[i]}
    [[ "$kind" == c? ]] && depth=$((depth - 1))
  done
  return 0
}

# guard_heredoc_feeds_shell — 0 when the heredoc guard_heredoc_opener just found is a script: the
# command holding its `<<`, or one piped after it, is a shell that reads its stdin. `bash <<EOF`,
# `bash -s <<EOF` and `cat <<EOF | sh` run the body; `bash x.sh <<EOF` hands x.sh data and
# `cat <<EOF > x.sh` writes a file.
guard_heredoc_feeds_shell() {
  local head tail piece consumer=1
  [[ "$GUARD_HD_HEAD$GUARD_HD_TAIL" == *sh* ]] || return 1
  tail=$GUARD_HD_TAIL
  [[ "$GUARD_HD_QUOTE" == [\'\"] ]] && tail=${tail#?}
  head=$(guard_pipelines "$(guard_mask_quoted_separators "$GUARD_HD_HEAD")" | tail -n 1)
  tail=$(guard_pipelines "$(guard_mask_quoted_separators "$tail")" | head -n 1)
  head=${head##*|}
  while IFS= read -r piece; do
    if ((consumer)); then
      piece="$head $piece"
      consumer=0
    fi
    guard_shell_reads_stdin "$piece" && return 0
  done < <(printf '%s\n' "$tail" | tr '|' '\n')
  return 1
}

# guard_shell_reads_stdin <command> — 0 when the command, wrappers off, is sh, bash, zsh, dash or ksh
# with no `-c` and no script operand, or with `-s`.
guard_shell_reads_stdin() {
  local -a WORDS=()
  local word j
  while IFS= read -r word; do WORDS+=("$word"); done < <(guard_words "$1")
  guard_unwrap_words
  case "${WORDS[0]:-}" in
    sh | bash | zsh | dash | ksh) ;;
    *) return 1 ;;
  esac
  for ((j = 1; j < ${#WORDS[@]}; j++)); do
    case "${WORDS[j]}" in
      --) return $((j + 1 < ${#WORDS[@]})) ;;
      --*) ;;
      [-+][oO]) j=$((j + 1)) ;;
      -*s*) return 0 ;;
      [-+]*) ;;
      '<' | '>' | '>>' | [0-9]'>' | [0-9]'>>') j=$((j + 1)) ;;
      '<'* | '>'* | [0-9]'>'*) ;;
      *) return 1 ;;
    esac
  done
  return 0
}

# guard_strip_heredocs — stdin to stdout. A body a shell reads (guard_heredoc_feeds_shell) is its
# script, so its lines stay as typed and are judged as the commands they are.
guard_strip_heredocs() {
  local line delim="" body=0 state="" expanded=0 inner="" script=0
  while IFS= read -r line; do
    if [[ $body -eq 1 ]]; then
      if [[ "$line" =~ ^[[:space:]]*$delim[[:space:]]*$ ]]; then
        body=0
        delim=""
      elif ((script)); then
        printf '%s\n' "$line"
      elif ((expanded)); then
        guard_heredoc_substitutions "$line" "$inner"
        inner="$GUARD_QW_STATE"
        [[ -z "$GUARD_HD_SUBS" ]] || printf '%s\n' "$GUARD_HD_SUBS"
      fi
      continue
    fi
    if guard_heredoc_opener "$line" "$state"; then
      delim="$GUARD_HD_DELIM"
      body=1
      expanded=0
      [[ -n "$GUARD_HD_QUOTE" ]] || expanded=1
      script=0
      guard_heredoc_feeds_shell && script=1
      inner=H
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
# a word split that way, `'.env.lo\⏎cal'`, reads joined. Rare enough to take. A comment ends at its
# newline, backslash or not, so a line whose last piece is a comment continues nothing; each line is
# walked from the top level, a quote opened on an earlier line unknown.
GUARD_CONTINUED='(^|[^\])(\\\\)*\\$'
guard_join_continuations() {
  local line joined=""
  while IFS= read -r line; do
    if [[ "$line" =~ $GUARD_CONTINUED ]] && ! guard_ends_in_comment "$joined$line"; then
      joined+="${line%\\}"
      continue
    fi
    printf '%s\n' "$joined$line"
    joined=""
  done
  [[ -z "$joined" ]] || printf '%s\n' "$joined"
  return 0
}

# guard_ends_in_comment <line> — 0 when the line's last piece is a comment.
guard_ends_in_comment() {
  [[ "$1" == *'#'* ]] || return 1
  guard_quote_walk "$1"
  [[ ${#GUARD_QW_KIND[@]} -gt 0 && "${GUARD_QW_KIND[${#GUARD_QW_KIND[@]} - 1]}" == tC ]]
}

# guard_mask_heredoc_bodies — stdin to stdout: a heredoc body is text, so its separators, backticks
# and quotes become \002 and an apostrophe in a message cannot open a quote; the openers, the
# terminators and the rest of the text stay as typed, line starts included. In an unquoted body a
# `$(…)` or a backtick runs, so those stay live and are masked as a command is. A body a shell reads
# (`bash <<EOF`, `cat <<EOF | sh`) stays as typed throughout.
guard_mask_heredoc_bodies() {
  local line delim="" body=0 state="" mode="" inner=""
  while IFS= read -r line; do
    if [[ $body -eq 1 ]]; then
      if [[ "$line" =~ ^[[:space:]]*$delim[[:space:]]*$ ]]; then
        body=0
        delim=""
      else
        case "$mode" in
          text) line="${line//[;&|()\`\'\"]/$'\002'}" ;;
          expanded)
            guard_quote_walk "$line" 1 "$inner"
            inner="$GUARD_QW_STATE"
            guard_mask_pieces
            line="$GUARD_MASKED"
            ;;
        esac
      fi
      printf '%s\n' "$line"
      continue
    fi
    if guard_heredoc_opener "$line" "$state"; then
      delim="$GUARD_HD_DELIM"
      body=1
      inner=H
      # A body a shell reads is a script, judged as typed.
      if guard_heredoc_feeds_shell; then
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
