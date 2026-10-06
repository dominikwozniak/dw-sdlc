#!/bin/bash
# The text scanners lib.sh sources — the quote walker and what reads its pieces: quoted separators,
# substitutions, words, the wrapper boundary every guard's pattern sees through. Not a hook and not
# sourced on its own: lib.sh sets the locale and GUARD_LIB_DIR first and sources lib-lines.sh, then
# this file.
# --- the quotes ---------------------------------------------------------------------------------

# guard_quote_walk <text> [<live>] [<state>] — the one reader of shell quoting: the mask, the
# substitution split, the heredoc opener and the heredoc body passes are each a loop over the pieces
# it leaves, GUARD_QW_KIND[i] and GUARD_QW_TEXT[i], whose texts joined are the text again. A kind:
#   t<c>  text read in context <c>        e<c>  a backslash and the character it keeps
#   o<c>  what opens context <c>          c<c>  what closes it
#   tC    a comment, up to the newline    h     a heredoc operator and its delimiter
# The contexts: P the top level, S and D a single- and a double-quoted span, A an ANSI-C `$'…'` span,
# where a backslash escapes and the next `'` closes, U a `$(…)`, V a bare `(` inside one, B a backtick
# substitution, H an unquoted heredoc body, where only a substitution and a backslash act. A `$'` opens
# A wherever a `'` would open S; a `$"…"` is a double-quoted span after a `$` of text. With <live>
# set, a quote after a shell's `-c`, `eval` or `rtk run` opens s or d instead, a quote that holds a
# command. A comment and a heredoc operator count only where the shell reads a command: in P, U, V
# and B. GUARD_QW_STATE is the stack the text ends in, one context per character, starting from
# <state>, P by default; the walk returns 1 when it ends elsewhere, a quote or substitution left open.
# It jumps from one character that can change the context to the next, so a long quoted body costs a
# step per quote, backslash and substitution, not one per character.
GUARD_QW_KIND=()
GUARD_QW_TEXT=()
GUARD_QW_STATE=""
guard_quote_walk() {
  local text="$1" live="${2:-0}" st="${3:-P}"
  local rest="$1" total=${#1} top run ch kind len quote prev=""
  GUARD_QW_KIND=()
  GUARD_QW_TEXT=()
  while [[ -n "$rest" ]]; do
    top=${st:${#st}-1}
    case "$top" in
      S) run=${rest%%\'*} ;;
      A) run=${rest%%[\'\\]*} ;;
      D) run=${rest%%[\"\\\`\$]*} ;;
      H) run=${rest%%[\\\`\$]*} ;;
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
        ;;
      '$')
        case "${rest:1:1}" in
          # `$$` is the shell's pid, so a `(` or `'` after the pair opens nothing.
          '$') len=2 ;;
          '(') kind=oU len=2 ;;
          "'") [[ "$top" == [PUVBd] ]] && kind=oA len=2 ;;
        esac
        ;;
      '`') if [[ "$top" == B ]]; then kind=cB; else kind=oB; fi ;;
      "'")
        case "$top" in
          S | s | A) kind="c$top" ;;
          d) kind=oS ;;
          *)
            kind=oS
            ((live)) && [[ "${text:0:total-${#rest}}" =~ $GUARD_LIVE_QUOTE ]] && kind=os
            ;;
        esac
        ;;
      '"')
        case "$top" in
          D | d) kind="c$top" ;;
          *)
            kind=oD
            ((live)) && [[ "${text:0:total-${#rest}}" =~ $GUARD_LIVE_QUOTE ]] && kind=od
            ;;
        esac
        ;;
      '(') [[ "$top" == [UV] ]] && kind=oV ;;
      ')') [[ "$top" == [UV] ]] && kind="c$top" ;;
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
  done
  GUARD_QW_STATE=$st
  [[ "$st" == "${3:-P}" ]]
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
# `&&`. A comment is text, and so is a heredoc body but for the substitutions an unquoted one runs.
# An unterminated quote or substitution hands back the original — fail closed, judge what was typed.
guard_mask_quoted_separators() {
  local s="$1"
  if [[ "$s" == *'<<'* ]]; then
    s=$(printf '%s\n' "$s" | guard_mask_heredoc_bodies)
  fi
  if guard_quote_walk "$s" 1; then
    guard_mask_pieces
    printf '%s' "$GUARD_MASKED"
  else
    printf '%s' "$s"
  fi
}

