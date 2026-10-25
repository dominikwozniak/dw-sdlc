---
status: superseded by ADR 0008 and ADR 0010
---

# The Sync ships as one plugin and runs in local Claude Code sessions only

A sync script copied into each repository drifts: the copies split into two table formats, and a fix
made in one reaches none of the others. The Sync, its `SessionStart` hook and the skill that adds a
Reference are the `references` plugin in this repository's marketplace, enabled at user scope like
`guardrails` (ADR 0001); a repository that declares no References gets no output from it. A pinned
npm CLI needs a publish pipeline, a token and a week of `minimumReleaseAge` before a fix of its own
reaches a repository, and a copy-in generator needs a drift check of its own.

## Consequences

A cloud session installs no plugin a repository enables, and Codex and a plain terminal load none, so
a Reference there is what the last local session left on disk, or nothing. The first consumer outside
a local Claude Code session is the signal to reopen this: the script has no dependencies, so it moves
into a pinned CLI whole. A repository hook running the same Sync goes, since Claude Code runs a
plugin's hook and a settings hook side by side.
