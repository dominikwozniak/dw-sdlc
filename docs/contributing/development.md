# Development

How to work on dw-sdlc itself. An agent reads [`AGENTS.md`](../../AGENTS.md) first: the map, the rules
and every command. How a change reaches `main` is [How a change lands](how-a-change-lands.md); how it
reaches a machine is [Releasing](releasing.md).

## Setup

Node 24 and pnpm, the version `package.json` pins. Never `npm`, `npx`, `yarn` or `bun`; a one-off
tool runs with `pnpm dlx`.

```bash
git clone git@github.com:dominikwozniak/dw-sdlc.git
cd dw-sdlc
pnpm install             # also installs the pre-commit and commit-msg hooks, through vp config
pnpm check               # the Gate, the gate.steps of .ai/agentic.config.json, then its Checks
pnpm exec vp check --fix # Vite+ formats, fixes what lint can, and type-checks, from vite.config.ts
pnpm references:sync     # clone the reference repositories on this machine
```

`pnpm check` is the one command a change must pass, and CI runs it too, with `pnpm test:content` in
place of `pnpm test` on a pull request that changes only content.

The repository's own supply chain is held the way the plugin holds a session: `pnpm-workspace.yaml`
refuses any dependency version younger than 7 days, exotic transitive sources and unlisted install
scripts. The research behind that and the plugin is in
[`research/agentic-guardrails/`](../research/agentic-guardrails/agentic-guardrails.md).

## From GitHub or from a clone

Added from GitHub with `--sparse .claude-plugin plugins packages`, the plugin is a snapshot of `main`
that `claude plugin update` refreshes, and the clone holds only the catalogue, the plugins and the
`dw-sdlc` package. The plugin reaches the package through its `dw-sdlc` link, which
`claude plugin install` copies as a real directory, so a hook and a skill run the package's
`dw-sdlc` bin. A clone without `packages` installs the plugin without it: the guards then drop
every config layer and run strictest, and no command of the package starts. Added from a clone with
`claude plugin marketplace add ./`, it runs live from that checkout, a broken edit included.

The daily install is the GitHub one. A session's guards run from that installed copy, never from the
working tree, so a guard you edit takes effect only after a release and `claude plugin update`. Until
then `pnpm test`, which spawns every hook on a real payload, is its proof.

## Working on a guard or a skill

- How the Bash guards read a command, the quote walker and their known limits:
  [the bash guard's parser](bash-guard.md).
- How a pull-request skill is measured: [evals](evals.md).
- Which docs and decision records own a file: `pnpm exec dw-sdlc primitives --paths <file>`.
