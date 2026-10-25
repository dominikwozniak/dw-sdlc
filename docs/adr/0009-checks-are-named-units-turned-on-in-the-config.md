---
status: accepted
---

# A Check is a named unit of the package that a repository turns on in its config

A rule in prose that no script enforces holds until the first agent skips it: a markdown budget, a
comment budget, a file-size Ratchet, a check that `AGENTS.md` names the Gate and every path it routes
to exists, a check that durable docs carry no changelog phrases. Each Check is a named unit the
`dw-sdlc` package ships, and a repository turns it on under `gate.checks` of
`.ai/agentic.config.json`, per Check `false`, `true` or its options; a script only one repository
needs joins through `gate.checks.run`. The Gate itself is `gate.command`, inferred as `pnpm check`
from the `check` script of `package.json`, and `gate.steps` names the toolchain commands the runner
spawns before the Checks. The key replaces `validation.commands`, a list of commands with nothing to
run them, under the same `version: 1`; its two readers are this repository and the package template.
A Ratchet's baseline is a committed file under `.ai/`.

## Consequences

A rule has to fit a Check's options or go through `run`, and a new Check reaches a repository with a
package release, since the schema refuses a name it does not know. Open Mercato's skills read
`validation.commands`; a repository on this config no longer feeds them. Prose rules in `AGENTS.md`
that nothing enforces, and a check script per repository with a generator to keep the copies alike,
were rejected.
