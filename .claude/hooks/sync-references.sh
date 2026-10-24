#!/usr/bin/env bash
# SessionStart hook: clone or update every repository references/AGENTS.md lists and say where each
# stands. Never fails the session: offline or slow, a clone stays where it was and the line says so.
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
if out="$(node scripts/references-sync.ts 2>&1)"; then
  printf '%s\n' "$out"
else
  printf '%s\n' "$out"
  echo "references:sync failed (offline?): a clone stays where it was, a missing one stays missing. Run pnpm references:sync before relying on one."
fi
exit 0
