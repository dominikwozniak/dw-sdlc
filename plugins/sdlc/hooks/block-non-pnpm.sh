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
# A redirect among them is the shell's, not npm's: `npm 2>&1 install`, `npm > log install`. Its `&` is
# \003 once guard_scopes has read the line, so both spell it.
NPM_REDIRECT=$'[0-9]*[&\003]?[<>][^[:space:]]+|[0-9]*(>>?|<)[[:space:]]+'"${NPM_VALUE}"
NPM_OPTS="([[:space:]]+(--?[A-Za-z][-A-Za-z0-9]*=${NPM_VALUE}|--?(${NPM_VALUE_OPTS})[[:space:]]+${NPM_VALUE}|--?[A-Za-z][-A-Za-z0-9]*|${NPM_REDIRECT}))*"
# The verbs that install, remove, update, link or rebuild a dependency, or run a script or a package,
# under every alias npm 11's lib/utils/cmd-list.js gives them and bun documents. A read passes:
# `npm view`, `npm ls`, an `npm audit` without `fix`, and bun's own `bun test` and `bun build`.
NPM_INSTALL='install|add|i|in|ins|inst|insta|instal|isnt|isnta|isntal|isntall|ci|clean-install|ic|install-clean|isntall-clean|install-test|it|install-ci-test|cit|clean-install-test|sit'
NPM_CHANGE='uninstall|unlink|remove|rm|r|un|update|u|up|upgrade|udpate|dedupe|ddp|prune|link|ln|rebuild|rb|audit'"$NPM_OPTS"'[[:space:]]+fix'
NPM_RUN='run|run-script|rum|urn|test|tst|t|start|stop|restart|exec|x|init|create|innit'
BUN_VERBS='install|i|add|remove|rm|uninstall|r|update|up|link|unlink|patch|run|x|create'
# Bare `npx`, `bunx` and `yarn` have no subcommand list: every form of them is the wrong package
# manager. `pnpm dlx` does not match — the boundary fires on a whole word, and `dlx` is not `npx`.
BLOCKED_PATTERNS=(
  'npm'"$NPM_OPTS"'[[:space:]]+('"$NPM_INSTALL|$NPM_CHANGE|$NPM_RUN"')'"$END"
  'yarn([[:space:]]|$)'
  'npx([[:space:]]|$)'
  'bunx([[:space:]]|$)'
  'bun[[:space:]]+('"$BUN_VERBS"')'"$END"
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
