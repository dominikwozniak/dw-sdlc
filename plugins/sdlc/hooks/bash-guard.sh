#!/bin/bash
# PreToolUse Bash dispatcher, the hook that runs every guard on a Bash call: README.md#layout. Its
# trigger lists are the plugin's whole policy, which a guard's own self-test cannot see, so
# test/hooks/bash-guard.test.ts pins that each guard is spawned at all.
set -uo pipefail
source "${BASH_SOURCE[0]%/*}/lib.sh"

guard_read_payload "$@"
rc=$?
if [[ $rc -eq $GUARD_UNREADABLE ]]; then
  echo "bash-guard.sh: refused, the payload cannot be read: it is not JSON, or a field holds U+0001, the byte the reader splits on. No guard could judge this call; send it without the byte." >&2
  exit 2
fi
[[ $rc -eq 0 ]] || exit 0
[[ -n "$GUARD_COMMAND" ]] || exit 0

SCAN=$(printf '%s\n' "$GUARD_COMMAND" | guard_strip_heredocs | guard_join_continuations)

# run <guard> [text] — the scan, or another text, on stdin and on this dispatcher's own bash; a pruned
# guard is a skip. Never the environment: it shares the exec size limit, and a long command there
# fails every spawn with 126, so no guard runs and the call goes through. The cwd travels as argv.
run() {
  [[ -f "$GUARD_LIB_DIR/$1" ]] || return 0
  printf '%s' "${2-$SCAN}" | "$BASH" "$GUARD_LIB_DIR/$1" --bash-command "$GUARD_CWD"
}

# guard <guard> [text] — a refusal (exit 2) stops the chain; an ask, a JSON verdict on stdout, waits
# for every guard, so a later refusal still wins, and only the first prints, as two would not parse.
# Any other non-zero is a broken guard, not a verdict: say so, and run the guards below it.
ASK=""
guard() {
  local out rc
  out=$(run "$1" "${2-$SCAN}")
  rc=$?
  [[ $rc -eq 2 ]] && exit 2
  if [[ $rc -ne 0 ]]; then
    echo "bash-guard.sh: $1 exited $rc, which is not a refusal — the remaining guards still ran, but this one needs fixing." >&2
    return 0
  fi
  [[ -n "$out" && -z "$ASK" ]] && ASK="$out"
  return 0
}

# Always-on guards run on every command. block-env-access is wired separately for the file tools;
# its Bash leg runs from here.
guard block-dangerous-commands.sh
guard credential-leak-guard.sh
guard block-env-access.sh

# Trigger-scoped guards run only when a substring says they could fire; the substring
# over-approximates and the guard does the exact match. `npx` needs its own arm: it shares no
# substring with `npm`, and without it the guard is never spawned, whatever its own patterns say.
case "$SCAN" in
  *npm* | *npx* | *yarn* | *bun*) guard block-non-pnpm.sh ;;
esac
case "$SCAN" in
  *asc* | *store:* | *store-*) guard block-store-writes.sh ;;
esac
# A pipe is the only way a filter reads a check command's output; the guard finds the command.
case "$SCAN" in
  *'|'*) guard block-filtered-output.sh ;;
esac
# The commit guard alone gets the command as typed: a heredoc body is where a multi-line commit
# message is most often written, and the guard drops the other bodies itself.
case "$SCAN" in
  *git*commit* | *git*add*) guard enforce-commit-hygiene.sh "$GUARD_COMMAND" ;;
esac

[[ -n "$ASK" ]] && printf '%s\n' "$ASK"
exit 0
