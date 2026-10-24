#!/bin/bash
# SessionStart hook: runs the Sync from the project directory and hands its lines to the session.
# Always exits 0, so a failed Sync never blocks a session; its last line then says the clones stay
# where they were.
script="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/scripts/references-sync.ts"
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
out="$(node "$script" 2>&1)"
status=$?
[[ -z "$out" ]] || printf '%s\n' "$out"
if ((status != 0)); then
  echo "references: the Sync failed, so each clone stays where it was and a missing one stays missing. Run node \"$script\" from the project before relying on one."
fi
exit 0
