#!/bin/bash
# SessionStart hook: runs the Sync from the project directory and hands its lines to the session.
# Always exits 0, so a failed Sync never blocks a session; its last line then says the clones stay
# where they were. The Sync is the dw-sdlc package's, reached through the plugin's `dw-sdlc` link.
bin="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/dw-sdlc/src/cli.ts"
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
out="$(node "$bin" references sync 2>&1)"
status=$?
[[ -z "$out" ]] || printf '%s\n' "$out"
if ((status != 0)); then
  echo "references: the Sync failed, so each clone stays where it was and a missing one stays missing. Run node \"$bin\" references sync from the project before relying on one."
fi
exit 0
