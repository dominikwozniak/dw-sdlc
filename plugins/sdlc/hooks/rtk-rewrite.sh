#!/bin/bash
# PreToolUse Bash — the plugin's one wiring of `rtk hook claude`: not a guard, and silent without
# rtk. In a linked worktree every command goes through unrewritten: README.md#guards says why.
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
