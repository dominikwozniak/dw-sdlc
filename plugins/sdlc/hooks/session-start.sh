#!/bin/bash
# SessionStart report, as additionalContext: what a fresh context should know before its first
# turn, listed in README.md#session-start. Reports, never installs: a setup's timing is unknown, so
# the session is told what the checkout lacks and decides. Nothing to say means no output at all.
set -uo pipefail
export LC_ALL=C

REPORT=""
say() { REPORT+="${REPORT:+$'\n'}$1"; }

# Without jq nothing below can run, and plain stdout reaches Claude for SessionStart.
if ! command -v jq >/dev/null 2>&1; then
  printf '%s\n' "guardrails: jq is missing, so every guard in this plugin is silent until it is installed (brew install jq)."
  exit 0
fi

source "${BASH_SOURCE[0]%/*}/lib.sh"
guard_read_payload "$@" || exit 0
cwd="$GUARD_CWD"

guard_config_load "$cwd"
if [[ -n "$GUARD_CONFIG_PROBLEMS" ]]; then
  say "agentic config: INVALID, the guards run on the strictest defaults until it is fixed:"
  while IFS= read -r line; do say "  $line"; done <<<"$GUARD_CONFIG_PROBLEMS"
fi

if main=$(guard_worktree_main "$cwd"); then
  worktree="$GUARD_CONFIG_ROOT"

  # 1. What .worktreeinclude would have copied and is not here: ignored in the main checkout AND
  #    matching a pattern, two ls-files runs intersected. The config layers and
  #    .claude/settings.local.json are skipped: a worktree reads them from the main checkout.
  include="$worktree/.worktreeinclude"
  [[ -f "$include" ]] || include="$main/.worktreeinclude"
  if [[ -f "$include" ]]; then
    missing=""
    while IFS= read -r rel; do
      [[ -n "$rel" ]] || continue
      case "$rel" in
        node_modules/* | */node_modules/* | .claude/worktrees/* | .git/*) continue ;;
        "$GUARD_COMMITTED_FILE" | "$GUARD_LOCAL_FILE" | .claude/settings.local.json) continue ;;
      esac
      [[ -e "$worktree/$rel" ]] || missing+="${missing:+, }$rel"
    done < <(comm -12 \
      <(git -C "$main" -c core.quotePath=false ls-files -o -i --exclude-standard | sort) \
      <(git -C "$main" -c core.quotePath=false ls-files -o -i --exclude-from="$include" | sort))
    [[ -n "$missing" ]] && say "worktree: .worktreeinclude files not present here: $missing. Copy them from $main."
  fi

  # 2. The setup a fresh checkout needs, from the config. Reported, not run.
  setup=$(jq -r '.worktree.setup | join("; ")' <<<"$GUARD_CONFIG")
  [[ -n "$setup" ]] && say "worktree: a fresh checkout still needs: $setup"
fi

[[ -n "$REPORT" ]] || exit 0
jq -n --arg c "$REPORT" '{hookSpecificOutput: {hookEventName: "SessionStart", additionalContext: $c}}'
exit 0
