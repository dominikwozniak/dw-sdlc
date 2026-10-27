#!/bin/bash
# Refuses an agent every change to App Store Connect. `asc`, its CLI, reaches the whole account from
# any directory with the owner's Keychain key, so this guard is on in every repository and reads no
# config: only the owner writes to the store, at a terminal.
#
# Two refusals, judged on each command's shell words with the wrappers off. `--confirm` on any store
# command: a word naming a `store:<name>` script or a `store-<name>.ts` file, one not written yet
# included, beside a `--confirm` word, quoted or not. A store command without it runs,
# `store:price-levels --write` included. And every `asc` call that is not a read: a read's verb, the
# last word before the first flag, is in READ_VERBS — list, view, show, summary, status, the
# listing's pull, plan, diff, validate, audit, download, init, approve, sizes, and the asset
# library's specs and placements — or the call is `asc search <query>`, which searches asc's own
# command index locally, has `--help`, no verb at all (`asc --version`), or `--dry-run` without
# `--confirm`. The verb comes from under any command: `metadata keywords audit`
# reads, `metadata keywords push` writes, `localizations placements create` writes; `show` alone
# takes a word after it, the guide `asc docs show` prints. A flag before the command is refused,
# since which word is its value is unknown, and so is the verb. `prices set`, `offers introductory
# create`, `metadata apply` and `metadata push` write without any `--confirm`, so the flag alone is
# no signal. Under a verb `--version` is the app's, not asc's.
#
# Guardrail against agent accidents, not a security boundary. Spawned by bash-guard.sh when the
# command names `asc` or a store script; runs alone on the JSON payload too.
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

# check_asc — refuses WORDS that run asc and are no read.
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
