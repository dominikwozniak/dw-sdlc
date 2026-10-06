#!/bin/bash
# The text scanners lib.sh sources — quoted separators, words, the wrapper boundary every guard's
# pattern sees through. Not a hook and not sourced on its own: lib.sh sets the locale
# and GUARD_LIB_DIR first and sources lib-lines.sh, then this file.
# --- the text -----------------------------------------------------------------------------------

# guard_mask_quoted_separators <command> — `;` `&` `|` `(` `)` and a backtick inside a quoted span are
# text, not separators, so they become \002 and cannot open a command boundary: `git commit -m "docs:
# never | git push --force"` is a message, not a push. The quotes themselves stay, so the boundary's
# optional quote still matches `rtk run "npm install"`, where the quoted text really is the command.
# What runs stays unmasked: a `$(…)` or a backtick substitution inside double quotes, and a quote
# handed to a shell's `-c`, `eval` or `rtk run`, so `bash -c "cd x && git reset --hard"` keeps its
# `&&`. A heredoc body is text throughout. A stack of states rather than sed, since quotes nest inside
# a substitution: S and D are a single- and a double-quoted span, masked; P the top level, U a `$(…)`,
# B a backtick substitution, s and d a quote that holds a command, all unmasked. An unterminated
# quote or substitution hands back the original — fail closed, judge what was typed.
guard_mask_quoted_separators() {
  local s="$1"
  if [[ "$s" == *'<<'* ]]; then
    s=$(printf '%s\n' "$s" | guard_mask_heredoc_bodies)
  fi
  local n=${#s}
  local i=0 ch top out="" stack=P
  while ((i < n)); do
    ch=${s:i:1}
    top=${stack: -1}
    if [[ "$ch" == '\' && "$top" != S ]]; then
      out+=$ch
      i=$((i + 1))
      if ((i < n)); then
        ch=${s:i:1}
        case "$ch" in ';' | '&' | '|' | '(' | ')' | '`') ch=$'\002' ;; esac
        out+=$ch
      fi
      i=$((i + 1))
      continue
    fi
    if [[ "$ch" == '$' && "${s:i+1:1}" == '(' && "$top" != S ]]; then
      out+='$('
      stack+=U
      i=$((i + 2))
      continue
    fi
    case "$top" in
      S)
        if [[ "$ch" == "'" ]]; then
          stack=${stack%?}
        else
          case "$ch" in ';' | '&' | '|' | '(' | ')' | '`') ch=$'\002' ;; esac
        fi
        ;;
      D)
        case "$ch" in
          '"') stack=${stack%?} ;;
          '`') stack+=B ;;
          ';' | '&' | '|' | '(' | ')') ch=$'\002' ;;
        esac
        ;;
      *)
        case "$ch" in
          "'")
            if [[ "$top" == s ]]; then
              stack=${stack%?}
            elif [[ "$top" != d && "$out" =~ $GUARD_LIVE_QUOTE ]]; then
              stack+=s
            else
              stack+=S
            fi
            ;;
          '"')
            if [[ "$top" == d ]]; then
              stack=${stack%?}
            elif [[ "$out" =~ $GUARD_LIVE_QUOTE ]]; then
              stack+=d
            else
              stack+=D
            fi
            ;;
          '`') if [[ "$top" == B ]]; then stack=${stack%?}; else stack+=B; fi ;;
          '(') [[ "$top" == U ]] && stack+=U ;;
          ')') [[ "$top" == U ]] && stack=${stack%?} ;;
        esac
        ;;
    esac
    out+=$ch
    i=$((i + 1))
  done
  if [[ "$stack" != P ]]; then
    printf '%s' "$s"
  else
    printf '%s' "$out"
  fi
}

# guard_strip_quoted <command> — what a path or token check scans: heredoc bodies dropped, lines
# folded, then each segment's plain words, so prose in a commit message never reads as a file while
# `cat ".env.local"` still names one. In a search tool's segment every quoted word is dropped, because
# there a quoted word is the pattern: `grep -rn ".env.local" src` looks for the name and opens no such
# file. The fold comes after the heredoc pass on purpose: by then there are no lines left to find a
# terminator on.
GUARD_SEARCH_WORD='(^|[^A-Za-z0-9_.-])(rg|ag|ack)([[:space:]]|$)'
guard_strip_quoted() {
  local folded segment
  folded=$(printf '%s\n' "$1" | guard_strip_heredocs | tr '\n' ' ')
  # Most commands name no search tool, and one pass over the whole text is all they need.
  if [[ "$folded" != *grep* && ! "$folded" =~ $GUARD_SEARCH_WORD ]]; then
    guard_plain_words "$folded"
    return 0
  fi
  while IFS= read -r segment; do
    if guard_search_segment "$segment"; then
      segment=$(printf '%s' "$segment" | sed -E 's/"[^"]*"//g' | sed -E "s/'[^']*'//g")
    fi
    printf '%s ' "$(guard_plain_words "$segment")"
  done < <(guard_segments "$(guard_mask_quoted_separators "$folded")")
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
# separates, quotes group and are dropped, a backslash keeps the next character. For one command's
# arguments, where `-C 'my repo'` must stay one word; a segment holds no newline. Returns 1 when a
# quote is left open, after printing what it read.
guard_words() {
  local s="$1"
  local n=${#s}
  local i=0 ch word="" have=0 state=plain
  while ((i < n)); do
    ch=${s:i:1}
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
          ' ' | $'\t')
            ((have)) && printf '%s\n' "$word"
            word=""
            have=0
            ;;
          *) word+=$ch; have=1 ;;
        esac
        ;;
      sq) if [[ "$ch" == "'" ]]; then state=plain; else word+=$ch; fi ;;
      dq) if [[ "$ch" == '"' ]]; then state=plain; else word+=$ch; fi ;;
    esac
    i=$((i + 1))
  done
  ((have)) && printf '%s\n' "$word"
  [[ "$state" == plain ]]
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
