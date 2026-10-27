#!/bin/bash
# Refuses an agent every write to App Store Connect, in every repository and with no config: a store
# command with `--confirm`, and an `asc` call that is no read, both in README.md#guards. Only the
# owner writes to the store, at a terminal. Not a security boundary.
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

guard_read_payload "$@" || exit 0
[[ -n "$GUARD_COMMAND" ]] || exit 0
case "$GUARD_COMMAND" in
  *asc* | *store:* | *store-*) ;;
  *) exit 0 ;;
esac

READ_VERBS="list view show summary status pull plan diff validate audit download init approve sizes specs placements"

refuse() {
  guard_block "'$GUARD_COMMAND' $1 Only the owner changes App Store Connect, at a terminal. An agent runs a store command without --confirm and asc reads: a verb of ${READ_VERBS// /, }, asc search, --help, or --dry-run without --confirm."
}

# check_store — refuses WORDS that name a store script beside a `--confirm`.
check_store() {
  local word store=0 confirm=0
  for word in "${WORDS[@]}"; do
    [[ "$word" =~ ^store:[[:alnum:]] || "$word" =~ (^|/)store-[[:alnum:]-]+\.ts$ ]] && store=1
    [[ "$word" == --confirm || "$word" == --confirm=* ]] && confirm=1
  done
  ((store && confirm)) && refuse "runs a store command with --confirm, which writes to App Store Connect."
  return 0
}

# check_asc — refuses WORDS that run asc and are no read, judged by the verb: `--confirm` is no signal
# alone, as `prices set` and `metadata apply` write without it.
check_asc() {
  [[ "${WORDS[0]##*/}" == asc ]] || return 0
  local word flag verb="" shown=0 in_flags=0 hidden=0 dry=0 confirm=0 help=0
  for word in "${WORDS[@]:1}"; do
    # A redirection ends asc's arguments: `2>` or `>out.json` is no verb.
    [[ "$word" =~ ^[0-9]*[\<\>] ]] && break
    if [[ "$word" == -* ]]; then
      in_flags=1
      # asc reads a flag with one dash or two, and the last value wins. Any --confirm counts,
      # `--confirm=false` too; any other value of --dry-run unsets it.
      flag=${word#-}
      flag=${flag#-}
      case "$flag" in
        confirm | confirm=*) confirm=1 ;;
        dry-run | dry-run=true) dry=1 ;;
        dry-run=*) dry=0 ;;
        help | h) help=1 ;;
      esac
    elif ((!in_flags)); then
      # The one word after `show` is what it shows, `asc docs show reference`: no other verb takes one.
      if [[ "$verb" == show ]] && ((!shown)); then
        shown=1
      else
        verb=$word
      fi
    elif [[ -z "$verb" ]]; then
      # asc takes root flags before the command, `asc --profile owner metadata apply`.
      hidden=1
    fi
  done
  ((help)) && return 0
  ((hidden)) && refuse "puts a flag before the asc command, which hides its verb. Put every flag after the command."
  # `asc search <query>` searches asc's own command index, locally: its words are a query, no verb.
  [[ "${WORDS[1]:-}" == search ]] && ((!confirm)) && return 0
  ((dry && !confirm)) && return 0
  [[ -z "$verb" ]] && ((!confirm)) && return 0
  [[ " $READ_VERBS " == *" $verb "* ]] && ((!confirm)) && return 0
  refuse "would change App Store Connect."
}

# Alone on the payload the guard gets the command as typed: a heredoc body is a file, not a command,
# and a line ending in a backslash runs joined to the next, `--confirm` included.
SCAN=$(printf '%s\n' "$GUARD_COMMAND" | guard_strip_heredocs | guard_join_continuations)
while IFS= read -r segment; do
  case "$segment" in
    *asc* | *store:* | *store-*) ;;
    *) continue ;;
  esac
  WORDS=()
  while IFS= read -r word; do WORDS+=("$word"); done < <(guard_words "$segment")
  guard_unwrap_words
  [[ ${#WORDS[@]} -gt 0 ]] || continue
  check_store
  check_asc
done < <(guard_segments "$(guard_mask_quoted_separators "$SCAN")")

exit 0
