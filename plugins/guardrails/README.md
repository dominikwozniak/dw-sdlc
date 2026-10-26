# guardrails

Deterministic guardrails for a Claude Code session, shipped as a plugin. Every rule is a shell hook
that reads the tool call on stdin and refuses it with exit 2, or asks for a prompt, before the call
runs. The rules a repository wants come from its `.ai/agentic.config.json`; a machine adds its own
`.ai/agentic.config.local.json` on top, which may tighten `guardrails` and never loosen it. A key
neither file sets is inferred: the package manager from the lockfile, and the `conventional` commit
convention. The plugin guards Node repositories, and App Store Connect from every repository; it
carries no other stack-specific guard.

## Install

```bash
claude plugin marketplace add dominikwozniak/dw-sdlc --sparse .claude-plugin plugins packages
claude plugin install guardrails@dw-sdlc --scope user
```

The hooks need `jq`. Without it every guard exits 0 and guards nothing; the doctor says so.

Added from GitHub, the plugin is a snapshot of `main` that `claude plugin update` refreshes, and
`--sparse` keeps the clone to the catalogue, the plugins and the package the `dw-sdlc` link points
at; without `packages` the plugin installs without the package. Added from a clone
(`claude plugin marketplace add ./` in the checkout), it runs live from that checkout: a change on
disk is in the next session, a broken edit included.

## Layout

- `.claude-plugin/plugin.json` — the manifest; its `hooks` key wires each guard below to its event.
- `hooks/lib.sh` — the library every guard sources: payload reader, git helpers, refusal, config
  lookup; it sources `hooks/lib-lines.sh`, the line scanners — heredoc openers and bodies,
  continuation lines — `hooks/lib-text.sh`, the text scanners — the one quote walker every
  scanner reads, substitutions, plain words — `hooks/lib-live.sh`, the live-quote readers — a
  quote handed to a shell, ended where the outer shell ends it — `hooks/lib-mask.sh`, the quote
  mask — separators inside a quote made text — `hooks/lib-words.sh`,
  the word readers — shell words, the launcher table and its two readers, the boundary — and
  `hooks/lib-git.sh`, the git readers — a verb and its options, a push and its targets, the
  current branch.
- `hooks/schema.jq`, `hooks/config.jq` — the config contract in jq: schema validation and the
  local-over-committed-over-inferred merge, the same behaviour as `dw-sdlc/src/agentic-config.ts`.
- `hooks/bash-guard.sh` — the dispatcher: one stdin read, heredoc bodies dropped once but for the
  substitutions an unquoted one runs, each guard spawned only when the command could trip it.
- `hooks/commit-msg.sh` — a git hook, not a Claude Code one: the Commit hook below.
- `dw-sdlc` — a link to `packages/dw-sdlc`, the package that owns the config: `src/agentic-config.ts`
  resolves the layers, `src/json-schema.ts` is the dependency-free schema validator, and
  `config/agentic.config.schema.json` is the JSON Schema for `.ai/agentic.config.json`.
  `claude plugin install` copies the link as a real directory, so the installed plugin carries the
  package's code.
- `scripts/` — the TypeScript side: `agentic-config.ts` checks the config through the package
  (`node <plugin root>/scripts/agentic-config.ts` from a repository runs it), `guardrails-setup.ts`
  and `guardrails-doctor.ts` are the Setup and Doctor below.
- `skills/sdlc-guardrails-setup/` — the skill a user invokes to run the setup script; the model cannot
  start it on its own.
- `test/` — the tests, mirroring `hooks/` and `scripts/`: `harness.ts` spawns a guard on the real
  stdin payload; every input a test reads is built beside it.

## Guards

