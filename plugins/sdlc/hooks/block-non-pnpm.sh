#!/bin/bash
# Refuses npm, npx, yarn and bun where the package manager is pnpm: README.md#guards. Every install
# goes through pnpm, so the repository's `minimumReleaseAge` and `strictDepBuilds` apply; `pnpm dlx`
# replaces npx one for one. A guardrail against agent habit, not a security boundary.
set -uo pipefail
source "${BASH_SOURCE[0]%/*}/lib.sh"

guard_read_payload "$@" || exit 0
[[ -n "$GUARD_COMMAND" ]] || exit 0
case "$GUARD_COMMAND" in
  *npm* | *npx* | *yarn* | *bun*) ;;
  *) exit 0 ;;
esac

END='([^A-Za-z0-9_-]|$)'
# npm reads its first operand as the command, so an option before it changes nothing: `npm -g install`,
# `npm --prefix app ci`. These options take their value as the next word; every other one stands alone.
NPM_VALUE_OPTS='prefix|workspace|w|registry|cache|userconfig|globalconfig|loglevel|tag|otp|include|omit|install-strategy'
NPM_VALUE='("[^"]*"|'"'"'[^'"'"']*'"'"'|[^[:space:]]+)'
NPM_OPTS="([[:space:]]+(--?[A-Za-z][-A-Za-z0-9]*=${NPM_VALUE}|--?(${NPM_VALUE_OPTS})[[:space:]]+${NPM_VALUE}|--?[A-Za-z][-A-Za-z0-9]*))*"
# Bare `npx` and bare `yarn` have no subcommand list: every form of them is the wrong package
# manager. `pnpm dlx` does not match — the boundary fires on a whole word, and `dlx` is not `npx`.
BLOCKED_PATTERNS=(
  'npm'"$NPM_OPTS"'[[:space:]]+(install|i|add|ci|update|upgrade|exec|run)'"$END"
  'yarn([[:space:]]|$)'
  'npx([[:space:]]|$)'
  'bun[[:space:]]+(install|i|add|remove|update|run|x)'"$END"
)

# blocked_in <text> — 0 when one command of the text is a blocked one.
blocked_in() {
  local pattern
  for pattern in "${BLOCKED_PATTERNS[@]}"; do
    printf '%s\n' "$1" | grep -qE "${GUARD_BOUNDARY}${pattern}" && return 0
  done
  return 1
}

# Separators inside quotes are text: `git commit -m "ci: replace | yarn with pnpm"` names the thing,
# it does not run it. The quotes themselves stay so `rtk run "npm install"` still matches.
SCAN=$(guard_mask_quoted_separators "$GUARD_COMMAND")
blocked_in "$SCAN" || exit 0

# The package manager is the one of the repository the command runs in, and a `cd` moves that: each
# blocked command is judged where the shell stands at it. A command the walk does not place, a
# wrapper's quoted one, stands where the session does.
DIRS=""
while IFS= read -r segment; do
  guard_scope_step "$segment" || continue
  blocked_in "$segment" && DIRS+="$GUARD_SHELL_DIR"$'\n'
done < <(guard_scopes "$SCAN")
[[ -n "$DIRS" ]] || DIRS="$GUARD_CWD"$'\n'

while IFS= read -r dir; do
  [[ -n "$dir" ]] || continue
  guard_config_load "$dir" || exit 0
  if [[ "$(guard_config_get '.packageManagers.node')" == "pnpm" ]]; then
    guard_block "'$GUARD_COMMAND' uses npm, npx, yarn or bun, and this repository's package manager is pnpm (packageManagers.node). Use 'pnpm install', 'pnpm add <pkg>', or 'pnpm dlx <cmd>' to run a tool without installing it."
  fi
done <<<"$DIRS"

exit 0
