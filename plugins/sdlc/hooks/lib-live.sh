#!/bin/bash
# The live-quote readers lib.sh sources: a quote handed to a shell's `-c`, `eval` or `rtk run`, read
# where the outer shell ends it. Not a hook: lib.sh sources every lib-*.sh before a reader runs.
# --- the live quotes ----------------------------------------------------------------------------

# guard_live_span <opening kind> — a quote handed to a shell, read from the walk's pieces just after
# its opening quote into the GUARD_LIVE_* fields. Returns 1 when it never closes, 2 when the outer
# shell may end it elsewhere, 3 when read as typed: each field and case in docs/contributing/bash-guard.md#live-quotes.
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

# guard_live_walk <end> <state> <from> <opening kind> — reads the quote a live walk opened just before
# <from> with guard_live_span: the outer shell's walk finds its end, and the live one stops there.
# Returns 0 or 3 when both end it there, else 2 with the outer shell's reading, or 1 if it never closes.
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
