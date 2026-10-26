---
status: accepted
---

# The guards ship as one plugin from this repository's marketplace

Claude Code merges hooks from every scope and runs them all, so a guard needs to live in one place
only. The guards are the `guardrails` plugin under `plugins/guardrails/`, published through this
repository's own marketplace `dw-sdlc`: one `enabledPlugins` line installs them for a user in every
repository, and `${CLAUDE_PLUGIN_ROOT}` gives every guard the one shared `lib.sh`. Hook files copied
into each repository's `.claude/hooks/`, or wired by hand in `~/.claude/settings.json`, carry the
shared library in every copy and drift apart.

## Consequences

Added from GitHub with `--sparse .claude-plugin plugins`, a machine runs a snapshot of `main` that
`claude plugin update` refreshes, and the clone carries none of the repository's docs or tooling. A
marketplace added from a checkout runs the plugin live from it, so an edit here is in the next session
on that machine, a broken one included.
