#!/bin/bash
# The text scanners lib.sh sources — heredoc bodies, continuation lines, quoted separators, words,
# the wrapper boundary every guard's pattern sees through. Not a hook and not sourced on its own:
# lib.sh sets the locale and GUARD_LIB_DIR first, then sources this file where the section sat.
# --- the text -----------------------------------------------------------------------------------

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

# guard_mask_heredoc_backticks — stdin to stdout: every backtick in a heredoc body becomes \002, the
# openers and the rest of the text unchanged.
guard_mask_heredoc_backticks() {
  local line delim="" body=0 state=""
  while IFS= read -r line; do
    if [[ $body -eq 1 ]]; then
      if [[ "$line" =~ ^[[:space:]]*$delim[[:space:]]*$ ]]; then
        body=0
        delim=""
      else
        line="${line//\`/$'\002'}"
      fi
      printf '%s\n' "$line"
      continue
    fi
    if guard_heredoc_opener "$line" "$state"; then
      delim="$GUARD_HD_DELIM"
      body=1
    fi
    state="$GUARD_HD_STATE"
    printf '%s\n' "$line"
  done
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

# guard_mask_quoted_separators <command> — `;` `&` `|` `(` `)` and a backtick inside a quoted span are
# text, not separators, so they become \002 and cannot open a command boundary: `git commit -m "docs:
# never | git push --force"` is a message, not a push. The quotes themselves stay, so the boundary's optional quote
# still matches `rtk run "npm install"`, where the quoted text really is the command. A state machine
# rather than sed: an apostrophe inside double quotes is a literal, and so is a double quote inside
# single quotes. An unterminated quote hands back the original — fail closed, judge what was typed.
# Two exceptions: a quote handed to a shell's `-c`, `eval` or `rtk run` is a command and stays
# unmasked, so `bash -c "cd x && git reset --hard"` keeps its `&&`; and a backtick in a heredoc body is
# masked, so a commit message that quotes a command in markdown is not a substitution.
guard_mask_quoted_separators() {
  local s="$1"
  if [[ "$s" == *'<<'* && "$s" == *'`'* ]]; then
    s=$(printf '%s\n' "$s" | guard_mask_heredoc_backticks)
  fi
  local n=${#s}
  local i=0 ch out="" state=plain live=0
  while ((i < n)); do
    ch=${s:i:1}
    if [[ "$ch" == '\' ]]; then
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
    case "$state" in
      plain)
        case "$ch" in
          "'") state=sq ;;
          '"') state=dq ;;
        esac
        if [[ "$state" != plain ]]; then
          live=0
          [[ "$out" =~ $GUARD_LIVE_QUOTE ]] && live=1
        fi
        ;;
      sq) [[ "$ch" == "'" ]] && state=plain ;;
      dq) [[ "$ch" == '"' ]] && state=plain ;;
    esac
    if [[ "$state" != plain ]] && ((!live)); then
      case "$ch" in ';' | '&' | '|' | '(' | ')' | '`') ch=$'\002' ;; esac
    fi
    out+=$ch
    i=$((i + 1))
  done
  if [[ "$state" != plain ]]; then
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

# Start-of-command boundary for an ERE: line start or right after `;` `&` `|` `(` or a backtick — the
# last two open a subshell or a command substitution — then the wrappers and an optional quote for
# the `rtk run "git push --force"` and `bash -c 'git reset --hard'` forms.
# `grep -E "${GUARD_BOUNDARY}git push"`.
GUARD_BOUNDARY="(^|[;&|(\`][[:space:]]*)${GUARD_WRAPPER}[\"']?"