- `block-dangerous-commands.sh` (always on) — refuses what destroys work the reflog cannot bring
  back, and the remote writes others build on, at every command position: indented, after a
  separator, in a subshell or a substitution, behind `sudo`, `env`, `xargs`, `timeout`, `time`,
  `nohup`, `nice`, `exec`, `stdbuf`, `find -exec`, `bash -c`, `eval`, `rtk`, a shell keyword, a
  `VAR=x`, a path or a backslash, and in a heredoc or here-string a shell reads.
  - git, read word by word: `reset --hard`; `clean` with `-f`, `-d`, `-x`, `-X` or `--force` unless
    a dry run; `branch -M` and `-C`, and `-f` or `--force` on a move, a copy or an existing branch;
    `checkout -f` or of the whole tree; `switch -f` and `--discard-changes`; a `restore` of the
    whole tree unless `--staged` alone; `stash drop` and `clear`; `worktree remove --force`;
    `reflog expire` and `delete`; `gc --prune=now|all`; `prune`; `update-ref -d`. A plain
    `branch -d` and `worktree remove` pass, because git keeps unmerged and dirty work from them
    itself.
  - forced branch delete: `branch -D`, `-d -f` or `--delete --force` passes when each branch it
    names is landed: its work is on origin's base branch, `baseBranch` or under `auto` the branch of
    origin that `origin/HEAD` names. Its tip is there, or a base commit since it forked holds the
    tip's tree or the patch-id of its whole diff, as a squash merge leaves them; a branch that ends
    where it forked is not landed. Only local objects are read, never fetched in a partial clone, so
    a base fetched before the merge refuses until `git fetch`. It passes only as a command of its
    own, `[rtk] git [-C <path>] branch -D <branch>...` with a redirect at most, each branch and the
    path written out: a `cd`, a `GIT_DIR`, a pipe, a substitution, a variable or an `xargs` could
    aim git elsewhere than the guard looks. `-r` is refused.
  - push: a bare `--force`, `-f` or `+refspec` and a `--mirror` are refused; `--force-with-lease`
    and `--force-if-includes` pass to a branch outside `guardrails.protectedBranches`, behind a
    prompt under `guardrails.forcePush: ask`, and nothing passes under `deny`. A plain push to a
    protected branch is refused: those branches take pull requests. So is a remote branch deletion:
    `--delete`, `-d`, a `:branch` refspec, or `--prune` with `--all`, `--tags`, no refspec or a
    wildcard one. `--all` and a wildcard refspec count every local branch.
  - commit, merge, cherry-pick and revert: on a protected branch, under
    `guardrails.commitOnProtected: deny`. A `switch -c` or `checkout -b` earlier in the same
    command moves the branch a commit or a push is judged on.
  - gh: `repo delete`, `pr merge` or `close` with `--delete-branch`, and `api` deleting a ref or a
    repository or force-updating a ref, REST or GraphQL.
  - rm, read in place: aimed at `/`, `~`, `$HOME`, `..` and upward, the working directory by name
    (`$PWD`, `$(pwd)`, `$(git rev-parse --show-toplevel)`), or a `.git` at any path, as any operand;
    `.`, `./*` or a bare `*` too, unless a `cd` earlier in the command moved below the session's
    directory; `find -delete`; `shred`.
- `block-env-access.sh` (file tools and Bash) — an env file (`.env`, `.env.*`, `.envrc`) is judged by
  `guardrails.envFiles` in the resolved config: a path in `deny` is refused, one in `allow` passes,
  the rest go to `policy` — `git` lets a tracked file through and refuses one git ignores or does
  not know, `deny` refuses them all. Entries are globs against the path relative to the repository
  root, `**/` meaning at any depth; the defaults are policy `git`, the `.env.example`, `.env.sample`
  and `.env.template` names allowed anywhere, nothing denied. A path outside the repository root,
  or outside any repository, is judged by its basename against the `**/` entries alone. A `Grep`
  of a directory is judged by the env files its `glob` reaches.
