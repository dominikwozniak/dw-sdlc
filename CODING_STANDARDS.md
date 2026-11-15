# Coding standards

The judgement-call rules a Review holds a change to. A change that breaks one is a Finding, with this
file and the rule cited ([ADR 0025](docs/adr/0025-a-broken-coding-standard-is-a-finding.md)). A
mechanical rule is a Check, a lint rule or a guard, and is not here; the Gate runs those.
`AGENTS.md` has the map and the commands.

## Words

- Names, tests and docs use the terms of [`GLOSSARY.md`](GLOSSARY.md), never a synonym its _Avoid_ line
  lists ([domain docs](docs/agents/domain.md#use-the-glossarys-vocabulary)).
- A change that contradicts an ADR says so ([domain docs](docs/agents/domain.md#flag-adr-conflicts)).
- A skill's name is a verb where one fits, as `sdlc-sweep` and `sdlc-references-add`.
- An ADR or a `GLOSSARY.md` entry follows the `domain-modeling` skill and
  [domain docs](docs/agents/domain.md).
- A doc is written in the house voice: [`sdlc-pr-open`](plugins/sdlc/skills/sdlc-pr-open/SKILL.md)
  holds it, plain words and short sentences.

## Guards

- A guard catches an agent's ordinary commands, not a deliberate evasion
  ([ADR 0017](docs/adr/0017-guards-catch-ordinary-commands-not-deliberate-evasion.md)), and its
  refusal names the allowed alternative.
- A guard scanner reads quotes only through `guard_quote_walk`, judges what the shell runs, and stays
  linear on bash 3.2 ([the bash guard's parser](docs/contributing/bash-guard.md#the-quote-walker)).
- A guard test spawns the hook on the real payload and builds every input in a scratch directory
  ([plugin internals](docs/contributing/plugin-internals.md#tests)).
- The Known limits in `plugins/sdlc/README.md` stay in step with the guards: a fix removes its line, a
  new limit gets a ticket and a regression test
  ([Known limits](plugins/sdlc/README.md#known-limits)). The layout of the plugin is in
  [plugin internals](docs/contributing/plugin-internals.md#layout).

## Skills and the reviewer

- A skill or the reviewer agent follows the `writing-for-agents` skill.

## The package

- A Check judges the tree, never a diff
  ([ADR 0009](docs/adr/0009-checks-are-named-units-turned-on-in-the-config.md)), and every Finding it
  reports carries a remedy; `packages/dw-sdlc/src/checks/index.ts` wires it.
- A subcommand exits 0, 1 or 2 as its `--help` says, prints `CannotRun` from the bin alone, and runs git
  through `packages/dw-sdlc/src/git.ts`.
