#!/usr/bin/env bash
# SessionStart hook: run the references plugin's Sync from this checkout over the references key of
# .ai/agentic.config.json and say where each clone stands. Never fails the session: offline or slow,
# a clone stays where it was and the line says so.
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
if out="$(node plugins/references/scripts/references-sync.ts 2>&1)"; then
  printf '%s\n' "$out"
else
  printf '%s\n' "$out"
  echo "references:sync failed (offline?): a clone stays where it was, a missing one stays missing. Run pnpm references:sync before relying on one."
fi
exit 0
