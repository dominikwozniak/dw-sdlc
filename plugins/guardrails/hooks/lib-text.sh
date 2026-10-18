#!/bin/bash
# The text scanners lib.sh sources — the quote walker and what reads its pieces: quoted separators,
# substitutions, plain words. Not a hook and not sourced on its own: lib.sh sets the locale and
# GUARD_LIB_DIR first and sources lib-lines.sh, then this file, lib-live.sh and lib-words.sh, whose
# live-quote readers, word reader, escape decoders and GUARD_LIVE_QUOTE the scanners here call only
# once every file is sourced.
# --- the quotes ---------------------------------------------------------------------------------

# guard_quote_walk <text> [<live>] [<state>] [<from>] [<stop>] — the one reader of shell quoting: the
# mask, the substitution split, the heredoc opener and the heredoc body passes are each a loop over
# the pieces it leaves, GUARD_QW_KIND[i] and GUARD_QW_TEXT[i], whose texts joined are the text again.
# A kind:
#   t<c>  text read in context <c>        e<c>  a backslash and the character it keeps
#   o<c>  what opens context <c>          c<c>  what closes it
#   tC    a comment, up to the newline    h     a heredoc operator and its delimiter
# The contexts: P the top level, S and D a single- and a double-quoted span, A an ANSI-C `$'…'` span,
# where a backslash escapes and the next `'` closes, U a `$(…)`, V a bare `(` inside one, B a backtick
# substitution, H an unquoted heredoc body, where only a substitution and a backslash act, E a `${…}`,
# where a quote nests even inside a `"…"`, a `(` and a `#` are text and the first bare `}` closes it.
# A `$'` opens A wherever a `'` would open S; a `$"…"` is a double-quoted span after a `$` of text; a
# `$` before anything else is text. With <live> set, a quote after a shell's `-c`, `eval` or `rtk run`
# opens s, d or a instead, a quote that holds a command; in a, a backslash still escapes, so a `\'`
# there is text the walk does not follow. A `${…}` in d opens e: the outer shell expands it and hands
# the shell what it expands to, so its text holds the command too, and a `"…"`, `'…'` or `$'…'` in it
# opens d, s or a. The outer shell drops those quotes, all but a `'…'` that bash 3.2 and a `:-` keep,
# where reading it as a command refuses more, not less. A comment and a heredoc operator count only
# where the shell reads a command: in P, U, V and B.
# GUARD_QW_STATE is the stack the text ends in, one context per character, starting from <state>, P by
# default; the walk returns 1 when it ends elsewhere, a quote or substitution left open. It jumps from
# one character that can change the context to the next, so a long quoted body costs a step per
# quote, backslash and substitution, not one per character.
# The walk starts at offset <from>, 0 by default, with the text before it read as what precedes it.
# <stop> ends it early: `o` just after a quote handed to a shell opens, `c` just after the context it
# starts in closes. GUARD_QW_END is the offset it stops at.
GUARD_QW_KIND=()
GUARD_QW_TEXT=()
GUARD_QW_STATE=""
GUARD_QW_END=0
guard_quote_walk() {
  local text="$1" live="${2:-0}" st="${3:-P}" from="${4:-0}" stop="${5:-}"
  local rest total=${#1} top run ch kind len quote pre prev="" depth=${#st}
  rest=${text:from}
  ((from > 0)) && prev=${text:from-1:1}
  GUARD_QW_KIND=()
  GUARD_QW_TEXT=()
  while [[ -n "$rest" ]]; do
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
      prev=${run:${#run}-1}
      [[ -n "$rest" ]] || break
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
              ((live)) && guard_qw_live "$text" $((total - ${#rest})) && kind=oa
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
            ((live)) && guard_qw_live "$text" $((total - ${#rest})) && kind=os
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
            pre=$((total - ${#rest}))
            ((pre > 0)) && [[ "${text:pre-1:1}" == '$' ]] && pre=$((pre - 1))
            ((live)) && guard_qw_live "$text" "$pre" && kind=od
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
    rest=${rest:len}
    # The quote closing a quoted delimiter opens nothing.
    if [[ -n "$quote" && "$quote" != '\' && "${rest:0:1}" == "$quote" ]]; then
      guard_qw_piece "t$top" "$quote"
      rest=${rest:1}
    fi
    case "$stop$kind" in
      oo[sad]) break ;;
      cc?) ((${#st} < depth)) && break ;;
    esac
  done
  GUARD_QW_STATE=$st
  GUARD_QW_END=$((total - ${#rest}))
  [[ "$st" == "${3:-P}" ]]
}

# guard_qw_live <text> <offset> — 0 when the text before <offset> ends where a quote is handed to a
# shell, GUARD_LIVE_QUOTE. Past its first character a match holds only letters, `_`, `+`, `-`, `<` and
# whitespace, so the last 128 characters decide it whenever one of them is anything else; only a
# longer run of those is read in full. A long command then costs a step per quote, not one per
# character before it.
guard_qw_live() {
  local pre
  if (($2 > 128)); then
    pre=${1:$2-128:128}
    if [[ "$pre" == *[!A-Za-z_+\<[:space:]-]* ]]; then
      [[ "$pre" =~ $GUARD_LIVE_QUOTE ]]
      return
    fi
  fi
  [[ "${1:0:$2}" =~ $GUARD_LIVE_QUOTE ]]
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

# guard_mask_quoted_separators <command> — `;` `&` `|` `(` `)` and a backtick inside a quoted span are
# text, not separators, so they become \002 and cannot open a command boundary: `git commit -m "docs:
# never | git push --force"` is a message, not a push. The quotes themselves stay, so the boundary's
# optional quote still matches `rtk run "npm install"`, where the quoted text really is the command.
# What runs stays unmasked: a `$(…)` or a backtick substitution inside double quotes, and a quote
# handed to a shell's `-c`, `eval` or `rtk run`, so `bash -c "cd x && git reset --hard"` keeps its
# `&&`. Such a quote ends where the outer shell ends it: where guard_live_walk finds the walk reads it
# otherwise, its body is masked as a command of its own. A comment is text, and so is a heredoc body
# but for the substitutions an unquoted one runs. An unterminated quote or substitution hands back the
# original — fail closed, judge what was typed.
guard_mask_quoted_separators() {
  local s="$1" st=P from=0 n kind out=""
  if [[ "$s" == *'<<'* ]]; then
    s=$(printf '%s\n' "$s" | guard_mask_heredoc_bodies)
  fi
  while :; do
    guard_quote_walk "$s" 1 "$st" "$from" o
    guard_mask_pieces
    out+=$GUARD_MASKED
    st=$GUARD_QW_STATE
    from=$GUARD_QW_END
    n=${#GUARD_QW_KIND[@]}
    ((n > 0)) && [[ "${GUARD_QW_KIND[n - 1]}" == o[sad] ]] || break
    kind=${GUARD_QW_KIND[n - 1]}
    st=${st%?}
    guard_live_walk "$s" "$st" "$from" "$kind"
    case $? in
      0)
        guard_mask_pieces 0 $((GUARD_LIVE_END + 1))
        out+=$GUARD_MASKED
        ;;
      1)
        st=x
        break
        ;;
      *)
        guard_mask_live_text
        out+=$GUARD_MASKED${GUARD_QW_TEXT[GUARD_LIVE_END]}
        ;;
    esac
    from=$((from + GUARD_LIVE_LEN))
  done
  if [[ "$st" != P ]]; then
    printf '%s' "$s"
  else
    printf '%s' "$out"
  fi
}

# guard_mask_live_text — GUARD_LIVE_TEXT, the text a quote hands a shell, masked as the command it is
# into GUARD_MASKED. A newline a `$'…'` hands on ends a command, as guard_mask_pieces reads a `\n` in
# one. A text with no quote, escape, substitution, comment or heredoc has nothing to mask.
guard_mask_live_text() {
  local text=$GUARD_LIVE_TEXT
  [[ "$GUARD_LIVE_CTX" == A ]] && text=${text//$'\n'/;}
  if [[ "$text" == *[\'\"\`\$\\#\<]* ]]; then
    # The dot keeps the text's trailing newlines from the command substitution.
    text=$(guard_mask_quoted_separators "$text" && printf .)
    text=${text%.}
  fi
  GUARD_MASKED=$text
}

# guard_mask_pieces [<from> [<to>]] — the walk's pieces, all of them or those from <from> up to
# <to>, joined into GUARD_MASKED, `;` `&` `|` `(` `)` and a backtick made \002 wherever they are text:
# a quoted span, a `${…}`, a comment, an escape. A newline in a quoted span is text too, so a line of a
# multi-line message never starts a line of its own. In the text of an unquoted heredoc body the
# quotes and a `#` go too, so a walk of the whole command finds none of them there.
GUARD_MASKED=""
guard_mask_pieces() {
  local i n=${2:-${#GUARD_QW_KIND[@]}} piece
  GUARD_MASKED=""
  for ((i = ${1:-0}; i < n; i++)); do
    piece=${GUARD_QW_TEXT[i]}
    case "${GUARD_QW_KIND[i]}" in
      tS | tA | tC)
        guard_replace_set "$piece" $';&|()`\n' $'\002'
        piece=$GUARD_REPLACED
        ;;
      tD | tE)
        guard_replace_set "$piece" $';&|()\n' $'\002'
        piece=$GUARD_REPLACED
        ;;
      tH)
        guard_replace_set "$piece" ";&|()'\"#" $'\002'
        piece=$GUARD_REPLACED
        ;;
      ea)
        # A `$'…'` handed to a shell hands it the decoded text, where a newline ends a command.
        guard_ansi_escape "${piece:1}"
        piece=$GUARD_ANSI_CHAR
        [[ "$piece" == $'\n' ]] && piece=';'
        ;;
      e?)
        case "${piece:1:1}" in
          ';' | '&' | '|' | '(' | ')' | '`') piece="\\"$'\002' ;;
        esac
        ;;
    esac
    GUARD_MASKED+=$piece
  done
}

# guard_strip_quoted <command> — what a path or token check scans: heredoc bodies dropped but for
# the substitutions an unquoted one runs, then each segment's plain words, so prose in a commit
# message never reads as a file while `cat ".env.local"` still names one. In a search tool's segment
# every quoted word is dropped, because there a quoted word is the pattern: `grep -rn ".env.local"
# src` looks for the name and opens no such file. A substitution the shell runs, `"$(cat .env.local)"`
# included, is read as a command of its own, so its words count even inside double quotes while the
# prose around it stays prose. A quote handed to a shell's `-c`, `eval` or `rtk run` is read the same
# way, and a comment runs nothing, so its words are dropped. The first line holds the command's own
# words, each line after it the words of one substitution or one quote that holds a command.
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

# guard_split_substitutions <text> — the text with every `$(…)` and backtick substitution replaced by
# `_`, then the body of each substitution, one per line; a nested one is split out of its parent the
# same way, and a comment is dropped. Single quotes keep a `$(` literal and double quotes do not. A
# quote handed to a shell's `-c`, `eval` or `rtk run` is replaced by `_` too, and guard_live_body's
# lines follow, read where the outer shell ends the quote. Each line is folded to one, its newlines
# spaces. An unterminated quote or substitution hands back the text as typed.
guard_split_substitutions() {
  local s="$1" st=P from=0 i n kind piece depth=0 buf="" bodies=""
  # The text of each enclosing substitution while a nested one is read.
  local -a outer=()
  while :; do
    guard_quote_walk "$s" 1 "$st" "$from" o
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
    if ! guard_live_body "$s" "$st" "$from" "$kind"; then
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

# guard_search_segment <segment> — 0 when the segment, wrappers off, runs grep, egrep, fgrep, rg, ag,
# ack or git grep. The command word sits at the start, so only the first 256 bytes are scanned: a long
# message further on would cost a character loop for nothing.
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

# guard_plain_words <text> — the text's shell words with the quotes gone, joined by one space, and
# every word that holds whitespace dropped: only a quoted span puts whitespace into a word, and a
# quoted span with whitespace is prose — a message, a pattern, a sentence. A quoted word without
# whitespace is a word like any other: `'db:drop'` and `"$HOME/.ssh/id_rsa"` are what the shell
# passes on. The costs: a quoted path holding a space reads as prose, so `cat "my dir/.env"` passes,
# and outside the search tools guard_strip_quoted knows, a quoted word that is exactly a guarded name
# reads as that file. An unterminated quote hands back the text as typed — fail closed, judge what was
# typed.
guard_plain_words() {
  local words word plain=""
  words=$(guard_words "$1") || {
    printf '%s' "$1"
    return 0
  }
  while IFS= read -r word; do
    [[ -n "$word" && "$word" != *[[:space:]]* ]] && plain+="${plain:+ }$word"
  done <<<"$words"
  printf '%s' "$plain"
}
