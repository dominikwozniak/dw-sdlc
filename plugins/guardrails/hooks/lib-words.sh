#!/bin/bash
# The word readers lib.sh sources — a command split into shell words, the wrappers in front of it,
# and the boundary every guard's pattern sees through. Not a hook and not sourced on its own: lib.sh
# sets the locale and GUARD_LIB_DIR first and sources lib-lines.sh, lib-text.sh and lib-live.sh, then
# this file.
# --- the words ----------------------------------------------------------------------------------

# guard_tokens <text> — one token per line, split on whitespace and shell punctuation.
guard_tokens() {
  printf '%s\n' "$1" | tr -s "[:space:];|&()<>=\`\"'" '\n' | sed '/^$/d'
}

# guard_words <segment> — the segment split into words the way a shell would, one per line, read on
# guard_quote_walk's pieces: whitespace at the top level separates, quotes group and are dropped, the
# `$` of a `$'…'` or a `$"…"` with them, a backslash keeps the next character, and in a `$'…'` stands
# for what bash decodes it to, a newline read as a space and the text ending at a NUL. A `$(…)`, a
# backtick substitution or a `${…}` stays in its word, delimiters and whitespace included, with the
# quotes and backslashes inside it read the same way. A comment's text splits as the command's does,
# and a heredoc operator reads as `<<EOF`, the delimiter's quotes dropped. For one command's
# arguments, where `-C 'my repo'` must stay one word; a segment holds no newline. Returns 1 when a
# quote or substitution is left open, after printing what it read.
guard_words() {
  local i n kind piece word="" have=0 depth=0 cut=0 quote="" status=0 noglob=0 run k
  local -a parts
  guard_quote_walk "$1" || status=1
  # Top-level text splits on the shell's own rule: IFS whitespace, no glob.
  local IFS=$' \t'
  [[ $- == *f* ]] && noglob=1
  set -f
  n=${#GUARD_QW_KIND[@]}
  for ((i = 0; i < n; i++)); do
    kind=${GUARD_QW_KIND[i]}
    piece=${GUARD_QW_TEXT[i]}
    if [[ -n "$quote" ]]; then
      [[ "${piece:0:1}" == "$quote" ]] && piece=${piece:1}
      quote=""
    fi
    case "$kind" in
      tP | tC | h)
        # The quote that closes a heredoc's quoted delimiter is the first character of the next piece.
        if [[ "$kind" == h ]]; then
          quote=${piece//[!\'\"]/}
          piece=${piece//[\'\"\\]/}
        fi
        if ((depth > 0)); then
          word+=$piece
          continue
        fi
        ;;
      tA)
        ((cut)) || word+=$piece
        continue
        ;;
      eA)
        if ((!cut)); then
          guard_ansi_escape "${piece:1}"
          if ((GUARD_ANSI_NUL)); then
            cut=1
          elif [[ "$GUARD_ANSI_CHAR" == $'\n' ]]; then
            word+=' '
          else
            word+=$GUARD_ANSI_CHAR
          fi
        fi
        continue
        ;;
      e?)
        word+=${piece:1}
        have=1
        continue
        ;;
      t?)
        word+=$piece
        have=1
        continue
        ;;
      oD)
        # The `$` of a `$"…"` is the text's last, unless it pairs with the one before as `$$`.
        if ((i > 0)) && [[ "${GUARD_QW_KIND[i - 1]}" == t? && "${GUARD_QW_TEXT[i - 1]}" == *'$' ]]; then
          run=${GUARD_QW_TEXT[i - 1]}
          k=0
          while [[ "$run" == *'$' ]]; do
            run=${run%?}
            k=$((k + 1))
          done
          ((k % 2)) && word=${word%?}
        fi
        depth=$((depth + 1))
        have=1
        continue
        ;;
      o[SA])
        depth=$((depth + 1))
        have=1
        continue
        ;;
      c[SDA])
        depth=$((depth - 1))
        cut=0
        continue
        ;;
      o?)
        word+=$piece
        depth=$((depth + 1))
        have=1
        continue
        ;;
      c?)
        word+=$piece
        depth=$((depth - 1))
        continue
        ;;
    esac
    [[ -n "$piece" ]] || continue
    if [[ "$piece" != *[[:blank:]]* ]]; then
      word+=$piece
      have=1
      continue
    fi
    if [[ "$piece" == [[:blank:]]* ]]; then
      ((have)) && printf '%s\n' "$word"
      word=""
      have=0
    fi
    parts=($piece)
    for ((k = 0; k < ${#parts[@]}; k++)); do
      if ((k > 0)); then
        printf '%s\n' "$word"
        word=""
      fi
      word+=${parts[k]}
      have=1
    done
    if [[ "$piece" == *[[:blank:]] ]]; then
      ((have)) && printf '%s\n' "$word"
      word=""
      have=0
    fi
  done
  ((noglob)) || set +f
  ((have)) && printf '%s\n' "$word"
  return $status
}

# guard_ansi_escape <text after a backslash> — what an escape in a `$'…'` stands for, the way bash
# decodes it: GUARD_ANSI_CHAR, and GUARD_ANSI_LEN, the characters of the text it takes. A letter, hex,
# octal or `\c` control code becomes its character when that is ASCII; a NUL is no character and sets
# GUARD_ANSI_NUL, since bash ends the quote's text there; a code past ASCII and an escape bash does not
# know stay as typed. `\u` and `\U` are bash 4.2's and zsh's, shells a command may run under.
GUARD_ANSI_CHAR=""
GUARD_ANSI_LEN=0
GUARD_ANSI_NUL=0
guard_ansi_escape() {
  local t="$1" code=-1 oct
  GUARD_ANSI_LEN=1
  GUARD_ANSI_NUL=0
  case "${t:0:1}" in
    a) code=7 ;;
    b) code=8 ;;
    e | E) code=27 ;;
    f) code=12 ;;
    n) code=10 ;;
    r) code=13 ;;
    t) code=9 ;;
    v) code=11 ;;
    '\' | "'" | '"' | '?') printf -v code '%d' "'${t:0:1}" ;;
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
  if ((code == 0)); then
    GUARD_ANSI_CHAR=""
    GUARD_ANSI_NUL=1
  elif ((code < 0 || code > 127)); then
    GUARD_ANSI_CHAR="\\${t:0:GUARD_ANSI_LEN}"
  else
    printf -v oct '%03o' "$code"
    printf -v GUARD_ANSI_CHAR "\\$oct"
  fi
}

