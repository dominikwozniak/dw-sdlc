#!/bin/bash
# The text scanners lib.sh sources: the quote walker and what reads its pieces. Not a hook: lib.sh
# sources every lib-*.sh before a scanner runs, so the files call each other freely.
# --- the quotes ---------------------------------------------------------------------------------

# guard_quote_walk <text> [<live>] [<state>] [<from>] [<stop>] — the one reader of shell quoting: the
# text cut into pieces, GUARD_QW_KIND[i] and GUARD_QW_TEXT[i], whose texts joined are the text again.
# Its kinds, contexts, arguments and costs are in README.md#the-quote-walker.
GUARD_QW_KIND=()
GUARD_QW_TEXT=()
GUARD_QW_STATE=""
GUARD_QW_END=0
GUARD_QW_WINDOW=1024
GUARD_QW_SRC=""
guard_quote_walk() {
  local GUARD_QW_SRC="$1"
  guard_qw_walk "${#1}" "${@:2}"
}

# guard_qw_walk <end> [<live>] [<state>] [<from>] [<stop>] — guard_quote_walk over GUARD_QW_SRC, cut
# at <end>: an argument costs its length in bash 3.2, so a loop of walks sets the text once, in a local
# a nested walk leaves as it was. It reads its window and the 512 characters before, for guard_qw_live.
guard_qw_walk() {
  local live="${2:-0}" st="${3:-P}" from="${4:-0}" stop="${5:-}"
  local around base=0 rest pos=${4:-0} wend total=$1 top run ch kind len quote prev="" depth=${#st} behind=""
  ((from > 512)) && base=$((from - 512))
  wend=$((from + GUARD_QW_WINDOW < total ? from + GUARD_QW_WINDOW : total))
  around=${GUARD_QW_SRC:base:wend-base}
  rest=${around:from-base}
  ((from > 0)) && prev=${around:from-base-1:1}
  # What a live quote is judged on: the text before it, kept to a tail guard_qw_live reads alike.
  if ((live)); then
    behind=${around:0:from-base}
    ((from > 512)) && [[ "${behind:0:511}" != *$GUARD_QW_NOT_LIVE* ]] && behind=${GUARD_QW_SRC:0:from}
  fi
  GUARD_QW_KIND=()
  GUARD_QW_TEXT=()
  while :; do
    # Refilled while 300 characters are left, more than the longest look ahead, a heredoc delimiter.
    if ((wend - pos < 300 && wend < total || wend - pos > GUARD_QW_WINDOW)); then
      wend=$((pos + GUARD_QW_WINDOW < total ? pos + GUARD_QW_WINDOW : total))
      rest=${GUARD_QW_SRC:pos:wend-pos}
    fi
    [[ -n "$rest" ]] || break
    if ((live && ${#behind} > 1024)) && [[ "${behind:${#behind}-512:511}" == *$GUARD_QW_NOT_LIVE* ]]; then
      behind=${behind:${#behind}-512}
    fi
    top=${st:${#st}-1}
    case "$top" in
      S) run=${rest%%\'*} ;;
      A) run=${rest%%[\'\\]*} ;;
      D) run=${rest%%[\"\\\`\$]*} ;;
      H) run=${rest%%[\\\`\$]*} ;;
      E | e) run=${rest%%[\"\'\\\`\$\}]*} ;;
      *) run=${rest%%[\"\'\\\`\$\(\)#\<]*} ;;
    esac
    if [[ -n "$run" ]]; then
      guard_qw_piece "t$top" "$run"
      rest=${rest:${#run}}
      pos=$((pos + ${#run}))
      prev=${run:${#run}-1}
      ((live)) && behind+=$run
      continue
    fi
    # Only a character that can change the context is left at the front; by default it is text.
    ch=${rest:0:1}
    kind="t$top"
    len=1
    quote=""
    case "$ch" in
      '\')
        kind="e$top"
        len=2
        # An escape in a `$'…'` is one piece, `\x3b` whole.
        if [[ "$top" == [Aa] ]]; then
          guard_ansi_escape "${rest:1:9}"
          len=$((1 + GUARD_ANSI_LEN))
        fi
        ;;
      '$')
        case "${rest:1:1}" in
          # `$$` is the shell's pid, so a `(` or `'` after the pair opens nothing.
          '$') len=2 ;;
          '(') kind=oU len=2 ;;
          '{')
            if [[ "$top" != H ]]; then
              kind=oE
              len=2
              [[ "$top" == [de] ]] && kind=oe
            fi
            ;;
          "'")
            if [[ "$top" == [PUVBdEe] ]]; then
              kind=oA
              len=2
              ((live)) && guard_qw_live "$behind" && kind=oa
              [[ "$top" == e ]] && kind=oa
            fi
            ;;
        esac
        ;;
      '`') if [[ "$top" == B ]]; then kind=cB; else kind=oB; fi ;;
      "'")
        case "$top" in
          S | s | A | a) kind="c$top" ;;
          d | E) kind=oS ;;
          e) kind=os ;;
          *)
            kind=oS
            ((live)) && guard_qw_live "$behind" && kind=os
            ;;
        esac
        ;;
      '"')
        case "$top" in
          D | d) kind="c$top" ;;
          e) kind=od ;;
          *)
            # A `$"…"` handed to a shell is live as a `"…"` is.
            kind=oD
            if ((live)); then
              if [[ "$behind" == *'$' ]]; then
                guard_qw_live "${behind%?}" && kind=od
              else
                guard_qw_live "$behind" && kind=od
              fi
            fi
            ;;
        esac
        ;;
      '(') [[ "$top" == [UV] ]] && kind=oV ;;
      ')') [[ "$top" == [UV] ]] && kind="c$top" ;;
      '}') [[ "$top" == [Ee] ]] && kind="c$top" ;;
      '#')
        # A comment starts a word and runs to the end of the line.
        if [[ "$top" == [PUVB] ]]; then
          case "$prev" in
            '' | ' ' | $'\t' | $'\n' | ';' | '&' | '|' | '(' | ')')
              run=${rest%%$'\n'*}
              # A comment longer than the window is read from the text itself.
              if [[ "$run" == "$rest" ]] && ((wend < total)); then
                rest=${GUARD_QW_SRC:pos:total-pos}
                wend=$total
                run=${rest%%$'\n'*}
              fi
              kind=tC
              len=${#run}
              ;;
          esac
        fi
        ;;
      '<')
        # `<<` and what follows it: 1 the `-`, 2 the quote, 3 the delimiter. A `<<<` is a here-string.
        if [[ "$top" == [PUVB] && "$prev" != '<' && "${rest:1:1}" == '<' && "${rest:2:1}" != '<' ]] &&
          [[ "${rest:2:256}" =~ $GUARD_HEREDOC_DELIM ]]; then
          kind=h
          len=$((2 + ${#BASH_REMATCH[0]}))
          quote=${BASH_REMATCH[2]}
        fi
        ;;
    esac
    guard_qw_piece "$kind" "${rest:0:len}"
    case "$kind" in
      o?) st+=${kind:1} ;;
      c?) st=${st%?} ;;
    esac
    # An escaped character is part of a word, so a `#` after it opens no comment.
    if [[ "$kind" == e? ]]; then prev=x; else prev=${rest:len-1:1}; fi
    ((live)) && behind+=${rest:0:len}
    rest=${rest:len}
    pos=$((pos + len))
    # The quote closing a quoted delimiter opens nothing.
    if [[ -n "$quote" && "$quote" != '\' && "${rest:0:1}" == "$quote" ]]; then
      guard_qw_piece "t$top" "$quote"
      ((live)) && behind+=$quote
      rest=${rest:1}
      pos=$((pos + 1))
    fi
    case "$stop$kind" in
      oo[sad]) break ;;
      cc?) ((${#st} < depth)) && break ;;
    esac
  done
  GUARD_QW_STATE=$st
  # A backslash that ends the text takes one character, not two.
  ((pos > total)) && pos=$total
  GUARD_QW_END=$pos
  [[ "$st" == "${3:-P}" ]]
}

# guard_qw_live <before> — 0 when the text before a quote ends in GUARD_LIVE_QUOTE. Past its first
# character a match holds no GUARD_QW_NOT_LIVE character, so any tail holding one decides: the last
# 128 characters do unless none is there, and a long command costs a step per quote.
GUARD_QW_NOT_LIVE='[!A-Za-z_+<[:space:]-]'
guard_qw_live() {
  local pre=$1
  ((${#pre} > 128)) && pre=${pre:${#pre}-128}
  [[ "$pre" == *$GUARD_QW_NOT_LIVE* ]] || pre=$1
  [[ "$pre" =~ $GUARD_LIVE_QUOTE ]]
}

# guard_qw_piece <kind> <text> — appends a piece; text after text of the same kind joins it.
guard_qw_piece() {
  local n=${#GUARD_QW_KIND[@]}
  if [[ "$1" == t* && $n -gt 0 && "${GUARD_QW_KIND[n-1]}" == "$1" ]]; then
    GUARD_QW_TEXT[n-1]+=$2
  else
    GUARD_QW_KIND[n]=$1
    GUARD_QW_TEXT[n]=$2
  fi
}

# guard_replace_set <text> <set> <char> — GUARD_REPLACED becomes the text with every character of
# <set> turned into <char>. bash 3.2 takes seconds for a `${text//[set]/…}` over a 29 KB body, so a
# long text goes through tr, a fork of a few milliseconds.
GUARD_REPLACED=""
guard_replace_set() {
  if ((${#1} < 256)); then
    GUARD_REPLACED=${1//[$2]/$3}
    return 0
  fi
  # The dot keeps the text's trailing newlines from the command substitution.
  GUARD_REPLACED=$(printf '%s.' "$1" | tr "$2" "$3")
  GUARD_REPLACED=${GUARD_REPLACED%.}
}

# --- the text -----------------------------------------------------------------------------------

# guard_strip_quoted <command> — the words a path check scans, prose and heredoc bodies off, by the
# rules in README.md#paths-in-a-command: the first line the command's own words, each line after it
# those of one substitution or one quote that holds a command.
GUARD_SEARCH_WORD='(^|[^A-Za-z0-9_.-])(rg|ag|ack)([[:space:]]|$)'
guard_strip_quoted() {
  local text line
  text=$(printf '%s\n' "$1" | guard_strip_heredocs)
  if ! guard_runs_inside "$text"; then
    guard_replace_set "$text" $'\n' ' '
    guard_strip_quoted_text "$GUARD_REPLACED"
    return 0
  fi
  while IFS= read -r line; do
    guard_strip_quoted_text "$line"
  done < <(guard_split_substitutions "$text")
}

# guard_split_substitutions <text> — the text with each `$(…)`, backtick span and live quote made `_`,
# then each one's body a line, nested ones split out alike, comments dropped, newlines made spaces. An
# unterminated quote or substitution hands back the text as typed.
guard_split_substitutions() {
  local GUARD_QW_SRC="$1" st=P from=0 i n kind piece depth=0 buf="" bodies="" total=${#1}
  # The text of each enclosing substitution while a nested one is read.
  local -a outer=()
  while :; do
    guard_qw_walk "$total" 1 "$st" "$from" o
    n=${#GUARD_QW_KIND[@]}
    kind=""
    for ((i = 0; i < n; i++)); do
      kind=${GUARD_QW_KIND[i]}
      piece=${GUARD_QW_TEXT[i]}
      case "$kind" in
        oU | oB)
          outer[depth]=$buf
          depth=$((depth + 1))
          buf=""
          ;;
        cU | cB)
          guard_replace_set "$buf" $'\n' ' '
          bodies+="$GUARD_REPLACED"$'\n'
          depth=$((depth - 1))
          buf="${outer[depth]}_"
          ;;
        tC | os | oa | od) ;;
        *) buf+=$piece ;;
      esac
    done
    st=$GUARD_QW_STATE
    from=$GUARD_QW_END
    [[ "$kind" == o[sad] ]] || break
    st=${st%?}
    if ! guard_live_body "$total" "$st" "$from" "$kind"; then
      st=x
      break
    fi
    bodies+=$GUARD_LIVE_LINES
    buf+=_
    from=$((from + GUARD_LIVE_LEN))
  done
  if [[ "$st" != P ]]; then
    guard_replace_set "$1" $'\n' ' '
    printf '%s\n' "$GUARD_REPLACED"
    return 0
  fi
  guard_replace_set "$buf" $'\n' ' '
  printf '%s\n%s' "$GUARD_REPLACED" "$bodies"
}

# guard_strip_quoted_text <folded> — guard_strip_quoted for one line of text that holds no
# substitution: each segment's plain words, quoted words dropped in a search tool's segment, and a
# newline.
guard_strip_quoted_text() {
  local folded="$1" segment
  # Most commands name no search tool, and one pass over the whole text is all they need.
  if [[ "$folded" != *grep* && ! "$folded" =~ $GUARD_SEARCH_WORD ]]; then
    guard_plain_words "$folded"
    printf '\n'
    return 0
  fi
  while IFS= read -r segment; do
    if guard_search_segment "$segment"; then
      segment=$(printf '%s' "$segment" | sed -E 's/"[^"]*"//g' | sed -E "s/'[^']*'//g")
    fi
    printf '%s ' "$(guard_plain_words "$segment")"
  done < <(guard_segments "$(guard_mask_quoted_separators "$folded")")
  printf '\n'
}

# guard_search_segment <segment> — 0 when the segment, launchers off, runs grep, egrep, fgrep, rg, ag,
# ack or git grep. The command word sits at the start, so only the first 256 bytes are scanned: a long
# message further on would cost a walk for nothing.
guard_search_segment() {
  local word head="${1:0:256}"
  WORDS=()
  while IFS= read -r word; do WORDS+=("$word"); done < <(guard_words "$head")
  guard_unwrap_words
  [[ ${#WORDS[@]} -gt 0 ]] || return 1
  case "${WORDS[0]}" in
    grep | egrep | fgrep | rg | ag | ack) return 0 ;;
    git) guard_git_verb "$head" && [[ "$GUARD_GIT_VERB" == grep ]] ;;
    *) return 1 ;;
  esac
}

# guard_plain_words <text> — the text's shell words, quotes off, joined by a space, each word holding
# whitespace dropped as prose; its costs are in README.md#paths-in-a-command. An unterminated quote
# hands back the text as typed: fail closed.
guard_plain_words() {
  local word plain=""
  if ! guard_split_words "$1"; then
    printf '%s' "$1"
    return 0
  fi
  for word in "${GUARD_WORDS[@]+"${GUARD_WORDS[@]}"}"; do
    [[ -n "$word" && "$word" != *[[:space:]]* ]] && plain+="${plain:+ }$word"
  done
  printf '%s' "$plain"
}
