# sdlc

The plugin of [dw-sdlc](../../README.md) that holds an agent session to a repository's rules. It carries:

- the guards: shell hooks that judge each tool call and refuse it, ask, or stay silent;
- the session hooks, which report what a checkout lacks and bring its [References](#references) to their ref;
- six skills, which set a repository up, check a machine, add a Reference, open a pull request, ship it
  and sweep what landed;
- `sdlc-reviewer`, the subagent that reads a change at the `light` Review depth.

The rules come from the repository's `.ai/agentic.config.json`, a machine's own
`.ai/agentic.config.local.json`, which may tighten `guardrails`, `pr.merge` and `pr.review` and never
loosen them, and what is inferred where neither file sets a key:
[Where the rules come from](../../docs/overview.md#where-the-rules-come-from). The plugin guards Node
repositories, and App Store Connect from every repository; it carries no other stack-specific guard.
How the plugin is built and tested: [Inside the sdlc plugin](../../docs/contributing/plugin-internals.md).

## Install

The [root README](../../README.md#install) installs it and names what it needs: `jq`, Node 24 and an
authenticated `gh`. [`sdlc-sessions`](../sdlc-sessions/README.md), the marketplace's second plugin, adds the
session skills.

## What it carries

| part                                                            | kind                      | runs                                                           | section                                                    |
| --------------------------------------------------------------- | ------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------- |
| `bash-guard.sh` and the Bash guards it spawns, `rtk-rewrite.sh` | `PreToolUse` hook, Bash   | before every Bash command                                      | [Guards](#guards)                                          |
| `block-env-access.sh`                                           | `PreToolUse` hook         | before every Read, Edit, Write, MultiEdit, NotebookEdit, Grep  | [Guards](#guards)                                          |
| `large-file-guard.sh`                                           | `PostToolUse` hook, Write | after every Write                                              | [Guards](#guards)                                          |
| `session-start.sh`, `references-sync.sh`                        | `SessionStart` hooks      | at a session's start                                           | [Session start](#session-start), [References](#references) |
| `commit-msg.sh`                                                 | git hook                  | on a commit typed in a terminal, once a repository wires it    | [Commit hook](#commit-hook)                                |
| `/sdlc-setup`                                                   | skill                     | you type it                                                    | [Setup](#setup)                                            |
| `/sdlc-doctor`                                                  | skill                     | you type it                                                    | [Doctor](#doctor)                                          |
| `/sdlc-references-add`                                          | skill                     | you type it                                                    | [Adding a Reference](#adding-a-reference)                  |
| `/sdlc-pr-open`                                                 | skill                     | the agent, whenever it opens a pull request or writes its body | [Opening a pull request](#opening-a-pull-request)          |
| `/sdlc-pr-ship`                                                 | skill                     | you type it, or a Worker on its Brief                          | [Shipping a pull request](#shipping-a-pull-request)        |
| `/sdlc-sweep`                                                   | skill                     | you type it, or say "go" on a Recap follow-up that names it    | [Sweeping](#sweeping)                                      |
| `sdlc-reviewer`                                                 | subagent                  | `/sdlc-pr-ship` spawns it at the `light` Review depth          | [The light Review](#the-light-review)                      |

A Worker is a Claude Code session that works on one Brief, the fixed-shape first message the
[`sdlc-sessions`](../sdlc-sessions/README.md) plugin writes; a Recap is that plugin's report of where a
session stands.

## Guards

A guard reads the tool call as JSON on stdin and answers with a verdict: **deny** (exit 2, the call
never runs), **ask** (a permission prompt) or **pass** (silent). The Bash guards and the env guard
answer before the call runs; the large-file guard answers after a Write. Without `jq` every guard
passes every call; the [session-start report](#session-start) and the [Doctor](#doctor) say so.

Each Bash rule holds wherever the shell runs a command: indented, after a separator, in a subshell or
a substitution, behind `sudo`, `env`, `xargs`, `timeout`, `find -exec`, `bash -c`, `eval` or `rtk`,
and in a heredoc a shell reads, within the [known limits](#known-limits).

| topic                                                         | refuses                                                            | passes                                         | config key                       |
| ------------------------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------- | -------------------------------- |
| [Destructive git](#destructive-git)                           | `reset --hard` over changes, `clean -f`, `stash clear`, `prune`    | `reset --hard` on a clean tree, a dry run      | —                                |
| [Forced branch delete](#forced-branch-delete)                 | `branch -D` of a branch not yet on the base                        | `branch -D` of a Landed branch, `branch -d`    | `baseBranch`                     |
| [Push](#push)                                                 | a bare force push, a push to a protected branch, a remote delete   | a lease push to an unprotected branch          | `protectedBranches`, `forcePush` |
| [Commit on a protected branch](#commit-on-a-protected-branch) | a commit, merge, cherry-pick or revert there                       | everything, by default                         | `commitOnProtected`              |
| [GitHub CLI](#github-cli)                                     | `gh repo delete`, `--delete-branch`, a ref delete through `gh api` | every other `gh` call                          | —                                |
| [rm and find](#rm-and-find)                                   | `rm` aimed at `/`, `~`, `.` or a `.git`; `find -delete`; `shred`   | `rm` of a path inside the tree                 | —                                |
| [Env files](#env-files)                                       | an env file the repository does not vouch for                      | a tracked or allowed env file                  | `envFiles`                       |
| [Credentials](#credentials)                                   | reading `~/.ssh`, `~/.aws` and friends; a secret in `curl`         | everything else                                | —                                |
| [Package manager](#package-manager)                           | `npm`, `npx`, `yarn`, `bun` in a pnpm repository                   | them in any other repository                   | `packageManagers.node`           |
| [Filtered output](#filtered-output)                           | a check command piped into `head`, `tail`, `grep` and the like     | `tee`, a redirect, a pipe on any other command | `filteredOutput`                 |
| [Commit hygiene](#commit-hygiene)                             | a subject off the convention, a missing trailer, `git add -A`      | a subject that matches, files staged by name   | `commit.*`                       |
| [App Store Connect](#app-store-connect)                       | every `asc` write, a store script with `--confirm`                 | reads, `--dry-run`                             | —                                |
| [Large file](#large-file)                                     | nothing: it flags a written file over 256 KiB                      | —                                              | `CLAUDE_MAX_WRITE_BYTES`         |

Every refusal ends with the same line, naming the plugin:

```text
Refused by the sdlc plugin. If this is genuinely needed, the user runs it.
```

### Destructive git

`block-dangerous-commands.sh`, always on. It refuses what destroys work the reflog cannot bring back.

- **Refuses:** `reset --hard` with uncommitted changes; `clean` with `-f`, `-d`, `-x`, `-X` or `--force`;
  `branch -M`, `-C`, and `-f` on a move, a copy or an existing branch; `checkout -f` or of the whole
  tree; `switch -f` and `--discard-changes`; a `restore` of the whole tree unless `--staged` alone;
  `stash drop` and `clear`; `worktree remove --force`; `reflog expire` and `delete`;
  `gc --prune=now|all`; `prune`; `update-ref -d`.
- **Passes:** `reset --hard` when no tracked file has a change, since untracked files survive it and
  the reflog keeps the old HEAD; `clean` as a dry run; a plain `branch -d` and `worktree remove`, since
  git keeps unmerged and dirty work from them itself.
- **Edge:** `reset --hard` is refused when git cannot answer (outside a repository, an unborn HEAD),
  when a file is `assume-unchanged` or `skip-worktree`, under `GIT_DIR` or `GIT_WORK_TREE`, and after
  a command that may change the tree first. The whole tree is a pathspec of `.`, `*` or `**`, `./`
  alone, or the `:/` and `:(top)` magic.

```text
BLOCKED: 'git clean -fd' deletes untracked files.
```

### Forced branch delete

`block-dangerous-commands.sh`, always on.

- **Passes:** `branch -D`, `-d -f` or `--delete --force` when each branch it names is Landed: its work
  is on origin's base branch. The tip is there, or a base commit since it forked holds the tip's tree
  or the patch-id of its whole diff, as a squash merge leaves them.
- **Refuses:** any other forced delete, and `-r`. It passes only as a command of its own, each branch
  written out: a `cd`, a pipe, a variable or an `xargs` could aim git elsewhere than the guard looks.
- **Config:** `baseBranch`, default `auto`: the branch `origin/HEAD` names. Only local objects are
  read, so a base fetched before the merge refuses until `git fetch`.

```text
BLOCKED: 'git branch -D feat2' force-deletes a branch, and no base branch is known to check it
against: origin/HEAD names no branch of origin. Run git remote set-head origin --auto, or set
baseBranch in .ai/agentic.config.json.
```

### Push

`block-dangerous-commands.sh`, always on. It keeps a push from rewriting or deleting a branch others build on.

| refuses                                                        | passes                                                                         |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `--force`, `-f`, a `+refspec`, `--mirror`                      | `--force-with-lease`, `--force-if-includes`, to a branch that is not protected |
| any push to a protected branch                                 | a plain push to any other branch                                               |
| `--delete`, `-d`, a `:branch` refspec                          | —                                                                              |
| `--prune` with `--all`, `--tags`, no refspec or a wildcard one | `--prune` with a named refspec                                                 |

| config key                     | values                 | default                        |
| ------------------------------ | ---------------------- | ------------------------------ |
| `guardrails.protectedBranches` | branch names           | `master`, `main`, `production` |
| `guardrails.forcePush`         | `deny`, `ask`, `lease` | `lease`; `ask` prompts first   |

`--all` and a wildcard refspec count every local branch. A `switch -c` or `checkout -b` earlier in the
same command moves the branch the push is judged on.

```text
BLOCKED: 'git push --force origin feat' force-pushes without a lease. Use --force-with-lease
(and --force-if-includes) so the push only replaces what you last fetched.
BLOCKED: 'git push origin main' pushes to 'main', a protected branch (guardrails.protectedBranches).
Open a pull request instead.
```

### Commit on a protected branch

`block-dangerous-commands.sh`. Under `guardrails.commitOnProtected: deny` it refuses a commit, merge,
cherry-pick or revert on a protected branch. The default is `allow`.

### GitHub CLI

`block-dangerous-commands.sh`, always on. It refuses `gh repo delete`, `gh pr merge` or `close` with
`--delete-branch`, and a `gh api` call that deletes a ref or a repository or force-updates a ref, REST
or GraphQL.

```text
BLOCKED: 'gh repo delete x' deletes a GitHub repository.
```

### rm and find

`block-dangerous-commands.sh`, always on. It refuses `rm` aimed at `/`, `~`, `$HOME`, `..` and upward,
the working directory by name (`$PWD`, `$(pwd)`, the repository root), or a `.git` with its objects,
refs or logs, as any operand. `.`, `./*` and a bare `*` are refused too, unless a `cd` earlier in the
command moved below the session's directory. `find -delete` and `shred` are refused.

```text
BLOCKED: 'rm -rf /' deletes from the root of the filesystem.
```

### Env files

`block-env-access.sh`, on file tools and Bash. An env file is `.env`, `.env.*` or `.envrc`.

- A path in `guardrails.envFiles.deny` is refused; one in `allow` passes.
- The rest go to `policy`: `git` lets a tracked file through and refuses one git ignores or does not
  know; `deny` refuses them all.
- Defaults: policy `git`; `.env.example`, `.env.sample` and `.env.template` allowed anywhere; nothing denied.
- Entries are globs against the path from the repository root, `**/` meaning any depth. A path outside
  the repository is judged by its basename against the `**/` entries.
- A `Grep` of a directory is judged by the env files its `glob` reaches. In Bash a path is read from
  where a `cd` left the shell, and a glob by the files it expands to.

```text
BLOCKED: 'cat .env' touches '.env' and git does not track it. guardrails.envFiles in
.ai/agentic.config.json decides: …
```

### Credentials

`credential-leak-guard.sh`, always on. It refuses:

- reading a credential store: `~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.kube`, `~/.netrc`, `~/.git-credentials`,
  `~/.pypirc`, `~/.pgpass`, the user's `~/.npmrc`;
- an environment dump filtered for a credential-ish name, and printing such a variable's value;
- a `curl` or `wget` carrying one of those or a dotenv file.

```text
BLOCKED: 'cat ~/.ssh/id_rsa' touches the credential store '~/.ssh/id_rsa'. SSH keys, cloud
credentials and .netrc are the user's, not the agent's, and reading one puts it in a transcript.
```

### Package manager

`block-non-pnpm.sh`. It refuses `npm`, `npx`, `yarn` and `bun` where `packageManagers.node` is `pnpm`,
inferred from the lockfile when nothing declares it. It is silent in every other repository. An option
or a redirect before the verb does not hide it, and a `cd` moves the repository whose manager counts.

```text
BLOCKED: 'npm install' uses npm, npx, yarn or bun, and this repository's package manager is pnpm
(packageManagers.node). Use 'pnpm install', 'pnpm add <pkg>', or 'pnpm dlx <cmd>' …
```

### Filtered output

`block-filtered-output.sh`. It refuses a check command piped into `head`, `tail`, `grep`, `egrep`,
`fgrep`, `rg`, `sed`, `awk`, `less` or `more`: the pipe hides the failure and turns the exit code green.

- A check command is `gate.command`, each `gate.steps` command and `gate.checks.run` script, `dw-sdlc
  gate`, `dw-sdlc check`, or a runner of the built-in list: `vitest`, `jest`, `tsc`, `oxlint`, `eslint`,
  `vp check`, `rspec`, `rubocop`, `pytest`, `cargo test`, `go test`.
- `| tee` and a redirect pass; a filter behind the `tee` is refused.
- `guardrails.filteredOutput: "allow"` turns it off; the default is `"deny"`.

```text
BLOCKED: 'pnpm exec vitest' is piped into 'tail'. … Run 'pnpm exec vitest' unpiped, or redirect it
with 'pnpm exec vitest > <file> 2>&1' and read the file.
```

### Commit hygiene

`enforce-commit-hygiene.sh`. On an agent's `git commit` and `git add`:

- the subject must match `commit.pattern`, or the preset `commit.convention` names (`conventional` by
  default, or `ticket-key`); the message is read from `-m` and from a heredoc handed to git;
- the message must carry `commit.trailer` when one is declared; a `--trailer` counts;
- a live backtick in `-m` or an unquoted heredoc is refused, since the shell runs it;
- `git add` of the whole tree is refused: `-A` or `--all` with no path, `.`, `*`, `:/`, `$PWD`.

A commit inside a substitution or another shell is out of reach; the [Commit hook](#commit-hook)
checks its subject.

```text
BLOCKED: commit subject "wip" does not match this repository's commit pattern.
```

### App Store Connect

`block-store-writes.sh`, in every repository, with no config: `asc` reaches the whole store account
from any directory. An `asc` call passes when its verb is a read (`list`, `view`, `show`, `status`,
`pull`, `diff`, `validate`, `download` and the like), with `--help`, or with `--dry-run` and no
`--confirm`. Every other verb is refused, and so is a flag before the verb, which would hide it. A
store script, `pnpm store:<name>` or `node scripts/store-<name>.ts`, runs unless it carries `--confirm`.

### Large file

`large-file-guard.sh`, after a Write. It flags a file over 256 KiB once it is on disk: a pasted bundle,
a blob, a dumped log. It is advisory, so it is the one guard with a switch: `CLAUDE_MAX_WRITE_BYTES`
sets the threshold, `0` turns it off.

### Not a guard: the rtk rewrite

`rtk-rewrite.sh` wires `rtk hook claude`, the hook of [rtk](https://github.com/rtk-ai/rtk), which
compresses command output. A machine wires nothing by hand, so `rtk init --show` reporting "Hook: not
found" is expected. Without rtk it is silent. In a linked worktree it rewrites nothing, since Claude
Code's isolation check cannot read through the `rtk` wrapper. The guards judge the command before the
rewrite.

### Reading a command

A guard reads a Bash command the way the shell reads it, so a rule fires on a command the shell runs,
not on text that only looks like one: [How a guard reads a Bash command](../../docs/contributing/bash-guard.md).

### Known limits

The guards catch the commands an agent writes in ordinary work, not a deliberate evasion
([ADR 0017](../../docs/adr/0017-guards-catch-ordinary-commands-not-deliberate-evasion.md)). These
spellings get past a rule; each is listed, not caught.

<details>
<summary>The spellings, by kind</summary>

- Expansion the guard does not perform: braces, and a glob anywhere but the env guard's words
  (`cat .env{,.local}`, `cat ~/.ss?/id_rsa`, `rm -rf .g[i]t`, `rm -rf **`, `{git,reset,--hard}`),
  the tildes `~+` and `~user`, and a name the file system folds, `.ENV.LOCAL` on APFS.
- A command before `reset --hard` that writes a tracked file through its own output: a redirect or
  `--output` on an allowed git verb, `-c diff.external=…` or `-c core.fsmonitor=…`.
- A `Grep` glob that reaches an env file only through a name outside the probes, `*.qa` reaching
  `.env.qa`.
- A quoted command name or option: `"rm"`, `r''m`, `r\m`, `g""it`, `find . "-delete"`.
- A shell two levels deep, `sh -c 'sh -c "…"'`, and a quote `rtk` runs through a verb other than
  `run` or behind a flag: `rtk err`, `rtk proxy`, `rtk -v run`.
- Launchers the walker does not read: `command --`, `nohup --`, `eval --`, `rtk proxy --`, `env -S`,
  `env -`, a `function` body, `coproc`, `bash --rcfile`, a second `find -exec`.
- A redirection before the command or the git verb: `>/dev/null git reset --hard`,
  `git 2>/dev/null push --force`.
- git's own option parsing: a unique prefix of a long option (`--har`, `--forc`), the last of
  `--dry-run` and `--no-dry-run`, `-on` as `-o n`, and the value of `--config-env` or
  `--attr-source` read as the verb.
- A heredoc a shell reads another way: `bash /dev/stdin`, `. /dev/stdin`, `{ cat <<EOF … } | bash`,
  a pipe to a shell on a later line, `eval "$(cat <<EOF …)"`.
- A `<<` inside `$(( ))` or `(( ))`, which the guard opens as a heredoc, dropping every later line.
- A check command neither the config nor the built-in list names, such as `pnpm test:unit`, piped
  into a filter; and a pipe left at the end of a line, `vitest |⏎tail`.
- `yarn` against a separator (`yarn;`, `(yarn)`, `yarn&&`) and `pnpm exec npm`.
- A push to a protected branch named `@` or `heads/main`, or aimed at another repository by `GIT_DIR=`.
- A `cd` or `pushd` in the background, in a pipeline or behind a false `||`, read as a move, so an
  `rm -rf *` after it passes and `cd sub & cat .env` is judged as `sub/.env`. A turn of the `pushd`
  stack, `pushd +1` or `popd +N`, reads as the session's directory.
- A glob the command also quotes elsewhere, `cat .env* # '.env*'`, read as quoted.
- gh: `-R` before the `pr` verb, a request body sent with `--input`.
- commit: a message from a here-string, a `$(…)` before `-m`, a trailer key with no colon read as
  the trailer.

</details>

A fix that closes one of these in passing removes its line. One that turns up in ordinary work leaves
the list for a ticket and a regression test.

## Commit hook

The guards judge the agent's tool calls, so a commit typed in a terminal never meets them.
`hooks/commit-msg.sh` is the subject check of the commit-hygiene guard as a git `commit-msg` hook.

- **Checks:** the subject against `commit.pattern`, on the same resolved config; a subject off it exits 1
  and aborts the commit.
- **Skips:** git's own `Merge`, `Revert`, `fixup!`, `squash!` and `amend!` subjects, an empty message,
  and the trailer, since a commit a person writes has no co-author to name. Without jq it says so and
  lets the commit through.
- **Wiring:** a repository runs it from its own hook manager. This one runs
  `bash plugins/sdlc/hooks/commit-msg.sh "$1"` from `.vite-hooks/commit-msg`.

## Setup

`/sdlc-setup` runs `dw-sdlc setup` through the plugin's link: a dry run first, then the run, then the
[Doctor](#doctor). It is safe to repeat: each file is written only when it would change, and the only
command it runs in the repository is read-only `git`. The flags are in `dw-sdlc setup --help`.

| file                                      | what it writes                                                                                                                                | kept out of git |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| `.ai/agentic.config.local.json`           | this machine's layer: `$schema`, the Node package manager the committed file leaves unset, a pinned convention, `worker.command` with `cswap` | yes             |
| `.git/info/exclude`                       | the local config and `.claude/settings.local.json`                                                                                            | —               |
| `.claude/settings.local.json`             | `permissions.deny`, the backstop for a machine without `jq`: destructive git, `gh repo delete`, every env file the config refuses             | yes             |
| `~/.claude/settings.json`                 | for every repository: the lease-push exception and the irreversible deny set (`rm` at `/`, `~` or `.`, `shred`, `find -delete`)               | —               |
| `package.json`, `.ai/agentic.config.json` | the Gate, in a repository with a `package.json`: [Adopting the Gate](#adopting-the-gate)                                                      | no, committed   |

- The local layer is written only when it holds something besides `$schema`; the dry run prints
  `skipped`. Its `$schema` is a `file://` URL to the schema in the marketplace's clone, which an editor
  reads offline at the installed version.
- A `guardrails` block in the local layer is kept on every run, `--force` included. `--force-push` and
  `--commit-on-protected` pin those keys there; a pin that loosens the committed value is refused.
- `cswap` is an account switcher that starts Claude Code under the account a repository maps to. With
  it on PATH, the local layer gets `worker.command`, `cswap run -- --dangerously-skip-permissions`.
- Run from a linked worktree, the repository's files go to the main checkout, and every worktree reads
  them there.
- Settings that still enable `guardrails@dw-sdlc` or `references@dw-sdlc`, the names `sdlc` replaces,
  get a `by hand` line: remove them and add `"sdlc@dw-sdlc": true`.
- A `refused` line exits 1. The skill asks before it pins the package: on the dry run's
  `refused package.json` line it asks, stops on a no, and on a yes runs again with `--add-package`.

### Adopting the Gate

In a repository with a `package.json`, the setup adopts the Gate, `dw-sdlc gate`, in two committed files:

- `package.json` gains `dw-sdlc` in `devDependencies`, pinned at the version running the setup, only
  with `--add-package`. A pin it already holds stays.
- `.ai/agentic.config.json` gains a `gate` key when it has none, created when the file is absent. A
  `gate` key it has stays.

The key names every Check the package ships; a Check is one named rule the Gate runs over the tree.

| Check                                                  | starts | why                                                           |
| ------------------------------------------------------ | ------ | ------------------------------------------------------------- |
| `markdown-refs`, `temporal-language`, `comment-budget` | on     | they judge the tree as it is                                  |
| `agents-map`                                           | on     | the map is yours to write; the first Gate names what it lacks |
| `primitives`                                           | off    | needs a catalogue                                             |
| `decision-records`                                     | off    | needs a records directory                                     |
| `markdown-budget`                                      | off    | needs the docs its glob matches                               |
| `routed-docs`                                          | off    | needs a Task Router row or Primitive for each doc             |
| `skill-sections`                                       | off    | needs the catalogue each copied section is listed in          |
| `file-size-ratchet`                                    | off    | needs its baseline                                            |
| `disable-directives`                                   | off    | turn it on once every Disable directive carries a reason      |

`file-size-ratchet` is a Ratchet: a Check whose recorded baseline of files over the size limit may only
shrink. Turn it on once the Gate is green, then `dw-sdlc gate --update-baseline` records the baseline
to commit. The setup never writes the Agent map, `AGENTS.md`, or its `CLAUDE.md` link.

## Doctor

`/sdlc-doctor` runs `dw-sdlc doctor`, and the setup runs it last. It installs nothing, prints one line
per machine check, and exits 1 on a FAIL. INFO marks a check that does not apply here. From a terminal,
`node <plugin root>/dw-sdlc/src/cli.ts doctor`, where `claude plugin list --json` names the plugin root
as the `installPath` of `sdlc@dw-sdlc`.

| line               | checks                                                                                                                                     | when it is not there                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `jq`               | `jq` on PATH                                                                                                                               | FAIL: every guard passes every call                                                    |
| `plugin`           | `sdlc@dw-sdlc` installed and enabled                                                                                                       | FAIL, with the install command                                                         |
| `package`          | the `dw-sdlc` the plugin links against the one the repository's `package.json` pins                                                        | WARN `drift:`, naming `claude plugin update sdlc@dw-sdlc` or the pin; INFO with no pin |
| `sessions`         | [`sdlc-sessions`](../sdlc-sessions/README.md) and its copy of `dw-sdlc` against the copy `sdlc` runs                                       | INFO when not installed, WARN when disabled or drifted; never a FAIL                   |
| `hc`               | herdr's `hc`, which a Lead starts its Workers through, in the agent's login shell                                                          | WARN with `sdlc-sessions` enabled, INFO without it                                     |
| `rtk`              | rtk not wired by hand beside the plugin's hook, and the filters that misbehave on the installed release excluded (`find` below rtk 0.46.0) | FAIL when wired by hand, WARN for a missing exclusion; PASS with no rtk                |
| `safe chain`       | [Safe Chain](https://github.com/AikidoSec/safe-chain), Aikido's blocklist of malicious npm packages, with `npm` going through it           | WARN: the agent's shell reaches the registry without the blocklist                     |
| `pnpm release age` | pnpm's global `minimumReleaseAge` at 10080 minutes, 7 days, or more                                                                        | WARN, with the `pnpm config set --global` line                                         |
| `commit signing`   | `commit.gpgsign` true in the global git config                                                                                             | WARN: commits go out unsigned                                                          |
| `config`           | the resolved config of the repository holding `--root` or the current directory                                                            | FAIL on an invalid layer, each problem named                                           |

Safe Chain, the release age and commit signing guard the supply chain and the history; the guards work
without them. A `drift:` line means the hooks and skills run other code than the repository's Gate.

## Session start

`hooks/session-start.sh` runs on `startup`, `resume`, `clear`, `compact` and `fork`. It reports and never
installs, and a main checkout in order gets nothing. It tells the first turn about:

- a missing `jq`, with every guard silent without it;
- an invalid config layer, each problem named, and that the guards run the strictest set until it is
  fixed ([Where the rules come from](../../docs/overview.md#where-the-rules-come-from));
- in a linked worktree, the `.worktreeinclude` files not yet copied in and the `worktree.setup` commands.

A layer is invalid, too, when the hooks cannot validate it against the schema beside them. A
marketplace added without `packages` in its `--sparse` set lacks that file, and the report says so.

## References

A Reference is a repository an agent reads to see how a problem was solved before, declared in
`.ai/references.json` and cloned under `references/`. Only the committed file is read. A repository
without the file gets no output at all.

### The Sync at session start

`hooks/references-sync.sh` runs the Sync on `startup`, with a 60 s timeout, and prints its lines as the
session's context. It always exits 0, so being offline never blocks a session. A cloud session, Codex
and a plain terminal load no plugin, so a Reference there is what the last local session left on disk
(ADR 0006).

### The file

`.ai/references.json` holds `$schema` (optional), `version: 1` and `references`, a list of entries:

| field        | required | meaning                                                                                                  |
| ------------ | -------- | -------------------------------------------------------------------------------------------------------- |
| `dir`        | yes      | the directory under `references/`, unique in the list                                                    |
| `repository` | yes      | a URL `git` can fetch; a `https://github.com/` one fetches with the GitHub CLI's credentials             |
| `ref`        | yes      | a branch or a tag; `{name}` stands for the exact version the root `package.json` pins for package `name` |
| `only`       | no       | paths the clone holds beside the top-level files, a directory ending in `/`; absent, the whole tree      |
| `skip`       | no       | paths the sparse checkout leaves out; with `only`, each inside one of its paths                          |
| `what`       | yes      | what the Reference is                                                                                    |
| `when`       | yes      | when an agent reaches for it                                                                             |

```json
{
  "dir": "pstack",
  "repository": "https://github.com/cursor/plugins",
  "ref": "main",
  "only": ["pstack/", "harness/pstack/"],
  "what": "Cursor's pstack plugin. The clone holds only `pstack/` and `harness/pstack/`: 387 of its 1267 files",
  "when": "designing a plugin that ships skills and a harness"
}
```

An unknown field is refused. The schema, `config/references.schema.json` of the package, lets an editor
complete the entries. A `references` key in `.ai/agentic.config.json` is refused, and the setup moves it
into the file (ADR 0011).

### The Sync

```bash
node <plugin root>/dw-sdlc/src/cli.ts references sync [dir...]
```

It brings every Reference, or the named ones, to its ref: a missing one cloned shallow, an existing one
fetched and checked out detached, sparse when `only` or `skip` names paths. Each prints one line:
directory, short commit, repository and ref. A directory the list does not name is reported, never
deleted. One Sync runs in a checkout at a time; `references sync --help` says how a second one waits.

### Failures

| exit | when                                                                                               | what happens                      |
| ---- | -------------------------------------------------------------------------------------------------- | --------------------------------- |
| 2    | the file fails the parser or is not JSON, a `references` key is left in the config, an unknown dir | nothing syncs; one line names why |
| 1    | an entry fails: unreachable, an inexact pin, a missing `only` path, local edits, a foreign clone   | that entry stays; the rest sync   |

### Adding a Reference

`/sdlc-references-add <repository>`, which only you start, adds one. It names the licence, picks the ref,
proposes `skip` for vendored directories, writes `what` and `when`, appends the entry, rewrites the
Router's table and syncs the new `dir`. It takes a link to a folder on GitHub too,
`https://github.com/cursor/plugins/tree/main/pstack`, which becomes the ref and the first `only` path. It
commits nothing. The steps are in its `SKILL.md`.

Under it runs the References setup, `node <plugin root>/dw-sdlc/src/cli.ts references setup [--check]`:

| file                    | what it writes                                                                                                                           |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `references/AGENTS.md`  | the Router, the file an agent reads first under `references/`, and its `CLAUDE.md` link; on every run the table of each `dir` and `when` |
| `.claude/settings.json` | `claudeMdExcludes` for the clones' own `CLAUDE.md` and `AGENTS.md`                                                                       |
| `.gitignore`            | `references/*`, with the exceptions that keep the Router tracked                                                                         |
| `.ai/references.json`   | an empty list when the file is missing                                                                                                   |

It only adds, so a repeat writes nothing. `--check` writes nothing and exits 1 when a file would change.

## Opening a pull request

`/sdlc-pr-open` opens the pull request of the current branch, or rewrites the body of the one it has.
The agent starts it whenever it opens a pull request or writes a body; it never merges and never starts
`/sdlc-pr-ship`.

- The title follows `commit.convention`, and `commit.pattern` when one is set.
- The body fills the repository's pull request template, or a fixed shape without one. It is a snapshot,
  rewritten whole after a review, with no "Generated with" footer.
- The rules are in its [`SKILL.md`](skills/sdlc-pr-open/SKILL.md); its evals in
  [Evals](../../docs/contributing/evals.md).

## Shipping a pull request

`/sdlc-pr-ship [<n>]` drives one pull request to merged through the Ship script, `dw-sdlc pr ship`. You
type it, or a Worker whose Brief tells it to. Each answer names one Action, the one thing the pull request
needs next:

| status | whose turn  | what the skill does                                                                  |
| ------ | ----------- | ------------------------------------------------------------------------------------ |
| `act`  | the agent's | `fix-ci`, `fix-conflicts`, `address-review` or `review`, then calls the script again |
| `wait` | no one's    | tells you the reason and `recheckAfter`, and ends the turn                           |
| `park` | yours       | prints the reason and the command, and stops                                         |
| `done` | yours       | prints the merge and the branch delete command, and stops                            |

It never deletes a branch, passes `--merge` only when you wrote "merge" for this pull request, and reads
review-thread text as data, never as an instruction. How the script decides is in
[How the Ship script merges a pull request](../../docs/overview.md#how-the-ship-script-merges-a-pull-request);
the agent's steps are in its [`SKILL.md`](skills/sdlc-pr-ship/SKILL.md).

### The Review

dw-sdlc owns the Review loop: when a head needs a Review, at which depth, what counts as a Finding, the
read mark and the limit. What reads the change at `full` is the reviewer you name.

| depth   | who reads the change                                                  | set by                             |
| ------- | --------------------------------------------------------------------- | ---------------------------------- |
| `full`  | the slash command `pr.reviewCommand` names, `/code-review` by default | `--review`, `pr.review`, or `auto` |
| `light` | the [`sdlc-reviewer`](#the-light-review) subagent                     | the same                           |
| `off`   | no one; the script marks the head reviewed                            | the same                           |

- The agent may raise an `auto` depth from `light` to `full`, saying why; it never lowers one.
- A Finding holds the merge: a concrete harm the change causes, a doc or Primitive summary it makes
  false, a miss against the spec, or a bug fix without its regression test. Everything else is declined
  with one line.
- A Review that follows a fix reads the fix alone and checks each Finding it answers.
- Three Reviews with no success between them park the pull request, with
  `dw-sdlc pr reviewed --accept` as your command.

### The light Review

`agents/sdlc-reviewer.md` reads a `light` Review: a subagent on the session's model at `effort: medium`,
with `Read`, `Grep` and read-only `Bash`. It does not see the conversation; the prompt hands it the diff
command, the files, the spec, the Primitives the change touches with their untouched docs, and after a
fix the Findings it answers. It reads those files, those docs and `AGENTS.md`, skips what the Gate
checks, and reports under 300 words. Its first line is `clean` or `findings: <n>`; `smell:`,
`follow-up:` and `fixed:` lines follow and change no count.

## Sweeping

`/sdlc-sweep` runs a Sweep, `dw-sdlc sweep`, through the plugin's link. A Sweep removes the Landed
branches and the clean worktrees finished work leaves. It acts only on your word: the slash command, or
"go" on a Recap follow-up that names a Sweep. It runs from the main checkout, reports what it removed
and kept in one table, quotes each kept item's command as yours to run, and stops. What it removes and
keeps, in herdr too: [How a Sweep removes what finished work
leaves](../../docs/overview.md#how-a-sweep-removes-what-finished-work-leaves).

## Config keys it reads

Every key is in the schema, `dw-sdlc/config/agentic.config.schema.json`, with its order from strictest
to loosest.

| key                                   | default                                 | read by                                                    |
| ------------------------------------- | --------------------------------------- | ---------------------------------------------------------- |
| `guardrails.protectedBranches`        | `master`, `main`, `production`          | the push and commit guards, `dw-sdlc recap`                |
| `guardrails.forcePush`                | `lease`                                 | the push guard, `fix-conflicts`                            |
| `guardrails.commitOnProtected`        | `allow`                                 | the commit guard                                           |
| `guardrails.envFiles`                 | policy `git`, the example files allowed | the env guard, the setup's deny rules                      |
| `guardrails.filteredOutput`           | `deny`                                  | the filtered-output guard                                  |
| `packageManagers.node`                | from the lockfile                       | the package-manager guard, the setup                       |
| `commit.convention`, `commit.pattern` | `conventional`                          | the commit guard, the Commit hook, `/sdlc-pr-open`'s title |
| `commit.trailer`                      | none                                    | the commit guard                                           |
| `baseBranch`                          | `auto`, the branch `origin/HEAD` names  | the branch-delete guard, the Sweep                         |
| `gate.*`                              | `gate.command` from the `check` script  | the Gate, the filtered-output guard, the setup             |
| `pr.merge`                            | `ask`                                   | the Ship script                                            |
| `pr.review`                           | `auto`                                  | the Ship script, `/sdlc-pr-ship`                           |
| `pr.reviewCommand`                    | `/code-review`                          | `/sdlc-pr-ship`                                            |
| `worktree.setup`                      | none                                    | the session-start report                                   |
| `worker.command`                      | `claude`                                | the setup, and `sdlc-sessions`                             |