# guard_mask_pieces — the walk's pieces joined into GUARD_MASKED, `;` `&` `|` `(` `)` and a backtick
# made \002 wherever they are text: a quoted span, a comment, an escape. In the text of an unquoted
# heredoc body the quotes and a `#` go too, so a walk of the whole command finds none of them there.
GUARD_MASKED=""
guard_mask_pieces() {
  local i n=${#GUARD_QW_KIND[@]} piece
  GUARD_MASKED=""
  for ((i = 0; i < n; i++)); do
    piece=${GUARD_QW_TEXT[i]}
    case "${GUARD_QW_KIND[i]}" in
      tS | tA | tC)
        guard_replace_set "$piece" ';&|()`' $'\002'
        piece=$GUARD_REPLACED
        ;;
      tD)
        guard_replace_set "$piece" ';&|()' $'\002'
        piece=$GUARD_REPLACED
        ;;
      tH)
        guard_replace_set "$piece" ";&|()'\"#" $'\002'
        piece=$GUARD_REPLACED
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
# prose around it stays prose; a comment runs nothing and its words are dropped. The first line holds
# the command's own words, each line after it the words of one substitution.
GUARD_SEARCH_WORD='(^|[^A-Za-z0-9_.-])(rg|ag|ack)([[:space:]]|$)'
guard_strip_quoted() {
  local text line
  text=$(printf '%s\n' "$1" | guard_strip_heredocs)
  if [[ "$text" != *'$('* && "$text" != *'`'* && "$text" != *'#'* ]]; then
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
# same way, and a comment is dropped. Single quotes keep a `$(` literal and double quotes do not; a
# quote handed to `bash -c` stays one quoted word here, as prose does. Each line is folded to one, its
# newlines spaces. An unterminated quote or substitution hands back the text as typed.
guard_split_substitutions() {
  local i n buf="" depth=0 bodies=""
  # The text of each enclosing substitution while a nested one is read.
  local -a outer=()
  if ! guard_quote_walk "$1"; then
    guard_replace_set "$1" $'\n' ' '
    printf '%s\n' "$GUARD_REPLACED"
    return 0
  fi
  n=${#GUARD_QW_KIND[@]}
  for ((i = 0; i < n; i++)); do
    case "${GUARD_QW_KIND[i]}" in
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
      tC) ;;
      *) buf+=${GUARD_QW_TEXT[i]} ;;
    esac
  done
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

# guard_tokens <text> — one token per line, split on whitespace and shell punctuation.
guard_tokens() {
  printf '%s\n' "$1" | tr -s "[:space:];|&()<>=\`\"'" '\n' | sed '/^$/d'
}

# guard_words <segment> — the segment split into words the way a shell would, one per line: whitespace
# separates, quotes group and are dropped, the `$` of a `$'…'` or a `$"…"` with them, a backslash
# keeps the next character, and in a `$'…'` stands for what bash decodes it to. For one command's
# arguments, where `-C 'my repo'` must stay one word; a segment holds no newline. Returns 1 when a quote is left open, after printing what it read.
guard_words() {
  local s="$1"
  local n=${#s}
  local i=0 ch word="" have=0 state=plain
  while ((i < n)); do
    ch=${s:i:1}
    if [[ "$ch" == '\' && "$state" == ansi ]]; then
      guard_ansi_escape "${s:i+1:9}"
      word+=$GUARD_ANSI_CHAR
      i=$((i + 1 + GUARD_ANSI_LEN))
      continue
    fi
    if [[ "$ch" == '\' && "$state" != sq ]]; then
      i=$((i + 1))
      ((i < n)) && word+=${s:i:1}
      have=1
      i=$((i + 1))
      continue
    fi
    case "$state" in
      plain)
        case "$ch" in
          "'") state=sq; have=1 ;;
          '"') state=dq; have=1 ;;
          '$')
            case "${s:i+1:1}" in
              '$')
                word+='$$'
                i=$((i + 1))
                ;;
              "'")
                state=ansi
                i=$((i + 1))
                ;;
              '"')
                state=dq
                i=$((i + 1))
                ;;
              *) word+=$ch ;;
            esac
            have=1
            ;;
          ' ' | $'\t')
            ((have)) && printf '%s\n' "$word"
            word=""
            have=0
            ;;
          *) word+=$ch; have=1 ;;
        esac
        ;;
      sq | ansi) if [[ "$ch" == "'" ]]; then state=plain; else word+=$ch; fi ;;
      dq) if [[ "$ch" == '"' ]]; then state=plain; else word+=$ch; fi ;;
    esac
    i=$((i + 1))
  done
  ((have)) && printf '%s\n' "$word"
  [[ "$state" == plain ]]
}

