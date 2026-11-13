---
status: accepted
---

# One `sdlc` plugin carries the guards, the Sync and the agent side of the Gate

The guards and the Sync shipped as two plugins, `guardrails` and `references`, and the Gate would be
a third: each enabled at user scope on every machine together, each with a version to bump, a setup
to run and a doctor to own, while the template's bootstrap installed one of them. They are one
plugin, `sdlc@dw-sdlc`, under `plugins/sdlc/`: the hooks, the skills `sdlc-setup`, `sdlc-doctor` and
`sdlc-references-add`, and a link to `packages/dw-sdlc`, which `claude plugin install` resolves to a
copy, so a hook and a skill run the code the package publishes (ADR 0008). The shape of ADR 0001
holds: one plugin from this marketplace, one shared library behind `${CLAUDE_PLUGIN_ROOT}`. The
plugin ADR 0006 named folds into it, and the Sync keeps running from the session-start hook, in
local sessions only. The domain is the delivery process, not one family of guards, and one line
installs it.

## Consequences

A machine takes every part or none; a guard-only or Sync-only install is not offered. Every change to
any part bumps the one version. The two plugins published before this are retired, and the skill
naming rule of `AGENTS.md`, built on the plugin name, is rewritten with them.
