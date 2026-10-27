#!/bin/bash
# The quote mask lib.sh sources: each separator a quoted span holds made text, and a quote handed to a
# shell masked as the command it is. Not a hook: lib.sh sources every lib-*.sh before the mask runs.
# --- the mask -----------------------------------------------------------------------------------

# guard_mask_quoted_separators <command> — `;` `&` `|` `(` `)` and a backtick made \002 where they are
# text, so `git commit -m "a | git push -f"` is one command; the quotes stay. What runs stays live: a
# `$(…)` in double quotes, a live quote. An unterminated quote hands back the original: fail closed.
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

# guard_mask_pieces [<from> [<to>]] — the walk's pieces joined into GUARD_MASKED, separators made \002
# where text: a quoted span and its newlines, a `${…}`, a comment, an escape. An unquoted heredoc body
# loses its quotes and `#` too, so a later walk of the whole command finds none there.
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
