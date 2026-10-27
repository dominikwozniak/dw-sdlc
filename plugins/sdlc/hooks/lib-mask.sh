#!/bin/bash
# The quote mask lib.sh sources — a command with every separator a quoted span holds made text, so no
# command boundary opens inside a quote, and a quote handed to a shell masked as the command it is.
# Not a hook and not sourced on its own: lib.sh sets the locale and GUARD_LIB_DIR first and sources
# lib-lines.sh, lib-text.sh and lib-live.sh, then this file, then lib-words.sh, whose heredoc mask,
# walk, live-quote readers and escape decoder the mask calls only once every file is sourced.
# --- the mask -----------------------------------------------------------------------------------

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
  guard_mask_text "$1"
  printf '%s' "$GUARD_MASKED"
}

# guard_mask_text <command> — guard_mask_quoted_separators into GUARD_MASKED, in the caller's shell. A
# quote's text is masked by a call of its own rather than a fork: every name the loop keeps is a local.
guard_mask_text() {
  local s="$1" st=P from=0 n kind out="" rc close
  if [[ "$s" == *'<<'* ]]; then
    s=$(printf '%s\n' "$s" | guard_mask_heredoc_bodies)
  fi
  local GUARD_QW_SRC="$s" total=${#s}
  while :; do
    guard_qw_walk "$total" 1 "$st" "$from" o
    guard_mask_pieces
    out+=$GUARD_MASKED
    st=$GUARD_QW_STATE
    from=$GUARD_QW_END
    n=${#GUARD_QW_KIND[@]}
    ((n > 0)) && [[ "${GUARD_QW_KIND[n - 1]}" == o[sad] ]] || break
    kind=${GUARD_QW_KIND[n - 1]}
    st=${st%?}
    guard_live_walk "$total" "$st" "$from" "$kind"
    rc=$?
    from=$((from + GUARD_LIVE_LEN))
    case $rc in
      0)
        guard_mask_pieces 0 $((GUARD_LIVE_END + 1))
        out+=$GUARD_MASKED
        ;;
      1)
        st=x
        break
        ;;
      *)
        # The text's own mask walks again, so the closing quote is read first.
        close=${GUARD_QW_TEXT[GUARD_LIVE_END]}
        guard_mask_live_text
        out+=$GUARD_MASKED$close
        ;;
    esac
  done
  [[ "$st" == P ]] && s=$out
  GUARD_MASKED=$s
}

# guard_mask_live_text — GUARD_LIVE_TEXT, the text a quote hands a shell, masked as the command it is
# into GUARD_MASKED. A newline a `$'…'` hands on ends a command, as guard_mask_pieces reads a `\n` in
# one. A text with no quote, escape, substitution, comment or heredoc has nothing to mask.
guard_mask_live_text() {
  local text=$GUARD_LIVE_TEXT
  [[ "$GUARD_LIVE_CTX" == A ]] && text=${text//$'\n'/;}
  if [[ "$text" == *[\'\"\`\$\\#\<]* ]]; then
    guard_mask_text "$text"
  else
    GUARD_MASKED=$text
  fi
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
