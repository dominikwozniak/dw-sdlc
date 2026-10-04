#!/bin/bash
# PreToolUse Bash dispatcher — the one hook the manifest wires for matcher "Bash". One stdin read,
# one jq parse, heredoc bodies dropped once, and each guard spawned only when the command could
# trip it. A guard gets the scan text on stdin — environ shares the exec size limit, and a long
# enough command in it once killed every spawn with 126, so no guard ran and the call went through —
# and the payload's cwd as argv, which is what its config lookup keys on.
#
# The lists below are the whole policy of the plugin, and a guard's own self-test cannot see them:
# test/hooks/bash-guard.test.ts is what pins that a guard is spawned at all.
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

guard_read_payload "$@" || exit 0
[[ -n "$GUARD_COMMAND" ]] || exit 0

SCAN=$(printf '%s\n' "$GUARD_COMMAND" | guard_strip_heredocs | guard_join_continuations)

# run <guard> [text] — the scan on stdin unless another text is given. A guard pruned from the
# directory is a skip, not a failure.
run() {
  [[ -f "$GUARD_LIB_DIR/$1" ]] || return 0
  printf '%s' "${2-$SCAN}" | bash "$GUARD_LIB_DIR/$1" --bash-command "$GUARD_CWD"
}

# guard <guard> [text] — A refusal (exit 2) or an ask (a JSON verdict on stdout) stops the chain; two
# verdicts would not parse as one. Any other non-zero is a broken guard rather than a verdict — say
# so, and let the guards below it still run. The always-on guards come first, so a refusal beats a
# later ask.
guard() {
  local out rc
  out=$(run "$1" "${2-$SCAN}")
  rc=$?
  [[ $rc -eq 2 ]] && exit 2
  if [[ $rc -ne 0 ]]; then
    echo "bash-guard.sh: $1 exited $rc, which is not a refusal — the remaining guards still ran, but this one needs fixing." >&2
    return 0
  fi
  if [[ -n "$out" ]]; then
    printf '%s\n' "$out"
    exit 0
  fi
  return 0
}

# Always-on guards run on every command. block-env-access is wired separately for the file tools;
# its Bash leg runs from here.
guard block-dangerous-commands.sh
guard credential-leak-guard.sh
guard block-env-access.sh

# Trigger-scoped guards run only when a substring says they could fire; the substring
# over-approximates on purpose and the guard does the exact match. `npx` needs its own arm: it
# shares no substring with `npm`, and a trigger list without it means the guard is never spawned no
# matter what its own patterns say.
case "$SCAN" in
  *npm* | *npx* | *yarn* | *bun*) guard block-non-pnpm.sh ;;
esac
# The commit guard alone gets the command as typed: a heredoc body is where a multi-line commit
# message is most often written, and the guard drops the other bodies itself.
case "$SCAN" in
  *git*commit* | *git*add*) guard enforce-commit-hygiene.sh "$GUARD_COMMAND" ;;
esac

exit 0
