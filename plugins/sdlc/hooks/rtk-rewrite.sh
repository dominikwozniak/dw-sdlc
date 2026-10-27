#!/bin/bash
# PreToolUse Bash — the plugin's one wiring of `rtk hook claude`, so a machine wires nothing by hand.
# Not a guard: it refuses nothing, and without rtk on the machine it says nothing.
#
# A worktree-isolated session (`claude -w`, a subagent worktree, the desktop app) refuses any Bash
# call whose git use it cannot read from the text, and it cannot read through the `rtk` wrapper:
# `rtk hook claude` returns `git status` as `rtk git status` in updatedInput, and the session refuses
# it with "runs rtk with a git command among its operands" — and `ls *` as `rtk ls *`, refused as
# "runs rtk with a value computed at runtime", though the model wrote no git at all. The check has no
# off switch (verified on Claude Code 2.1.302 with rtk 0.49.0), so in a linked worktree every command
# goes through unrewritten. Skipping the rewrite costs output compression and nothing else.
#
# Runs beside bash-guard.sh: hooks of one event run in parallel and one hook's updatedInput is not
# another's input, so the guards judge the command the model typed.
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

command -v rtk >/dev/null 2>&1 || exit 0
INPUT=$(cat)

rewrite() {
  printf '%s' "$INPUT" | rtk hook claude
  exit $?
}

# Without jq the payload cannot be read here; rtk reads it itself.
guard_read_payload <<<"$INPUT" || rewrite
guard_worktree_main "$GUARD_CWD" >/dev/null && exit 0
rewrite