# guard_ansi_escape <text after a backslash> — what an escape in a `$'…'` stands for, the way bash
# decodes it: GUARD_ANSI_CHAR, and GUARD_ANSI_LEN, the characters of the text it takes. A letter, hex,
# octal or `\c` control code becomes its character when that is ASCII, a newline a space so the word
# stays on its line, a NUL nothing; a code past ASCII and an escape bash does not know stay as typed.
GUARD_ANSI_CHAR=""
GUARD_ANSI_LEN=0
guard_ansi_escape() {
  local t="$1" code=-1 oct
  GUARD_ANSI_LEN=1
  case "${t:0:1}" in
    a) code=7 ;;
    b) code=8 ;;
    e | E) code=27 ;;
    f) code=12 ;;
    n) code=10 ;;
    r) code=13 ;;
    t) code=9 ;;
    v) code=11 ;;
    '\' | "'" | '"' | '?') code=-2 ;;
    c)
      if [[ -n "${t:1:1}" ]]; then
        printf -v code '%d' "'${t:1:1}"
        code=$((code & 31))
        GUARD_ANSI_LEN=2
      fi
      ;;
    [0-7])
      [[ "$t" =~ ^[0-7]{1,3} ]]
      code=$((8#${BASH_REMATCH[0]} & 255))
      GUARD_ANSI_LEN=${#BASH_REMATCH[0]}
      ;;
    x | u | U)
      local -i max=8
      [[ "${t:0:1}" == x ]] && max=2
      [[ "${t:0:1}" == u ]] && max=4
      if [[ "${t:1}" =~ ^[0-9A-Fa-f]{1,$max} ]]; then
        code=$((16#${BASH_REMATCH[0]}))
        GUARD_ANSI_LEN=$((1 + ${#BASH_REMATCH[0]}))
      fi
      ;;
  esac
  case "$code" in
    -2) GUARD_ANSI_CHAR=${t:0:1} ;;
    0) GUARD_ANSI_CHAR="" ;;
    10) GUARD_ANSI_CHAR=" " ;;
    *)
      if ((code < 0 || code > 127)); then
        GUARD_ANSI_CHAR="\\${t:0:GUARD_ANSI_LEN}"
      else
        printf -v oct '%03o' "$code"
        printf -v GUARD_ANSI_CHAR "\\$oct"
      fi
      ;;
  esac
}

# guard_unwrap_words — drops the wrapper words GUARD_WRAPPER names from the front of the array WORDS:
# `sudo`, `command`, `eval`, `env` with its options, a `VAR=value` assignment, a shell with the options
# up to its `-c`, and `rtk` with the subcommand that follows it unless that word is the command
# itself. Word by word, so `rtk git` keeps its `git` and `bash script.sh` stays a shell.
guard_unwrap_words() {
  local j c
  while [[ ${#WORDS[@]} -gt 0 ]]; do
    case "${WORDS[0]}" in
      sudo | command | eval) WORDS=("${WORDS[@]:1}") ;;
      sh | bash | zsh | dash | ksh)
        j=1
        c=0
        while [[ $j -lt ${#WORDS[@]} && "${WORDS[$j]}" == [-+]* ]]; do
          case "${WORDS[$j]}" in
            --*) ;;
            [-+][oO]) j=$((j + 1)) ;; # `-o pipefail`: the option name is the next word
            -*c*) c=1 ;;
          esac
          j=$((j + 1))
        done
        ((c)) || return 0
        WORDS=("${WORDS[@]:$j}")
        ;;
      env)
        WORDS=("${WORDS[@]:1}")
        while [[ ${#WORDS[@]} -gt 0 && "${WORDS[0]}" == -* ]]; do
          case "${WORDS[0]}" in
            -u | --unset | -C | --chdir) WORDS=("${WORDS[@]:2}") ;;
            *) WORDS=("${WORDS[@]:1}") ;;
          esac
        done
        ;;
      [A-Za-z_]*=*) WORDS=("${WORDS[@]:1}") ;;
      rtk)
        WORDS=("${WORDS[@]:1}")
        if [[ ${#WORDS[@]} -gt 1 && "${WORDS[0]}" =~ ^[a-z-]+$ && "${WORDS[1]}" != "" ]]; then
          case "${WORDS[0]}" in
            git | sudo | rm | find | shred | grep | rg) ;;
            *) WORDS=("${WORDS[@]:1}") ;;
          esac
        fi
        ;;
      *)
        # `rtk run "git push --force"`: the command arrived as one quoted word. Split it in place.
        if [[ "${WORDS[0]}" == *[[:space:]]* ]]; then
          local -a inner=()
          local w
          while IFS= read -r w; do inner+=("$w"); done < <(guard_words "${WORDS[0]}")
          WORDS=("${inner[@]+"${inner[@]}"}" "${WORDS[@]:1}")
        fi
        return 0
        ;;
    esac
  done
  return 0
}

# Wrapper prefixes a pattern must see through: `sudo`, `command`, `env` with its options, `rtk <cmd>`
# (the auto-rewrite), `rtk proxy <cmd>` and the rtk subcommands that execute an arbitrary command
# (`run` is a raw `sh -c`; `err`, `summary`, `test` run it and filter the output), `eval`, a shell
# with a `-c` among its options (`bash -c`, `sh -ec`, `bash -o pipefail -c`), and a leading
# `VAR=value` assignment, which the shell strips before running what follows —
# `RTK_DISABLED=1 git push --force` included. Zero or more of them, so `sudo rtk run git push
# --force` matches the same as the bare form.
GUARD_SHELL_OPTION='([[:space:]]+(-[A-Za-z]+|--[a-z-]+|[-+][oO][[:space:]]+[A-Za-z_]+))'
GUARD_SHELL_C="(ba|da|k|z)?sh${GUARD_SHELL_OPTION}*[[:space:]]+-[A-Za-z]*c[A-Za-z]*${GUARD_SHELL_OPTION}*[[:space:]]+"
GUARD_WRAPPER="(sudo[[:space:]]+|command[[:space:]]+|eval[[:space:]]+|${GUARD_SHELL_C}|env([[:space:]]+-[^[:space:]]+)*[[:space:]]+|rtk[[:space:]]+([a-z-]+[[:space:]]+)?|[A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)*"

# What precedes a quote that holds a command, not text: a shell's `-c`, `eval` or `rtk run`.
GUARD_LIVE_QUOTE="(^|[[:space:];&|(\`])(${GUARD_SHELL_C}|eval[[:space:]]+|rtk[[:space:]]+run[[:space:]]+)\$"

# A heredoc opener line whose command, or a command piped after it, is a shell reading its stdin.
GUARD_SHELL_STDIN="(^|[;&|(][[:space:]]*)${GUARD_WRAPPER}(ba|da|k|z)?sh([[:space:]]|\$)"

# Start-of-command boundary for an ERE: line start or right after `;` `&` `|` `(` or a backtick — the
# last two open a subshell or a command substitution — then the wrappers and an optional quote for
# the `rtk run "git push --force"` and `bash -c 'git reset --hard'` forms.
# `grep -E "${GUARD_BOUNDARY}git push"`.
GUARD_BOUNDARY="(^|[;&|(\`][[:space:]]*)${GUARD_WRAPPER}[\"']?"
