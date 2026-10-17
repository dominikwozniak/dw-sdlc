# dw-sdlc

**The software delivery process Dominik works by, and the Claude Code tooling that carries it.**

A plugin marketplace and the code behind it. The process is proven in this repository before it goes
wider. Today the marketplace ships one plugin, `guardrails`.

## Install

```bash
claude plugin marketplace add dominikwozniak/dw-sdlc --sparse .claude-plugin plugins
claude plugin install guardrails@dw-sdlc --scope user
```

`--sparse` checks out only the catalogue and the plugins, not the docs and tooling around them. The
repository is private, so the clone uses your git credentials.

> [!NOTE]
> The hooks need `jq`. Without it every guard is silent, and the doctor says so.

## Why guardrails

- **An agent runs shell commands and edits files.** One wrong call rewrites history or leaks a secret.
- **A guard judges each call before it runs.** It says no, asks, or stays silent. Nothing else changes.
- **The rules come from the repository.** `.ai/agentic.config.json` declares them; a machine may tighten, never loosen.
- **A broken config runs the strictest set.** A typo can never quietly switch a guard off.
- **One plugin, one line to enable.** No hooks copied into every repository, nothing to drift.

## Setup

In a repository you work on, run the setup skill in Claude Code. It shows a dry run first, then writes
this machine's local layer:

```bash
/guardrails-setup
```

The doctor runs from a checkout of this repository and prints one PASS / WARN / FAIL line per machine
check:

```bash
pnpm guardrails:doctor --root <path to your repository>
```

## What it stops

| guard                 | refuses                                                                                                     |
| --------------------- | ----------------------------------------------------------------------------------------------------------- |
| dangerous commands    | `reset --hard`, `clean -fd`, `stash clear`, remote branch deletion, `rm` at `/` `~` `.`, `find -delete`     |
| forced delete         | `branch -D`, `worktree remove --force`, `stash drop`; a plain `branch -d` or `worktree remove` passes       |
| force push            | bare `push --force`; a lease push passes, or asks first under `forcePush: ask`, never to a protected branch |
| plain push            | any push straight to a protected branch: those take pull requests                                           |
| env access            | `.env`, `.env.*`, `.envrc` outside the config's allow list or unknown to git                                |
| credential leak       | reading `~/.ssh`, `~/.aws`, `~/.kube` and friends; `curl` or `wget` carrying a secret                       |
| package manager       | `npm`, `npx`, `yarn`, `bun` in a pnpm repository                                                            |
| commit hygiene        | a subject off the convention, a missing trailer, `git add -A` with no path, `git add .`                     |
| App Store Connect     | every `asc` write and `--confirm` on a store script, in every repository; reads and `--dry-run` pass        |
| large file (advisory) | flags a written file over 256 KiB                                                                           |

Every rule in full: [plugin README](plugins/guardrails/README.md#guards). A commit typed in a
terminal meets the same subject rule through the [commit hook](plugins/guardrails/README.md#commit-hook).

## Configure your repository

```json
{
  "$schema": "https://raw.githubusercontent.com/dominikwozniak/dw-sdlc/main/plugins/guardrails/config/agentic.config.schema.json",
  "version": 1,
  "guardrails": { "protectedBranches": ["main"] }
}
```

Everything unset is inferred: the package manager from the lockfile, Conventional Commits for the
subject. A repository whose subjects start with a ticket key sets `"commit": { "convention": "ticket-key" }`;
on one machine only, `/guardrails-setup ticket-key` pins it in the local layer instead.
Every key: [schema](plugins/guardrails/config/agentic.config.schema.json).

## Docs

[how it works, why, releasing](docs/overview.md) · [plugin README](plugins/guardrails/README.md) · [decisions](docs/adr/) · [terms](GLOSSARY.md) · [references](references/AGENTS.md)

## Agent instructions

An agent working on this repository reads [`AGENTS.md`](AGENTS.md) before changing anything (`CLAUDE.md` is a symlink to it).
A repository adopting the plugin declares its rules in `.ai/agentic.config.json`.

## Development

```bash
git clone git@github.com:dominikwozniak/dw-sdlc.git
cd dw-sdlc
pnpm install
pnpm check             # lint + format + typecheck + test, the same as CI
pnpm references:sync   # clone the reference repositories on this machine
```
