#!/bin/bash
# The line scanners lib.sh sources: heredocs and continuation lines, what the shell reads across a
# newline. Not a hook: lib.sh sources every lib-*.sh, the quote walker's too, before a scanner runs.
# --- the lines ----------------------------------------------------------------------------------

# An opener is a `<<` the shell reads as one, outside quotes and before a comment, so `echo "a << EOF"`
# hides no command after it. What follows the `<<`: 1 the `-` that strips a body's leading tabs, 2 the
# quote that keeps it literal, 3 the delimiter.
GUARD_HEREDOC_DELIM='^(-?)[[:space:]]*(["'"'"'\]?)([A-Za-z_][A-Za-z0-9_]*)'

# guard_heredoc_opener <line> [<state>] — the line's first opener, or 1: GUARD_HD_HEAD before `<<`,
# GUARD_HD_DASH, GUARD_HD_QUOTE, GUARD_HD_DELIM, and GUARD_HD_TAIL after the delimiter. GUARD_HD_STATE,
# the walk's stack at the line's end, is the next line's <state>, so `-m "$(cat <<'EOF'` opens one.
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

# guard_heredoc_substitutions <line> <state> — GUARD_HD_SUBS, each `$(…)` and backtick span a line of
# an unquoted body runs, as typed and joined by a space. <state> is where the line starts, H outside
# every substitution, and GUARD_QW_STATE where it ends, for the next line.
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

# guard_heredoc_feeds_shell — 0 when the heredoc guard_heredoc_opener just found is a script: its
# command, or one piped after it, is a shell reading stdin. `bash -s <<EOF` and `cat <<EOF | sh` run
# the body; `bash x.sh <<EOF` hands x.sh data and `cat <<EOF > x.sh` writes a file.
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
      [-+][oO] | [-+][A-Za-z]*[oO])
        [[ "${WORDS[j]}" == -*s* ]] && return 0
        j=$((j + 1))
        ;;
      -*s*) return 0 ;;
      [-+]*) ;;
      '<' | '>' | '>>' | [0-9]'>' | [0-9]'>>') j=$((j + 1)) ;;
      '<'* | '>'* | [0-9]'>'*) ;;
      *) return 1 ;;
    esac
  done
  return 0
}

# guard_strip_heredocs — stdin to stdout, each body dropped, since a file's lines are no commands, but
# for a body a shell reads and the substitutions an unquoted one runs. The opener stays, `<<` made
# `<`: a redirect on it is a real path, and no later pass reopens the body.
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

# guard_join_continuations — stdin to stdout, a line ending in an odd run of backslashes joined to the
# next, as the shell runs them; after the heredoc pass, so no body swallows its terminator. A `\⏎` in
# single quotes joins too, a gap taken; a line ending in a comment continues nothing.
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

# guard_mask_heredoc_bodies — stdin to stdout, a body's separators, backticks and quotes made \002, so
# an apostrophe opens no quote; the rest stays as typed. An unquoted body's substitutions stay live,
# masked as a command is, and a body a shell reads stays as typed throughout.
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