# guard_ansi_decode <body> — GUARD_ANSI_TEXT, the body of a `$'…'` as bash decodes it, every escape
# its character and the text cut at a NUL.
GUARD_ANSI_TEXT=""
guard_ansi_decode() {
  local rest="$1" run
  GUARD_ANSI_TEXT=""
  while [[ "$rest" == *'\'* ]]; do
    run=${rest%%\\*}
    GUARD_ANSI_TEXT+=$run
    rest=${rest:${#run}+1}
    guard_ansi_escape "${rest:0:9}"
    ((GUARD_ANSI_NUL)) && return 0
    GUARD_ANSI_TEXT+=$GUARD_ANSI_CHAR
    rest=${rest:GUARD_ANSI_LEN}
  done
  GUARD_ANSI_TEXT+=$rest
}

# The command position. A command runs where the shell reads one — a line start, indented or not, or
# after `;` `&` `|` `(` or a backtick — and behind the words that run the command after them:
#
#   word                                     its options that take a value (glued or the next word)
#   then do else elif if while until ! {     —
#   time                                     -o -f (GNU time; the keyword's -p takes none)
#   sudo                                     -u -g -h -p -U -r -t -C -D -R -T
#   env                                      -u -C -S; then any VAR=value
#   command                                  -p runs the command; -v and -V only look it up
#   eval  nohup                              —
#   exec                                     -a
#   nice                                     -n
#   timeout                                  -s -k; then one duration
#   stdbuf                                   -i -o -e
#   xargs                                    -a -d -E -I -J -L -n -P -R -s -S
#   find … -exec / -execdir / -ok / -okdir   the command runs up to its `;` or `{} +`
#   sh bash zsh dash ksh                     the text after a `-c`, or after `<<<`
#   rtk                                      its flags, then run, proxy, err, test or summary
#   VAR=value                                —
#
# A command named by a path or with a leading backslash, `/usr/bin/git` or `\rm`, is that command.
# Two readers keep this table: guard_unwrap_words on words and GUARD_WRAPPER on text, for the arms
# that must read a target in place. test/hooks/lib.test.ts holds them to the same spellings.

# guard_read_words <segment> — WORDS becomes the segment's words, as guard_words reads them. A segment
# cut out of a quote handed to a shell, `bash -c "${x:-$'a; git reset --hard'}"`, ends in the quotes,
# braces and parentheses that close outside it; guard_words reads those as a quote left open, and then
# every word is read without them.
guard_read_words() {
  local out word open=0
  WORDS=()
  out=$(guard_words "$1") || open=1
  [[ -n "$out" ]] || return 0
  while IFS= read -r word; do
    if ((open)); then
      while [[ "$word" == *[\'\"\}\)] ]]; do word=${word%?}; done
    fi
    WORDS+=("$word")
  done <<<"$out"
}

# guard_shift_words [<n>] — drops <n> words, 1 by default, from the front of WORDS.
guard_shift_words() {
  local n=${1:-1}
  if ((${#WORDS[@]} > n)); then
    WORDS=("${WORDS[@]:n}")
  else
    WORDS=()
  fi
}

# guard_skip_options <letters> <long options> — drops a launcher's options from the front of WORDS: a
# cluster of flags, one of <letters> with its value, glued or the next word, a `--name=value`, one of
# <long options> with the next word, and a closing `--`. Stops at the first word that is no option.
guard_skip_options() {
  local short="$1" long=" $2 " word j ch
  while [[ ${#WORDS[@]} -gt 0 ]]; do
    word="${WORDS[0]}"
    case "$word" in
      --)
        guard_shift_words
        return 0
        ;;
      --*=*) guard_shift_words ;;
      --?*)
        guard_shift_words
        [[ "$long" == *" $word "* ]] && guard_shift_words
        ;;
      -?*)
        guard_shift_words
        j=1
        while ((j < ${#word})); do
          ch=${word:j:1}
          if [[ "$short" == *"$ch"* ]]; then
            ((j == ${#word} - 1)) && guard_shift_words
            break
          fi
          j=$((j + 1))
        done
        ;;
      *) return 0 ;;
    esac
  done
  return 0
}

# guard_find_exec — WORDS, a `find`, becomes the command its `-exec`, `-execdir`, `-ok` or `-okdir`
# runs, up to the `;` (a masked one is \002) or the `{} +` that ends it. Returns 1 for a find that runs
# nothing.
guard_find_exec() {
  local i n=${#WORDS[@]} from=0 to word
  for ((i = 1; i < n; i++)); do
    case "${WORDS[i]}" in
      -exec | -execdir | -ok | -okdir)
        from=$((i + 1))
        break
        ;;
    esac
  done
  ((from > 0 && from < n)) || return 1
  to=$n
  for ((i = from; i < n; i++)); do
    word=${WORDS[i]}
    if [[ "$word" == ";" || "$word" == $'\002' || ("$word" == "+" && "${WORDS[i - 1]}" == "{}") ]]; then
      to=$i
      break
    fi
  done
  WORDS=("${WORDS[@]:from:to-from}")
}

# guard_unwrap_words — drops from the front of the array WORDS every word the table above names, with
# its options, until the command itself leads. Word by word, so `rtk git` keeps its `git`, `bash
# script.sh` stays a shell and `command -v git` stays a lookup.
guard_unwrap_words() {
  local j c
  while [[ ${#WORDS[@]} -gt 0 ]]; do
    if [[ "${WORDS[0]}" == */* && "${WORDS[0]}" != *[[:space:]=]* ]]; then
      WORDS[0]=${WORDS[0]##*/}
    fi
    case "${WORDS[0]}" in
      then | do | else | elif | if | while | until | '!' | '{' | nohup) guard_shift_words ;;
      eval)
        guard_shift_words
        guard_split_first_word || true
        ;;
      time)
        guard_shift_words
        guard_skip_options "of" "--output --format"
        ;;
      sudo)
        guard_shift_words
        guard_skip_options "ugChpUrtDRT" "--user --group --host --prompt --other-user --role --type --chdir --chroot --command-timeout"
        ;;
      command)
        guard_shift_words
        [[ "${WORDS[0]:-}" == -p ]] && guard_shift_words
        ;;
      exec)
        guard_shift_words
        guard_skip_options "a" ""
        ;;
      nice)
        guard_shift_words
        guard_skip_options "n" "--adjustment"
        ;;
      timeout)
        guard_shift_words
        guard_skip_options "sk" "--signal --kill-after"
        guard_shift_words
        ;;
      stdbuf)
        guard_shift_words
        guard_skip_options "ioe" "--input --output --error"
        ;;
      xargs)
        guard_shift_words
        guard_skip_options "adEIJLnPRsS" "--arg-file --delimiter --eof --replace --max-lines --max-args --max-procs --max-chars --process-slot-var"
        ;;
      find)
        guard_find_exec || return 0
        ;;
      sh | bash | zsh | dash | ksh)
        j=1
        c=0
        while [[ $j -lt ${#WORDS[@]} && "${WORDS[$j]}" == [-+]* ]]; do
          case "${WORDS[$j]}" in
            --*) ;;
            [-+][oO] | [-+][A-Za-z]*[oO])
              # `-o pipefail`, `-euo pipefail`: the option name is the next word
              [[ "${WORDS[$j]}" == -*c* ]] && c=1
              j=$((j + 1))
              ;;
            -*c*) c=1 ;;
          esac
          j=$((j + 1))
        done
        # `bash <<<'git reset --hard'`: the here-string is the script.
        if [[ "${WORDS[$j]:-}" == '<<<' ]]; then
          WORDS=("${WORDS[$((j + 1))]:-}")
          guard_split_first_word || true
          continue
        elif [[ "${WORDS[$j]:-}" == '<<<'* ]]; then
          WORDS=("${WORDS[$j]#<<<}")
          guard_split_first_word || true
          continue
        fi
        ((c)) || return 0
        guard_shift_words "$j"
        # The script is one word, and it may open with a VAR=value of its own.
        guard_split_first_word || true
        ;;
      env)
        guard_shift_words
        guard_skip_options "uCS" "--unset --chdir --split-string"
        ;;
      [A-Za-z_]*=*)
        # An assignment names a variable; `git gc --prune=now`, one word from a `bash -c`, is a command.
        if [[ "${WORDS[0]%%=*}" == *[!A-Za-z0-9_]* ]]; then
          guard_split_first_word || return 0
        else
          guard_shift_words
        fi
        ;;
      rtk)
        guard_shift_words
        while [[ "${WORDS[0]:-}" == -?* ]]; do guard_shift_words; done
        if [[ ${#WORDS[@]} -gt 1 ]]; then
          case "${WORDS[0]}" in
            run | proxy | err | test | summary)
              guard_shift_words
              guard_split_first_word || true
              ;;
          esac
        fi
        ;;
      *) guard_split_first_word || return 0 ;;
    esac
  done
  return 0
}

# guard_split_first_word — `rtk run "git push --force"` and `bash -c 'git reset --hard'` hand the
# command over as one quoted word: split WORDS[0] in place into its words, so unwrapping goes on with
# them. Returns 1 when the first word holds no whitespace, or nothing that splits.
guard_split_first_word() {
  local -a inner=()
  local w
  [[ "${WORDS[0]}" == *[[:space:]]* ]] || return 1
  while IFS= read -r w; do inner+=("$w"); done < <(guard_words "${WORDS[0]}")
  [[ ${#inner[@]} -gt 1 || "${inner[0]:-}" != "${WORDS[0]}" ]] || return 1
  WORDS=("${inner[@]+"${inner[@]}"}" "${WORDS[@]:1}")
}

# The table above as text: zero or more of its words in front of the command, so `sudo -u me rtk run
# git push --force` matches the same as the bare form. A flag is any `-word`; an option that takes a
# value is spelled out with it. rtk's own subcommands are left optional, so `rtk git` and `rtk proxy
# git` both read.
GUARD_SHELL_OPTION='([[:space:]]+(-[A-Za-z]+|--[a-z-]+|[-+][A-Za-z]*[oO][[:space:]]+[A-Za-z_]+))'
GUARD_SHELL_C="(ba|da|k|z)?sh${GUARD_SHELL_OPTION}*[[:space:]]+-[A-Za-z]*c[A-Za-z]*${GUARD_SHELL_OPTION}*[[:space:]]+"
GUARD_SHELL_HERE="(ba|da|k|z)?sh${GUARD_SHELL_OPTION}*[[:space:]]*<<<[[:space:]]*"
GUARD_OPT_FLAG='[[:space:]]+-[^[:space:];&|]*'
GUARD_OPT_VALUE="[[:space:]]+(\"[^\"]*\"|'[^']*'|[^[:space:];&|]+)"
# A command named by a path, `/usr/bin/git`, or with a leading backslash, `\rm`.
GUARD_CMD_DIR="(\\\\|[^[:space:];&|()\`'\"]*/)?"
GUARD_LAUNCHER="(then|do|else|elif|if|while|until|!|\\{)[[:space:]]+"
GUARD_LAUNCHER+="|time([[:space:]]+-p|[[:space:]]+-[of]${GUARD_OPT_VALUE})*[[:space:]]+"
GUARD_LAUNCHER+="|sudo([[:space:]]+-[A-Za-z]*[ugChpUrtDRT]${GUARD_OPT_VALUE}|${GUARD_OPT_FLAG})*[[:space:]]+"
GUARD_LAUNCHER+="|env([[:space:]]+-[A-Za-z]*[uCS]${GUARD_OPT_VALUE}|${GUARD_OPT_FLAG})*[[:space:]]+"
GUARD_LAUNCHER+="|command([[:space:]]+-p)?[[:space:]]+|eval[[:space:]]+|nohup[[:space:]]+"
GUARD_LAUNCHER+="|exec([[:space:]]+-a${GUARD_OPT_VALUE}|${GUARD_OPT_FLAG})*[[:space:]]+"
GUARD_LAUNCHER+="|nice([[:space:]]+-n${GUARD_OPT_VALUE}|${GUARD_OPT_FLAG})*[[:space:]]+"
GUARD_LAUNCHER+="|timeout([[:space:]]+-[sk]${GUARD_OPT_VALUE}|${GUARD_OPT_FLAG})*[[:space:]]+[0-9.]+[smhd]?[[:space:]]+"
GUARD_LAUNCHER+="|stdbuf([[:space:]]+-[ioe]${GUARD_OPT_VALUE}|${GUARD_OPT_FLAG})*[[:space:]]+"
GUARD_LAUNCHER+="|xargs([[:space:]]+-[0-9A-Za-z]*[adEIJLnPRsS]${GUARD_OPT_VALUE}|${GUARD_OPT_FLAG})*[[:space:]]+"
GUARD_LAUNCHER+="|find[[:space:]]+([^;&|]*[[:space:]]+)?-(exec|execdir|ok|okdir)[[:space:]]+"
GUARD_LAUNCHER+="|${GUARD_SHELL_C}|${GUARD_SHELL_HERE}"
GUARD_LAUNCHER+="|rtk(${GUARD_OPT_FLAG})*[[:space:]]+([a-z-]+[[:space:]]+)?"
GUARD_LAUNCHER+="|[A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+"
GUARD_WRAPPER="(${GUARD_CMD_DIR}(${GUARD_LAUNCHER}))*"

# What precedes a quote that holds a command, not text: a shell's `-c` or `<<<`, `eval` or `rtk run`.
# Past its first character a match holds only letters, `_`, `+`, `-`, `<` and whitespace, which
# guard_qw_live's window relies on.
GUARD_LIVE_PREFIX="(^|[[:space:];&|(\`])(${GUARD_SHELL_C}|${GUARD_SHELL_HERE}|eval[[:space:]]+|rtk[[:space:]]+run[[:space:]]+)"
GUARD_LIVE_QUOTE="${GUARD_LIVE_PREFIX}\$"

# A text that holds such a quote somewhere: the prefix, then `'`, `"`, `$'` or `$"`.
GUARD_HAS_LIVE_QUOTE="${GUARD_LIVE_PREFIX}\\\$?[\"']"

# An optional opening quote for an ERE: `'`, `"`, `$'` or `$"`.
GUARD_OPEN_QUOTE="(\\\$?[\"'])?"

# Start-of-command boundary for an ERE: a line start, indented or not, or right after `;` `&` `|` `(`
# or a backtick — the last two open a subshell or a command substitution — then the wrappers, each
# one free to open a quote for the `rtk run "git push --force"`, `bash -c 'X=1 rm -rf /'` and
# `bash -c $'…'` forms, and the command's path. `grep -E "${GUARD_BOUNDARY}rm"`.
GUARD_BOUNDARY="(^[[:space:]]*|[;&|(\`][[:space:]]*)(${GUARD_CMD_DIR}(${GUARD_LAUNCHER})|\\\$?[\"'])*${GUARD_CMD_DIR}"
