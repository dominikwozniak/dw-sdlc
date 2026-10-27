#!/bin/bash
# Refuses npm, npx, yarn and bun where the package manager is pnpm: README.md#guards. Every install
# goes through pnpm, so the repository's `minimumReleaseAge` and `strictDepBuilds` apply; `pnpm dlx`
# replaces npx one for one. A guardrail against agent habit, not a security boundary.
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

guard_read_payload "$@" || exit 0
[[ -n "$GUARD_COMMAND" ]] || exit 0
case "$GUARD_COMMAND" in
  *npm* | *npx* | *yarn* | *bun*) ;;
  *) exit 0 ;;
esac

guard_config_load "$GUARD_CWD" || exit 0
[[ "$(guard_config_get '.packageManagers.node')" == "pnpm" ]] || exit 0

END='([^A-Za-z0-9_-]|$)'
# Bare `npx` and bare `yarn` have no subcommand list: every form of them is the wrong package
# manager. `pnpm dlx` does not match — the boundary fires on a whole word, and `dlx` is not `npx`.
BLOCKED_PATTERNS=(
  'npm[[:space:]]+(install|i|add|ci|update|upgrade|exec|run)'"$END"
  'yarn([[:space:]]|$)'
  'npx([[:space:]]|$)'
  'bun[[:space:]]+(install|i|add|remove|update|run|x)'"$END"
)

# Separators inside quotes are text: `git commit -m "ci: replace | yarn with pnpm"` names the thing,
# it does not run it. The quotes themselves stay so `rtk run "npm install"` still matches.
SCAN=$(guard_mask_quoted_separators "$GUARD_COMMAND")
for pattern in "${BLOCKED_PATTERNS[@]}"; do
  if printf '%s\n' "$SCAN" | grep -qE "${GUARD_BOUNDARY}${pattern}"; then
    guard_block "'$GUARD_COMMAND' uses npm, npx, yarn or bun, and this repository's package manager is pnpm (packageManagers.node). Use 'pnpm install', 'pnpm add <pkg>', or 'pnpm dlx <cmd>' to run a tool without installing it."
  fi
done

exit 0
