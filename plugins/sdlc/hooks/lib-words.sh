#!/bin/bash
# The word readers lib.sh sources: a command split into shell words, the launchers in front of it,
# and the boundary every guard's pattern reads through. Not a hook: lib.sh sources it.
# --- the words ----------------------------------------------------------------------------------

# guard_tokens <text> — one token per line, split on whitespace and shell punctuation.
guard_tokens() {
  printf '%s\n' "$1" | tr -s "[:space:];|&()<>=\`\"'" '\n' | sed '/^$/d'
}

# guard_split_words <segment> — GUARD_WORDS, the segment's words as README.md#words splits them; a
# segment holds no newline. Returns 1 when a quote or substitution is left open, with what it read.
# Runs in the caller's shell, so a segment costs no fork, and overwrites the walk's pieces.
GUARD_WORDS=()
guard_split_words() {
  local i n kind piece word="" have=0 depth=0 cut=0 delim="" status=0 noglob=0 run k
  local -a parts
  GUARD_WORDS=()
  guard_quote_walk "$1" || status=1
  # Top-level text splits on the shell's own rule: IFS whitespace, no glob.
  local IFS=$' \t'
  [[ $- == *f* ]] && noglob=1
  set -f
  n=${#GUARD_QW_KIND[@]}
  for ((i = 0; i < n; i++)); do
    kind=${GUARD_QW_KIND[i]}
    piece=${GUARD_QW_TEXT[i]}
    delim=""
    case "$kind" in
      tP | tC | h)
        # A heredoc's delimiter is one word, unquoted, whatever blanks its quotes hold.
        if [[ "$kind" == h && "${piece:2}" =~ $GUARD_HEREDOC_DELIM ]]; then
          guard_heredoc_unquote "${BASH_REMATCH[3]}"
          delim=$GUARD_HD_UNQUOTED
          piece=${piece:0:${#piece}-${#BASH_REMATCH[3]}}
        fi
        if ((depth > 0)); then
          word+=$piece$delim
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
      word+=$piece$delim
      have=1
      continue
    fi
    if [[ "$piece" == [[:blank:]]* ]]; then
      ((have)) && GUARD_WORDS+=("$word")
      word=""
      have=0
    fi
    parts=($piece)
    for ((k = 0; k < ${#parts[@]}; k++)); do
      if ((k > 0)); then
        GUARD_WORDS+=("$word")
        word=""
      fi
      word+=${parts[k]}
      have=1
    done
    if [[ "$piece" == *[[:blank:]] ]]; then
      ((have)) && GUARD_WORDS+=("$word")
      word=""
      have=0
    fi
    if [[ -n "$delim" ]]; then
      word+=$delim
      have=1
    fi
  done
  ((noglob)) || set +f
  ((have)) && GUARD_WORDS+=("$word")
  return $status
}

# guard_words <segment> — guard_split_words' words, one per line, for a pipe.
guard_words() {
  local status=0
  guard_split_words "$1" || status=1
  ((${#GUARD_WORDS[@]} == 0)) || printf '%s\n' "${GUARD_WORDS[@]}"
  return $status
}

# guard_ansi_escape <text after a backslash> — GUARD_ANSI_CHAR, what a `$'…'` escape decodes to when
# ASCII, else the escape as typed, and GUARD_ANSI_LEN, its length. A NUL sets GUARD_ANSI_NUL, as bash
# ends the text there; `\u` and `\U` decode as in bash 4.2 and zsh, which a command may run under.
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

# The command position and its launchers, the table in README.md#the-command-position, have two
# readers: guard_unwrap_words on words and GUARD_BOUNDARY on text, for the arms that read a target in
# place. test/hooks/lib.test.ts holds them to the same spellings.

# guard_read_words <segment> — WORDS, guard_split_words' words, a trailing empty one (`git push ''`)
# dropped. A segment cut out of a live quote, `bash -c "${x:-$'a; git reset --hard'}"`, ends in what
# closes outside it, a quote left open: each word then drops its trailing quotes, braces and parens.
guard_read_words() {
  local word status=0
  WORDS=()
  guard_split_words "$1" || status=1
  while ((${#GUARD_WORDS[@]} > 0)) && [[ -z "${GUARD_WORDS[${#GUARD_WORDS[@]} - 1]}" ]]; do
    unset "GUARD_WORDS[$((${#GUARD_WORDS[@]} - 1))]"
  done
  if ((status == 0)); then
    WORDS=("${GUARD_WORDS[@]+"${GUARD_WORDS[@]}"}")
    return 0
  fi
  for word in "${GUARD_WORDS[@]+"${GUARD_WORDS[@]}"}"; do
    while [[ "$word" == *[\'\"\}\)] ]]; do word=${word%?}; done
    WORDS+=("$word")
  done
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

# guard_unwrap_words — drops from the front of the array WORDS every launcher the table names, with
# its options, until the command itself leads. Word by word, so `rtk git` keeps its `git`, `bash
# script.sh` stays a shell and `command -v git` stays a lookup.
guard_unwrap_words() {
  local j c
  while [[ ${#WORDS[@]} -gt 0 ]]; do
    if [[ "${WORDS[0]}" == */* && "${WORDS[0]}" != *[[:space:]=]* ]]; then
      WORDS[0]=${WORDS[0]##*/}
    fi
    case "${WORDS[0]}" in
      # `$_` is a lifted substitution, guard_lift_substitutions: empty, it leaves the next word the command.
      then | do | else | elif | if | while | until | '!' | '{' | nohup | '$_') guard_shift_words ;;
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
# them. Returns 1 when there is no first word, it holds no whitespace, or nothing splits.
guard_split_first_word() {
  [[ "${WORDS[0]:-}" == *[[:space:]]* ]] || return 1
  guard_split_words "${WORDS[0]}"
  [[ ${#GUARD_WORDS[@]} -gt 1 || "${GUARD_WORDS[0]:-}" != "${WORDS[0]}" ]] || return 1
  WORDS=("${GUARD_WORDS[@]+"${GUARD_WORDS[@]}"}" "${WORDS[@]:1}")
}

# The launcher table as text, one launcher with its options; GUARD_BOUNDARY reads any number before
# the command. A flag is any `-word`, an option that takes a value is spelled out with it, and rtk's
# subcommand is optional, so `rtk git` and `rtk proxy git` both read.
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

# What precedes a quote that holds a command: a shell's `-c` or `<<<`, `/bin/bash -c` and `\bash -c`
# too, `eval` or `rtk run`. Past its first character a match holds only letters, digits, `_+-./\<` and
# whitespace, which guard_qw_live's window relies on.
GUARD_SHELL_PATH='(\\|[A-Za-z0-9_.+-]*/)*'
GUARD_LIVE_PREFIX="(^|[[:space:];&|(\`])(${GUARD_SHELL_PATH}(${GUARD_SHELL_C}|${GUARD_SHELL_HERE})|eval[[:space:]]+|rtk[[:space:]]+run[[:space:]]+)"
GUARD_LIVE_QUOTE="${GUARD_LIVE_PREFIX}\$"

# A text that holds such a quote somewhere: the prefix, then `'`, `"`, `$'` or `$"`.
GUARD_HAS_LIVE_QUOTE="${GUARD_LIVE_PREFIX}\\\$?[\"']"

# An optional opening quote for an ERE: `'`, `"`, `$'` or `$"`.
GUARD_OPEN_QUOTE="(\\\$?[\"'])?"

# Start-of-command boundary for an ERE, `grep -E "${GUARD_BOUNDARY}rm"`: a command position, then the
# launchers, each free to open a quote, as `rtk run "git push --force"` and `bash -c $'…'` do, then
# the command's path.
GUARD_BOUNDARY="(^[[:space:]]*|[;&|(\`][[:space:]]*)(${GUARD_CMD_DIR}(${GUARD_LAUNCHER})|\\\$?[\"'])*${GUARD_CMD_DIR}"
