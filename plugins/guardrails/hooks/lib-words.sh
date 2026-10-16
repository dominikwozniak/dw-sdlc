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

# guard_words <segment> — the segment split into words the way a shell would, one per line: whitespace
# separates, quotes group and are dropped, the `$` of a `$'…'` or a `$"…"` with them, a backslash
# keeps the next character, and in a `$'…'` stands for what bash decodes it to, a newline read as a
# space and the text ending at a NUL. For one command's
# arguments, where `-C 'my repo'` must stay one word; a segment holds no newline. Returns 1 when a
# quote is left open, after printing what it read.
guard_words() {
  local s="$1"
  local n=${#s}
  local i=0 ch word="" have=0 state=plain
  while ((i < n)); do
    ch=${s:i:1}
    if [[ "$ch" == '\' && ("$state" == ansi || "$state" == cut) ]]; then
      guard_ansi_escape "${s:i+1:9}"
      if [[ "$state" == ansi ]]; then
        ((GUARD_ANSI_NUL)) && state=cut
        if [[ "$GUARD_ANSI_CHAR" == $'\n' ]]; then word+=' '; else word+=$GUARD_ANSI_CHAR; fi
      fi
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
      cut) [[ "$ch" == "'" ]] && state=plain ;;
      dq) if [[ "$ch" == '"' ]]; then state=plain; else word+=$ch; fi ;;
    esac
    i=$((i + 1))
  done
  ((have)) && printf '%s\n' "$word"
  [[ "$state" == plain ]]
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
            git | sudo | rm | find | shred | grep | rg | asc) ;;
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

# What precedes a quote that holds a command, not text: a shell's `-c`, `eval` or `rtk run`. Past its
# first character a match holds only letters, `_`, `+`, `-` and whitespace, which guard_qw_live's
# window relies on.
GUARD_LIVE_PREFIX="(^|[[:space:];&|(\`])(${GUARD_SHELL_C}|eval[[:space:]]+|rtk[[:space:]]+run[[:space:]]+)"
GUARD_LIVE_QUOTE="${GUARD_LIVE_PREFIX}\$"

# A text that holds such a quote somewhere: the prefix, then `'`, `"`, `$'` or `$"`.
GUARD_HAS_LIVE_QUOTE="${GUARD_LIVE_PREFIX}\\\$?[\"']"

# A heredoc opener line whose command, or a command piped after it, is a shell reading its stdin.
GUARD_SHELL_STDIN="(^|[;&|(][[:space:]]*)${GUARD_WRAPPER}(ba|da|k|z)?sh([[:space:]]|\$)"

# An optional opening quote for an ERE: `'`, `"`, `$'` or `$"`.
GUARD_OPEN_QUOTE="(\\\$?[\"'])?"

# Start-of-command boundary for an ERE: line start or right after `;` `&` `|` `(` or a backtick — the
# last two open a subshell or a command substitution — then the wrappers and an optional quote for
# the `rtk run "git push --force"`, `bash -c 'git reset --hard'` and `bash -c $'…'` forms.
# `grep -E "${GUARD_BOUNDARY}git push"`.
GUARD_BOUNDARY="(^|[;&|(\`][[:space:]]*)${GUARD_WRAPPER}${GUARD_OPEN_QUOTE}"
