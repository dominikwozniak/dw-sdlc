#!/bin/bash
# SessionStart hook: runs the Sync from the project directory and prints its lines, both streams, so
# the session starts knowing each Reference's directory, commit, repository and ref. A repository that
# declares no References gets no output. Never fails the session: offline or slow, a clone stays where
# it was and the last line says so.
sync="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/scripts/references-sync.ts"
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
out="$(node "$sync" 2>&1)"
status=$?
[[ -z "$out" ]] || printf '%s\n' "$out"
if ((status != 0)); then
  echo "references: the Sync failed, so each clone stays where it was and a missing one stays missing. Run node \"$sync\" before relying on one."
fi
exit 0
