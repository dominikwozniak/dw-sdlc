#!/bin/bash
# The live-quote readers lib.sh sources — a quote handed to a shell's `-c`, `eval` or `rtk run`, read
# where the outer shell ends it, for the mask and the substitution split. Not a hook and not sourced
# on its own: lib.sh sets the locale and GUARD_LIB_DIR first and sources lib-lines.sh and
# lib-text.sh, then this file, then lib-mask.sh and lib-words.sh, whose escape decoder and
# GUARD_HAS_LIVE_QUOTE these readers call only once every file is sourced.
# --- the live quotes ----------------------------------------------------------------------------

# guard_live_span <opening kind> — a quote handed to a shell, read from the walk's pieces, which start
# just after its opening quote: os, oa or od where a live walk opened it, oS, oA or oD where the walk
# already read it the outer shell's way. GUARD_LIVE_CTX is the context the outer shell reads it in, S, A or D;
# GUARD_LIVE_RAW the text up to the walk's closing quote, GUARD_LIVE_LEN the characters through it,
# GUARD_LIVE_END its piece. GUARD_LIVE_TEXT is the text the shell is handed: a `$'…'` decoded, the
# escapes of `$`, a backtick, `"` and `\` in a `"…"` undone. GUARD_LIVE_SPLIT is that text with each
# substitution of a `"…"` a `_`, its body in GUARD_LIVE_SUBS, since the outer shell runs it first.
# A `${…}` nests its quotes the way the outer shell does. Returns 1 when the quote never closes, and
# 2 when the outer shell may end it elsewhere than a live walk does: a `'…'` holding a `'`, a `$'…'`
# an unescaped `'`, a `"…"` a `'…'` or `$'…'` with a `"`, `$`, backtick or backslash, text there to
# the outer shell, or a substitution read with a quote handed on inside it. Returns 3 when the walk
# ends it where the shell does but read the text as typed, not the text the shell is handed: a
# `$'…'` holding a backslash.
GUARD_LIVE_CTX=""
GUARD_LIVE_RAW=""
GUARD_LIVE_TEXT=""
GUARD_LIVE_SPLIT=""
GUARD_LIVE_SUBS=()
GUARD_LIVE_LEN=0
GUARD_LIVE_END=0
guard_live_span() {
  local j n=${#GUARD_QW_KIND[@]} kind piece open=1 span="" inner="" live=0
  case "$1" in
    o[sS]) GUARD_LIVE_CTX=S ;;
    o[aA]) GUARD_LIVE_CTX=A ;;
    *) GUARD_LIVE_CTX=D ;;
  esac
  [[ "$1" == o[sad] ]] && live=1
  GUARD_LIVE_RAW=""
  GUARD_LIVE_TEXT=""
  GUARD_LIVE_SPLIT=""
  GUARD_LIVE_SUBS=()
  GUARD_LIVE_LEN=0
  for ((j = 0; j < n; j++)); do
    kind=${GUARD_QW_KIND[j]}
    piece=${GUARD_QW_TEXT[j]}
    GUARD_LIVE_LEN=$((GUARD_LIVE_LEN + ${#piece}))
    case "$kind" in
      o?) open=$((open + 1)) ;;
      c?) open=$((open - 1)) ;;
    esac
    ((open > 0)) || break
    GUARD_LIVE_RAW+=$piece
    [[ "$GUARD_LIVE_CTX" == D ]] || continue
    if ((open == 2)) && [[ "$kind" == o? ]]; then
      # A nested span opens: a substitution, a `${…}`, or a `'…'` that is text to the outer shell.
      span=${kind:1}
      inner=""
      GUARD_LIVE_TEXT+=$piece
      if [[ "$span" == [UB] ]]; then GUARD_LIVE_SPLIT+=_; else GUARD_LIVE_SPLIT+=$piece; fi
    elif ((open > 1)) || [[ "$kind" == c? ]]; then
      GUARD_LIVE_TEXT+=$piece
      if [[ "$span" == [UB] ]]; then
        ((live)) && [[ "$kind" == ?[sad] ]] && return 2
        if ((open > 1)); then inner+=$piece; else GUARD_LIVE_SUBS+=("$inner"); fi
      else
        GUARD_LIVE_SPLIT+=$piece
        if ((open > 1)); then
          inner+=$piece
        elif ((live)) && [[ "$span" != e && "$inner" == *[\"\`\$\\]* ]]; then
          return 2
        fi
      fi
    else
      if [[ "$kind" == e? ]]; then
        case "${piece:1}" in
          '$' | '`' | '"' | '\') piece=${piece:1} ;;
          $'\n') piece="" ;;
        esac
      fi
      GUARD_LIVE_TEXT+=$piece
      GUARD_LIVE_SPLIT+=$piece
    fi
  done
  ((open == 0)) || return 1
  GUARD_LIVE_END=$j
  case "$GUARD_LIVE_CTX" in
    S)
      ((live)) && [[ "$GUARD_LIVE_RAW" == *\'* ]] && return 2
      GUARD_LIVE_TEXT=$GUARD_LIVE_RAW
      ;;
    A)
      if ((live)); then
        # An escape is a backslash and the character after it, `\'` among them.
        inner=$GUARD_LIVE_RAW
        while [[ "$inner" == *[\'\\]* ]]; do
          inner=${inner#"${inner%%[\'\\]*}"}
          [[ "$inner" == \\* ]] || return 2
          inner=${inner:2}
        done
      fi
      guard_ansi_decode "$GUARD_LIVE_RAW"
      GUARD_LIVE_TEXT=$GUARD_ANSI_TEXT
      ;;
  esac
  [[ "$GUARD_LIVE_CTX" == D ]] || GUARD_LIVE_SPLIT=$GUARD_LIVE_TEXT
  ((live)) && [[ "$GUARD_LIVE_CTX" == A && "$GUARD_LIVE_RAW" == *\\* ]] && return 3
  return 0
}

# guard_live_walk <end> <state> <from> <opening kind> — walks a quote of GUARD_QW_SRC, whose text ends
# at <end>, that a live walk opened with <opening kind> in <state>, <from> the offset just after its
# opening quote, and reads it with guard_live_span. The outer shell's walk finds where the quote ends,
# and the live walk reads only up to there, so each walk stops at the quote's end and a command costs
# time linear in its live quotes.
# Returns guard_live_span's 0 or 3 when the live walk ends the quote there too and reads it so, else
# 2 with the outer shell's reading in its place, or 1 when the quote never closes.
guard_live_walk() {
  local ctx end rc
  case "$4" in
    os) ctx=S ;;
    oa) ctx=A ;;
    *) ctx=D ;;
  esac
  guard_qw_walk "$1" 0 "$2$ctx" "$3" c
  [[ "$GUARD_QW_STATE" == "$2" ]] || return 1
  end=$GUARD_QW_END
  guard_qw_walk "$end" 1 "$2${4:1}" "$3" c
  if [[ "$GUARD_QW_STATE" == "$2" && $GUARD_QW_END -eq $end ]]; then
    guard_live_span "$4"
    rc=$?
    ((rc == 0 || rc == 3)) && return "$rc"
  fi
  guard_qw_walk "$1" 0 "$2$ctx" "$3" c
  guard_live_span "o$ctx"
  return 2
}

# guard_live_body <end> <state> <from> <opening kind> — the quote guard_live_walk reads, split for
# the path check: GUARD_LIVE_LINES holds each substitution's lines, then those of the text the shell
# is handed, split again. Returns 1 when the quote never closes.
GUARD_LIVE_LINES=""
guard_live_body() {
  local sub
  GUARD_LIVE_LINES=""
  guard_live_walk "$@"
  (($? != 1)) || return 1
  for sub in "${GUARD_LIVE_SUBS[@]+"${GUARD_LIVE_SUBS[@]}"}"; do
    GUARD_LIVE_LINES+="$(guard_split_substitutions "$sub")"$'\n'
  done
  if guard_runs_inside "$GUARD_LIVE_SPLIT"; then
    GUARD_LIVE_LINES+="$(guard_split_substitutions "$GUARD_LIVE_SPLIT")"$'\n'
  else
    guard_replace_set "$GUARD_LIVE_SPLIT" $'\n' ' '
    GUARD_LIVE_LINES+="$GUARD_REPLACED"$'\n'
  fi
}

# guard_runs_inside <text> — 0 when the text holds something the shell runs or drops inside it: a
# `$(`, a backtick, a `#` or a quote handed to a shell. Without one, its split is the text folded.
guard_runs_inside() {
  [[ "$1" == *'$('* || "$1" == *'`'* || "$1" == *'#'* || "$1" =~ $GUARD_HAS_LIVE_QUOTE ]]
}
