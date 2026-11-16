# Development

How to work on dw-sdlc itself. An agent reads [`AGENTS.md`](../../AGENTS.md) first: the map, the rules
and every command. How a change reaches `main` is [How a change lands](how-a-change-lands.md); how it
reaches a machine is [Releasing](releasing.md).

## Setup

Node 24 and pnpm, the version `package.json` pins; the package manager rules are in
[`AGENTS.md`](../../AGENTS.md#tooling).

```bash
git clone git@github.com:dominikwozniak/dw-sdlc.git
cd dw-sdlc
pnpm install             # also installs the git hooks, through vp config
pnpm check               # the Gate, the gate.steps of .ai/agentic.config.json, then its Checks
pnpm exec vp check --fix # Vite+ formats, fixes what lint can, and type-checks, from vite.config.ts
pnpm references:sync     # clone the reference repositories on this machine
```

`pnpm check` is the one command a change must pass, and CI runs it too
([how a change lands](how-a-change-lands.md)).

The repository's own supply chain is held the way the plugin holds a session, through
`pnpm-workspace.yaml`. The research behind that and the plugin is in
[`research/agentic-guardrails/`](../research/agentic-guardrails/agentic-guardrails.md).

## From GitHub or from a clone

Added from GitHub with `--sparse .claude-plugin plugins packages`, the plugin is a snapshot of `main`
that `claude plugin update` refreshes, and the clone holds only the catalogue, the plugins and the
`dw-sdlc` package. The plugin reaches the package through its `dw-sdlc` link, which
`claude plugin install` copies as a real directory, so a hook and a skill run the package's
`dw-sdlc` bin. A clone without `packages` installs the plugin without it: the guards then drop
every config layer and run strictest, and no command of the package starts. Added from a clone with
`claude plugin marketplace add ./`, it runs live from that checkout, a broken edit included.

The daily install is the GitHub one. A session's guards run from that installed copy, not from the
working tree ([`AGENTS.md`](../../AGENTS.md#tooling)).

## Working on a guard or a skill

- How the Bash guards read a command, the quote walker and their known limits:
  [the bash guard's parser](bash-guard.md).
- How a pull-request skill and the `sdlc-reviewer` agent are measured: [evals](evals.md).
- Which docs and decision records own a file: `pnpm exec dw-sdlc primitives --paths <file>`.
