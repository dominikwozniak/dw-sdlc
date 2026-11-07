# dw-sdlc

**The software delivery process Dominik works by, and the Claude Code tooling that carries it.**

A plugin marketplace and the code behind it. The process is proven in this repository before it goes
wider. The marketplace ships two plugins. `sdlc` carries the guards, the Sync of the repositories an
agent reads for prior art, and four skills: `/sdlc-setup` sets a repository up, `/sdlc-doctor` checks a
machine, `/sdlc-references-add` adds a Reference, `/sdlc-pr-ship` ships a pull request.
[`sdlc-sessions`](plugins/sdlc-sessions/README.md) depends on it and carries `/sdlc-recap`, which says
where a session stands, `/sdlc-brief`, which writes the start of a Worker session, and `/sdlc-delegate`,
which makes a session a Lead that runs Workers.

## Install

```bash
claude plugin marketplace add dominikwozniak/dw-sdlc --sparse .claude-plugin plugins packages
claude plugin install sdlc@dw-sdlc --scope user
```

`--sparse` checks out only the catalogue, the plugins and the `dw-sdlc` package they link to, not the
docs and tooling around them. The repository is private, so the clone uses your git credentials.

> [!NOTE]
> The guards need `jq`. Without it every guard is silent, and the doctor says so.

## Why guardrails

- **An agent runs shell commands and edits files.** One wrong call rewrites history or leaks a secret.
- **A guard judges each call before it runs.** It says no, asks, or stays silent. Nothing else changes.
- **The rules come from the repository.** `.ai/agentic.config.json` declares them; a machine may tighten, never loosen.
- **A broken config runs the strictest set.** A typo can never quietly switch a guard off.
- **The `sdlc` plugin, one line to enable.** No hooks copied into every repository, nothing to drift.

## Setup

In a repository you work on, run the setup skill in Claude Code. It shows a dry run first, writes
this machine's local layer, and ends with the doctor: one PASS / WARN / FAIL line per machine check.

```bash
/sdlc-setup
```

The doctor ships in the plugin and needs only Node 24. `/sdlc-doctor` runs it again; from a terminal
in the repository:

```bash
node <plugin root>/dw-sdlc/src/cli.ts doctor
```

`claude plugin list --json` names the plugin root as the `installPath` of `sdlc@dw-sdlc`.

## What it stops

| guard                 | refuses                                                                                                     |
| --------------------- | ----------------------------------------------------------------------------------------------------------- |
| dangerous commands    | `reset --hard`, `clean -fd`, `stash clear`, remote branch deletion, `rm` at `/` `~` `.`, `find -delete`     |
| forced delete         | `branch -D` of a branch not yet on the base, `-M`, `worktree remove --force`, `stash drop`                  |
| lost-commit record    | `reflog expire`, `gc --prune=now`, `prune`, `update-ref -d`, `rm -rf .git`                                  |
| force push            | bare `push --force`; a lease push passes, or asks first under `forcePush: ask`, never to a protected branch |
| plain push            | any push straight to a protected branch: those take pull requests                                           |
| commit                | a commit, merge, cherry-pick or revert on a protected branch, under `commitOnProtected: deny`               |
| GitHub CLI            | `gh repo delete`, `gh pr merge --delete-branch`, a `gh api` call that deletes or force-moves a ref          |
| env access            | `.env`, `.env.*`, `.envrc` outside the config's allow list or unknown to git                                |
| credential leak       | reading `~/.ssh`, `~/.aws`, `~/.kube` and friends; `curl` or `wget` carrying a secret                       |
| package manager       | `npm`, `npx`, `yarn`, `bun` in a pnpm repository                                                            |
| commit hygiene        | a subject off the convention, a missing trailer, `git add -A` with no path, `git add .`                     |
| App Store Connect     | every `asc` write and `--confirm` on a store script, in every repository; reads and `--dry-run` pass        |
| large file (advisory) | flags a written file over 256 KiB                                                                           |

Each rule holds at every command position: an indented line, a loop, a subshell, behind `sudo`,
`xargs`, `timeout`, `find -exec` or `bash -c`, and in a heredoc a shell reads. Every rule in full:
[plugin README](plugins/sdlc/README.md#guards). A commit typed in a
terminal meets the same subject rule through the [commit hook](plugins/sdlc/README.md#commit-hook).

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
on one machine only, `/sdlc-setup ticket-key` pins it in the local layer instead.
A repository where every change starts on a branch sets `"guardrails": { "commitOnProtected": "deny" }`;
on one machine only, `/sdlc-setup` with `--commit-on-protected deny` pins it, and `--force-push ask`
asks before each lease push.
Every key: [schema](packages/dw-sdlc/config/agentic.config.schema.json).

## References

A Reference is a repository cloned under `references/` so an agent reads how a problem was solved
before. A repository declares its References in `.ai/references.json`, and the plugin brings each
one to its ref when a local Claude Code session starts: one line per Reference, and nothing at all
in a repository without the file. Offline, a clone stays where it was and the session starts
anyway. The file and the Sync in full: [plugin README](plugins/sdlc/README.md#references).

## Ship

`dw-sdlc pr ship` is the Ship script: it drives one pull request to merged, and `/sdlc-pr-ship` runs it
for the agent. How it merges: [overview](docs/overview.md#how-the-ship-script-merges-a-pull-request).

## Docs

[how it works, why, releasing](docs/overview.md) · [plugin README](plugins/sdlc/README.md) · [decisions](docs/adr/) · [terms](GLOSSARY.md) · [Router](references/AGENTS.md)

## Agent instructions

An agent working on this repository reads [`AGENTS.md`](AGENTS.md) before changing anything (`CLAUDE.md` is a symlink to it).
A repository adopting the plugin declares its rules in `.ai/agentic.config.json`.

## Development

```bash
git clone git@github.com:dominikwozniak/dw-sdlc.git
cd dw-sdlc
pnpm install           # also installs the pre-commit and commit-msg hooks, through vp config
pnpm check             # the Gate, the gate.steps of .ai/agentic.config.json; the same as CI
pnpm exec vp check --fix # Vite+ formats, fixes what lint can, and type-checks, from vite.config.ts
pnpm references:sync   # clone the reference repositories on this machine
```