- `credential-leak-guard.sh` (always on) — refuses reading the credential stores that are not dotenv
  (`~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.kube`, `~/.netrc`, `~/.git-credentials`, `~/.pypirc`,
  `~/.pgpass`, the user's `~/.npmrc`), filtering an environment dump for a credential-ish name,
  printing such a variable's value, and any `curl` or `wget` carrying one of those or a dotenv file.
- `block-non-pnpm.sh` (when the command names npm, npx, yarn or bun) — refuses them where the
  resolved `packageManagers.node` is `pnpm`, inferred from the lockfile when nothing declares it;
  silent in every other repository.
- `block-store-writes.sh` (when the command names `asc` or a store script) — refuses an agent every
  write to App Store Connect, in every repository and with no config: `asc`, its CLI, reaches the
  whole account from any directory with the owner's Keychain key. An `asc` call passes as a read
  when its verb, the last word before the first flag, is `list`, `view`, `show`, `summary`,
  `status`, `pull`, `plan`, `diff`, `validate`, `audit`, `download`, `init`, `approve`, `sizes`,
  `specs` or `placements` (`asc docs show <guide>` included), with `--help`, with no verb at all
  (`asc --version`), or with `--dry-run` and no `--confirm`. Every other verb is refused —
  `metadata apply`, `prices set`, the asset library's `upload`, `rename`, `archive`, `unarchive`
  and `delete`, `localizations placements create`, `reorder`, `swap` and `delete` — and so is a flag
  before the command, `asc --profile x metadata pull`, whose value would hide the verb. A store
  command, `pnpm store:<name>` or `node scripts/store-<name>.ts`, runs unless it carries
  `--confirm`, quoted or not, on a continuation line, or behind `rtk`, `env`, `sudo` or `VAR=value`.
- `enforce-commit-hygiene.sh` (when the command names `git commit` or `git add`) — the subject must
  match `commit.pattern`, or the preset `commit.convention` names when no pattern is set:
  `conventional` unless a config layer sets `ticket-key`; `.+` accepts anything. The message must
  carry `commit.trailer` when one is declared, a live backtick inside `-m` is refused, and so are
  `git add -A` and `git add .`.
- `large-file-guard.sh` (after a Write) — flags a file over 256 KiB once it is on disk: a pasted
  bundle, a blob, a dumped log. Advisory, so it is the one guard with a kill switch:
  `CLAUDE_MAX_WRITE_BYTES` raises or lowers the threshold, `0` disables it.
- `rtk-rewrite.sh` (Bash, not a guard) — the plugin's wiring of `rtk hook claude`, so a machine wires
  nothing by hand and `rtk init --show` reporting "Hook: not found" is expected. Without rtk it is
  silent. In a linked worktree a command naming `git` goes through unrewritten: the session's
  isolation check cannot read through the `rtk` wrapper and would refuse the plain `git status` the
  agent typed. It runs beside `bash-guard.sh`, and the guards judge the command before the rewrite.

## Commit hook

The guards judge the agent's tool calls, so a commit typed in a terminal never meets them.
`hooks/commit-msg.sh` is the subject check of `enforce-commit-hygiene.sh` as a git `commit-msg` hook:
it takes the message file git hands the hook, resolves the same config and exits 1 on a subject off
`commit.pattern`, which aborts the commit. The subject is the first line git keeps: comment lines,
leading blank lines and a `--verbose` diff below the scissors line are skipped, an empty message is
left to git, and git's own `Merge`, `Revert`, `fixup!`, `squash!` and `amend!` subjects pass. The
trailer is not checked, since a commit a person writes has no co-author to name. Without jq it says
so and lets the commit through. A repository wires it from its own hook manager; this one runs
`bash plugins/guardrails/hooks/commit-msg.sh "$1"` from `.husky/commit-msg`.

## Setup

The `sdlc-guardrails-setup` skill runs `scripts/guardrails-setup.ts`: it writes this machine's
`.ai/agentic.config.local.json` with `$schema` and, when the committed config leaves it unset, the
Node package manager from the lockfile. `commit.convention` is written only when
`--convention ticket-key` or `--convention conventional` asks for it, because a local pin outranks a
convention the repository commits later; a run without the flag keeps a pin as it is. Every run,
`--force` included, keeps a `guardrails` block the local config holds, since that layer may only
tighten it; `--force-push deny|ask|lease` and `--commit-on-protected deny|allow` pin those two keys
in it, and a pin that loosens the committed value is refused. The script also excludes the local
config and `.claude/settings.local.json` in `.git/info/exclude`, generates `permissions.deny`
into `.claude/settings.local.json` as the backstop for a machine without `jq` (the destructive git
set and `gh repo delete` in plain and `rtk` form, `Read`/`Edit` rules for every env file the resolved
`guardrails.envFiles` refuses: listed in `deny`, or unknown to git and not listed in `allow`), and
removes `git branch -D *` in both forms from it, since a deny rule there would refuse the landed
branch the guard lets through. It adds the lease-push exception and the irreversible deny set
(`rm` at `/`, `~` or `.`, `shred`, `find -delete`, `git stash clear`) to `~/.claude/settings.json`;
an `autoMode.allow` list the run creates opens with `"$defaults"`, an existing one only gains the
exception. Every file is written only when it would change; `--dry-run` shows the changes, `--force`
overwrites a differing local config, and a `refused` line exits 1. The only thing run in the
repository is read-only `git`.

## Doctor

`scripts/guardrails-doctor.ts` prints one PASS / WARN / FAIL line per machine check and installs
nothing: `jq`, the plugin enabled, rtk not wired by hand beside the plugin's hook and the filters
that misbehave on the installed release excluded (`find` below rtk 0.46.0), Safe Chain visible to
the agent's login shell with `npm` going through it (a WARN when absent), pnpm's global
`minimumReleaseAge`, commit signing, and the resolved config of the repository holding `--root` or
the current directory. A check that does not apply here is INFO, the config outside any repository
among them. Exit 1 on a FAIL. The setup skill runs it last, as
`node "${CLAUDE_PLUGIN_ROOT}/scripts/guardrails-doctor.ts"` from the repository; a terminal runs
`node <plugin root>/scripts/guardrails-doctor.ts`, where `claude plugin list --json` names the plugin
root as `installPath`. It needs only Node 24.

## Session start

`hooks/session-start.sh` runs on `startup`, `resume`, `clear`, `compact` and `fork` and adds context the
first turn should have: a missing `jq` (every guard is silent without it), an invalid config with
each problem named and the reminder that the guards run strictest until it is fixed, and in a linked
worktree the `.worktreeinclude` files not yet copied in and the `worktree.setup` commands. It
reports and never installs. A main checkout in order
gets nothing.

A config layer is invalid, too, when the hooks cannot validate it against the schema beside them,
`dw-sdlc/config/agentic.config.schema.json`. A marketplace added from GitHub without `packages` in
its `--sparse` set installs the plugin without that file. The report then names the schema and says
an install from GitHub needs `packages` in its `--sparse` set. A schema that is there but fails in
jq, one that is not JSON for example, is named with jq's first error line. Either way the layer is
dropped and the guards run strictest.

## Tests

`test/` mirrors the source tree: `test/hooks/<guard>.test.ts` spawns the guard on the real stdin
payload and asserts its exit code and verdict, `test/scripts/` holds the TypeScript tests,
`test/harness.ts` is the shared part, and every input a test reads is built beside it in a scratch
directory. `pnpm test` runs them all on
`node:test`, a file per process, as part of `pnpm check`. The jq and TypeScript copies of the config
contract are tested against the same cases. `test/hooks/command-position.test.ts` runs every rule
through the dispatcher bare and behind each launcher family, and `lib.test.ts` holds the word reader
and the boundary to every launcher spelling. jq is a hard requirement: without it the harness fails
loudly instead of passing empty.
