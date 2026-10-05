# guardrails

Deterministic guardrails for a Claude Code session, shipped as a plugin. Every rule is a shell hook
that reads the tool call on stdin and refuses it with exit 2, or asks for a prompt, before the call
runs. The rules a repository wants come from its `.ai/agentic.config.json`; a machine adds its own
`.ai/agentic.config.local.json` on top, which may tighten `guardrails` and never loosen it. A key
neither file sets is inferred: the package manager from the lockfile, and the `conventional` commit
convention. The plugin guards Node repositories; it carries no stack-specific guard.

## Install

```bash
claude plugin marketplace add dominikwozniak/dw-sdlc --sparse .claude-plugin plugins
claude plugin install guardrails@dw-sdlc --scope user
```

The hooks need `jq`. Without it every guard exits 0 and guards nothing; the doctor says so.

Added from GitHub, the plugin is a snapshot of `main` that `claude plugin update` refreshes, and
`--sparse` keeps the clone to the catalogue and the plugins. Added from a clone
(`claude plugin marketplace add ./` in the checkout), it runs live from that checkout: a change on
disk is in the next session, a broken edit included.

## Layout

- `.claude-plugin/plugin.json` — the manifest; its `hooks` key wires each guard below to its event.
- `hooks/lib.sh` — the library every guard sources: payload reader, git helpers, refusal, config
  lookup; it sources `hooks/lib-text.sh`, the text scanners — heredoc strip, continuation lines,
  quote masking, words, the wrapper boundary.
- `hooks/schema.jq`, `hooks/config.jq` — the config contract in jq: schema validation and the
  local-over-committed-over-inferred merge, the same behaviour as `scripts/agentic-config.ts`.
- `hooks/bash-guard.sh` — the dispatcher: one stdin read, heredoc bodies dropped once, each guard
  spawned only when the command could trip it.
- `hooks/commit-msg.sh` — a git hook, not a Claude Code one: the Commit hook below.
- `config/agentic.config.schema.json` — the JSON Schema for `.ai/agentic.config.json`.
- `scripts/` — the TypeScript side: `agentic-config.ts` reads, validates and resolves the config
  (`pnpm agentic:check` in the repository runs it), `guardrails-setup.ts` and `guardrails-doctor.ts`
  are the Setup and Doctor below, `json-schema.ts` is the dependency-free schema validator they share.
- `skills/guardrails-setup/` — the skill a user invokes to run the setup script; the model cannot
  start it on its own.
- `test/` — the tests, mirroring `hooks/` and `scripts/`: `harness.ts` spawns a guard on the real
  stdin payload; every input a test reads is built beside it.

## Guards

- `block-dangerous-commands.sh` (always on) — refuses `git reset --hard`, `clean` with `-d`/`-f`/`-x`,
  `branch -f`, `checkout .` from any tree-ish, `checkout -f` and `switch --discard-changes`, a
  `restore` of the whole tree unless `--staged` alone, `stash clear`, remote branch deletion, `rm`
  aimed at `/`, `~` or `.` bare or with `/*`, `rm` with a bare `*`, `find -delete` and `shred`, seen
  through `sudo`, `rtk` and `VAR=x` prefixes. A bare
  `git push --force`, `-f` or `+refspec` is refused; `--force-with-lease` and `--force-if-includes`
  pass to a branch outside `guardrails.protectedBranches`, and nothing passes under
  `guardrails.forcePush: deny`. A plain push to a protected branch is refused: those branches take
  pull requests.
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

The `guardrails-setup` skill runs `scripts/guardrails-setup.ts`: it writes this machine's
`.ai/agentic.config.local.json` with `$schema` and, when the committed config leaves it unset, the
Node package manager from the lockfile. `commit.convention` is written only when
`--convention ticket-key` or `--convention conventional` asks for it, because a local pin outranks a
convention the repository commits later; a run without the flag keeps a pin as it is. The script also excludes the local
config and `.claude/settings.local.json` in `.git/info/exclude`, generates `permissions.deny`
into `.claude/settings.local.json` as the backstop for a machine without `jq` (the destructive git
set in plain and `rtk` form, `Read`/`Edit` rules for every env file the resolved
`guardrails.envFiles` refuses: listed in `deny`, or unknown to git and not listed in `allow`), and adds the lease-push exception and the irreversible deny set
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
`minimumReleaseAge`, commit signing, and the resolved config. A check that does not apply here is
INFO. Exit 1 on a FAIL. `pnpm guardrails:doctor` in this repository, `--root` for another.

## Session start

`hooks/session-start.sh` runs on `startup`, `resume`, `clear`, `compact` and `fork` and adds context the
first turn should have: a missing `jq` (every guard is silent without it), an invalid config with
each problem named and the reminder that the guards run strictest until it is fixed, and in a linked
worktree the `.worktreeinclude` files not yet copied in and the `worktree.setup` commands. It
reports and never installs. A main checkout in order
gets nothing.

## Tests

`test/` mirrors the source tree: `test/hooks/<guard>.test.ts` spawns the guard on the real stdin
payload and asserts its exit code and verdict, `test/scripts/` holds the TypeScript tests,
`test/harness.ts` is the shared part, and every input a test reads is built beside it in a scratch
directory. `pnpm test` runs them all on
`node:test`, a file per process, as part of `pnpm check`. The jq and TypeScript copies of the config
contract are tested against the same cases. jq is a hard requirement: without it the harness fails
loudly instead of passing empty.
