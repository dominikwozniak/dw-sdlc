# dw-sdlc

**Claude Code tooling that holds my agentic workflow where the engineering skills leave it loose:
guards on every tool call, a Gate that proves a change, and the road from a pull request to merged. It
extends those skills and replaces none.**

Built for how I work; shared as-is. Issues are open, outside pull requests are not merged:
[CONTRIBUTING.md](CONTRIBUTING.md).

The engineering skills are [`mattpocock/skills`](https://github.com/mattpocock/skills): they plan,
build and review the work. dw-sdlc is a plugin marketplace with two plugins and the `dw-sdlc` package
behind them. [`sdlc`](plugins/sdlc/README.md) carries the guards, the session hooks and the skills that
set a repository up and ship a pull request. [`sdlc-sessions`](plugins/sdlc-sessions/README.md) carries
the skills that run sessions: a Recap, a Brief, a Lead with Workers.

## What it adds

| stage                       | the engineering skills                                       | dw-sdlc                                              |
| --------------------------- | ------------------------------------------------------------ | ---------------------------------------------------- |
| plan, settle, write tickets | `wayfinder`, `grilling`, `research`, `to-spec`, `to-tickets` | nothing                                              |
| hand work to a session      | nothing                                                      | `/sdlc-kickoff`, `/sdlc-delegate`                    |
| implement                   | `implement`, `implement-spec`, `tdd`                         | the guards judge every tool call; the Gate proves it |
| open the pull request       | nothing                                                      | `/sdlc-pr-open`                                      |
| review, fix CI, merge       | `code-review`, the reviewer at `full` depth by default       | `/sdlc-pr-ship`: the Review loop and the Ship script |
| close the session           | `handoff`                                                    | `/sdlc-recap`, `/sdlc-sweep`                         |

Where each one starts and stops: [overview](docs/overview.md#where-dw-sdlc-sits-beside-the-engineering-skills).

## Requirements

| tool                                                            | needed for                                                          | without it                                                        |
| --------------------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Claude Code, git, bash                                          | everything                                                          | nothing runs                                                      |
| `jq`                                                            | every guard                                                         | every guard is silent; the session start and the doctor say so    |
| Node 24                                                         | the Sync at session start, setup, doctor, the Gate, the Ship script | each session start prints that the Sync failed; those skills fail |
| `gh`, signed in                                                 | `/sdlc-pr-open`, `/sdlc-pr-ship`, `/sdlc-recap`, `/sdlc-delegate`   | those skills cannot read or write GitHub                          |
| [herdr](https://herdr.dev) and its `hc`, optional               | `/sdlc-delegate`, `dw-sdlc lead` and `dw-sdlc worker`               | no Workers; everything else runs                                  |
| `rtk`, optional                                                 | the plugin's rewrite hook, which trims command output               | the hook stays silent                                             |
| [safe-chain](https://github.com/AikidoSec/safe-chain), optional | checking the packages an agent installs against a malware blocklist | the doctor's `safe chain` line warns; the guards are unaffected   |

**Works with** [`mattpocock/skills`](https://github.com/mattpocock/skills), recommended rather than
required. Three places call them: a Brief starts with `/implement`, a `full` Review runs `/code-review`
unless `pr.reviewCommand` names another command, and `/sdlc-delegate` reads the sub-issues a
`/to-tickets` cut leaves.

## Install

```bash
claude plugin marketplace add dominikwozniak/dw-sdlc --sparse .claude-plugin plugins packages
claude plugin install sdlc@dw-sdlc --scope user
claude plugin install sdlc-sessions@dw-sdlc --scope user   # optional: it brings sdlc with it
```

`--sparse` checks out only the catalogue, the plugins and the `dw-sdlc` package they link to. The
repository is public, so the clone needs no credentials. `claude plugin update` takes a new release.

Then start a new Claude Code session: the hooks and skills load when a session starts.

## What changes the moment it is on

At user scope the guards judge every repository you open, with no setup and no config file. A
repository that declares nothing gets these rules, inferred:

- a push to `main`, `master` or `production` is refused, plain, lease or forced: those take pull requests
- a bare `push --force` is refused anywhere; `push --force-with-lease` passes off a protected branch
- `npm`, `npx`, `yarn` and `bun` are refused in a pnpm repository, known from its lockfile
- a `.env` file git does not track is refused, so are credential files and a `curl` carrying a secret
- destructive git (`reset --hard` over changes, `clean -fd`, a reflog expiry) and every App Store
  Connect write are refused

A repository changes the rules in `.ai/agentic.config.json`, such as its own `protectedBranches` or
`"commit": { "convention": "ticket-key" }`: [adopting it](docs/overview.md#adopting-it-in-your-repository).
To turn the plugin off in one repository, set `"sdlc@dw-sdlc": false` under `enabledPlugins` in that
repository's `.claude/settings.json`.

## First ten minutes

1. **Open a session** in a repository you work on.
2. **Meet a guard.** Ask the agent to run `git push origin main`. The guard refuses it before it runs,
   and the message names the `sdlc` plugin.
3. **Run `/sdlc-setup`.** It shows a dry run, then writes this machine's config layer, keeps it out of
   git, adds a permission backstop to `.claude/settings.local.json` and the lease-push exception to
   `~/.claude/settings.json`. In a repository with a `package.json` it asks before it adds `dw-sdlc` as
   a devDependency, which turns `pnpm check` into the Gate. What it writes in full:
   [plugin README](plugins/sdlc/README.md#setup). The guards work without it.
4. **Read the doctor.** Setup ends with it, and `/sdlc-doctor` runs it again: one PASS / WARN / FAIL
   line per check. A FAIL stops a guard, such as a missing `jq`. A WARN is hardening the plugin does
   not need, such as `commit signing`, `pnpm release age` or `safe chain`, and its line names the fix.
5. **Ship a change.** Work as usual, with the engineering skills or without them. When you want a
   pull request, ask for one: `/sdlc-pr-open` writes it. Then `/sdlc-pr-ship` drives it through the
   Review, CI and the merge, and stops where it needs you.

## What it stops

| guard                 | refuses                                                                                                                          |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| dangerous commands    | `reset --hard` with uncommitted changes, `clean -fd`, `stash clear`, remote branch deletion, `rm` at `/` `~` `.`, `find -delete` |
| forced delete         | `branch -D` of a branch not yet on the base, `-M`, `worktree remove --force`, `stash drop`                                       |
| lost-commit record    | `reflog expire`, `gc --prune=now`, `prune`, `update-ref -d`, `rm -rf .git`                                                       |
| force push            | bare `push --force`; a lease push passes, or asks first under `forcePush: ask`, never to a protected branch                      |
| plain push            | any push straight to a protected branch: those take pull requests                                                                |
| commit                | a commit, merge, cherry-pick or revert on a protected branch, under `commitOnProtected: deny`                                    |
| GitHub CLI            | `gh repo delete`, `gh pr merge --delete-branch`, a `gh api` call that deletes or force-moves a ref                               |
| env access            | `.env`, `.env.*`, `.envrc` outside the config's allow list or unknown to git                                                     |
| credential leak       | reading `~/.ssh`, `~/.aws`, `~/.kube` and friends; `curl` or `wget` carrying a secret                                            |
| package manager       | `npm`, `npx`, `yarn`, `bun` in a pnpm repository                                                                                 |
| filtered output       | a check command (`vitest`, `tsc`, `dw-sdlc gate`) piped into `head`, `tail`, `grep`, `sed`, `awk`; `tee` or a redirect passes    |
| commit hygiene        | a subject off the convention, a missing `commit.trailer` when one is declared, `git add -A` with no path, `git add .`            |
| App Store Connect     | every `asc` write and `--confirm` on a store script, in every repository; reads and `--dry-run` pass                             |
| large file (advisory) | flags a written file over 256 KiB                                                                                                |

Each rule holds at every command position, within its [known limits](plugins/sdlc/README.md#known-limits): an indented line, a loop, a subshell, behind `sudo`,
`xargs`, `timeout`, `find -exec` or `bash -c`, and in a heredoc a shell reads. Every rule in full:
[plugin README](plugins/sdlc/README.md#guards).

## Skills

| skill                  | plugin          | who starts it                                 | use it to                                                       |
| ---------------------- | --------------- | --------------------------------------------- | --------------------------------------------------------------- |
| `/sdlc-setup`          | `sdlc`          | you type it                                   | set a repository and this machine up                            |
| `/sdlc-doctor`         | `sdlc`          | you type it                                   | check this machine and repository, read-only                    |
| `/sdlc-references-add` | `sdlc`          | you type it                                   | add a repository the agent reads for prior art                  |
| `/sdlc-pr-open`        | `sdlc`          | the agent, whenever it opens a pull request   | write a pull request's title and body                           |
| `/sdlc-pr-ship`        | `sdlc`          | you type it, or a Brief tells a Worker to     | drive one pull request to merged                                |
| `/sdlc-sweep`          | `sdlc`          | you type it                                   | remove the branches and worktrees finished work leaves          |
| `/sdlc-recap`          | `sdlc-sessions` | you type it, or a Brief tells a Worker to     | say where a session stands and whether it can close             |
| `/sdlc-kickoff`        | `sdlc-sessions` | you type it                                   | kick off new work in a session of its own, cared for by a Lead  |
| `/sdlc-delegate`       | `sdlc-sessions` | you ask for it; the agent offers it and waits | run Workers in herdr terminals, in parallel where tickets allow |

## Docs

| where                                                                | for whom                    | what                                                                                                     |
| -------------------------------------------------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------- |
| [`docs/overview.md`](docs/overview.md)                               | a user                      | how a guard judges a call, the config, the Gate, the Review loop and the Ship script, Workers, the Sweep |
| [`plugins/sdlc/README.md`](plugins/sdlc/README.md)                   | a user                      | every guard, the setup, the doctor, References, the pull-request skills                                  |
| [`plugins/sdlc-sessions/README.md`](plugins/sdlc-sessions/README.md) | a user                      | the Recap, the Brief, the Lead                                                                           |
| [`packages/dw-sdlc/README.md`](packages/dw-sdlc/README.md)           | a user of the package       | the `dw-sdlc` bin and its commands                                                                       |
| [`GLOSSARY.md`](GLOSSARY.md)                                         | anyone                      | what a word means here                                                                                   |
| [`docs/adr/`](docs/adr/)                                             | anyone asking why           | one record per decision                                                                                  |
| [`docs/contributing/`](docs/contributing/)                           | the maintainer              | development, how a change lands, releasing, the bash guard's parser, evals                               |
| [`AGENTS.md`](AGENTS.md)                                             | an agent in this repository | the map, the rules, the commands, the Task Router                                                        |
| [`SECURITY.md`](SECURITY.md)                                         | a reporter                  | how to report a vulnerability                                                                            |

## License

[MIT](LICENSE). What it carries from others: [NOTICE.md](NOTICE.md).
