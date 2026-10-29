---
name: sdlc-setup
description: Set a repository and this machine up for the sdlc plugin. Safe to repeat.
disable-model-invocation: true
---

# sdlc-setup

Each file is written only when its content would change. Run the dry run first and show its lines;
then run for real and show those. A `refused` line ends the run: show it and stop, and never add
`--force` yourself, since it overwrites a file nothing brings back. The package line below is the
one refusal that asks instead. Nothing is installed by the setup; the only thing it runs in the
repository is read-only `git`.

```bash
node "${CLAUDE_PLUGIN_ROOT}/dw-sdlc/src/cli.ts" setup --dry-run
node "${CLAUDE_PLUGIN_ROOT}/dw-sdlc/src/cli.ts" setup
```

Pass a flag only for what the argument or the request names, to both commands; a pin the local
config already holds stays without one:

- a commit convention, as `/sdlc-setup ticket-key` does: `--convention ticket-key` or
  `--convention conventional`;
- how a lease push goes: `--force-push ask` (a prompt each time), `--force-push deny` or
  `--force-push lease`;
- no commit on a protected branch: `--commit-on-protected deny`, or `allow`.

A repository where every change goes through a pull request and lease pushes need a prompt, as an
AirHelp one, is `--convention ticket-key --force-push ask --commit-on-protected deny`. A pin that
loosens what the committed config sets is refused.

Node 24 or later is needed for the TypeScript to run natively; the hooks themselves need only bash
and jq.

## The package and the Gate

A repository with a `package.json` that names no `dw-sdlc` gets this line from the dry run:

```text
refused     package.json — no dw-sdlc devDependency, and a new one needs your yes: --add-package pins dw-sdlc <version>
```

Before anything is written, ask the user whether to add `dw-sdlc` as a devDependency pinned at the
version the line names, and say that a yes also adds the `gate` key below, which this dry run does
not show yet. On no, stop: run nothing more. On yes, add `--add-package` to both commands,
run the dry run again and show its lines, then run for real. When the real run wrote
`package.json`, run the install its line names, `pnpm install` in a pnpm repository, so the lockfile
and `node_modules` hold the package. An install the release-age gate refuses is shown and ends the
run; an exclusion for it is the owner's call, not this skill's.

With the package there, the run adds the `gate` key to the committed `.ai/agentic.config.json` when
the config has none, and creates the file when it is absent. A `gate` key the config has stays as it
is. A repository without a `package.json` gets neither line, and its run is the guards' files alone.

The key names every Check the package ships. `markdown-refs`, `temporal-language` and
`comment-budget` are on: each judges the tree as it is. `agents-map` is on too: it reads `AGENTS.md`,
which the user writes, and the first Gate names what the map lacks. Every other Check is `false`, as
each reads an input the repository adds first: `primitives` a catalogue, `decision-records` a
records directory, `markdown-budget` the docs its glob matches, `file-size-ratchet` its baseline.

## What each file is

- `package.json` — `dw-sdlc` in `devDependencies` at the version this setup runs, so the doctor finds
  the plugin and the repository on the same code. Written only with `--add-package`; a pin the file
  holds, at any version, stays.
- `.ai/agentic.config.json` — the `gate` key above. This file and `package.json` are committed, so
  from a linked worktree they go to the worktree, on its branch.
- `.ai/agentic.config.local.json` — the machine's layer over the committed `.ai/agentic.config.json`:
  the Node package manager from the lockfile, only where the committed file leaves it unset, because
  the local layer outranks it. `commit.convention` is pinned by `--convention` and kept by a run
  without it, so the flag is passed once; a local pin outranks a convention the repository commits
  later, and a repository that commits its convention needs none. `$schema` is a `file://` URL to
  the schema in the marketplace's clone, since the `$id` sits in a private repository an editor
  cannot fetch. A `guardrails` block the file holds is kept on every run, and `--force-push` and
  `--commit-on-protected` pin those two keys in it. An existing file with other content than
  `$schema`, the pins and that block is refused; `--force` overwrites it and keeps the pins and the
  block. Run from a linked worktree, it goes to the main checkout with the two
  files below, and every worktree without a layer of its own reads it there. Edited by hand, the
  file may tighten `guardrails` and never loosen it.
- `.git/info/exclude` — that file and `.claude/settings.local.json`, so neither reaches a commit and
  the tracked `.gitignore` stays the repository's.
- `.claude/settings.local.json` — `permissions.deny` as the backstop for a machine without `jq`: the
  destructive git commands and `gh repo delete` in plain and `rtk` form, and `Read`/`Edit` rules for every `.env`,
  `.env.*` or `.envrc` git ignores here, `.env.example`, `.env.sample` and `.env.template` aside.
  A tracked env file stays readable. The run removes `Bash(git branch -D *)` and its `rtk` form:
  the guard lets a forced delete of a landed branch through, and the rule would refuse it anyway.
- `~/.claude/settings.json`, or `$CLAUDE_CONFIG_DIR/settings.json` when Claude Code runs from
  another config dir — `autoMode.allow` gains the lease-push exception; a list the run
  creates opens with `"$defaults"`, so the classifier's built-in rules stay, and an existing list
  only gains the exception. `permissions.deny` gains the irreversible set: `rm` at `/`, `~` or `.`,
  `shred`, `find -delete`, `git stash clear` in plain and `rtk` form. Existing entries stay.

A `by hand` line names an edit the setup leaves to the user. While the settings still enable
`guardrails@dw-sdlc` or `references@dw-sdlc`, the two plugins `sdlc` replaced, the line names the
`enabledPlugins` change. Show it; never edit `enabledPlugins` yourself.

The setup never writes the agent map, `AGENTS.md`.

## After the run

Check what the guards now see with `node "${CLAUDE_PLUGIN_ROOT}/dw-sdlc/src/cli.ts" config`
from the repository; from a worktree it names the main checkout as the layer's source. One run per
repository covers its worktrees, wherever they sit, so `.worktreeinclude` needs no entry for the
local config.

Then run the doctor from the repository and show its lines, one PASS / WARN / FAIL per machine
check. It installs nothing; run a fix a line names only when the user asks.

```bash
node "${CLAUDE_PLUGIN_ROOT}/dw-sdlc/src/cli.ts" doctor
```

When the run wrote the `gate` key, run the Gate once and show its lines. `agents-map` names what the
agent map lacks, such as the Gate command; edit `AGENTS.md` only when the user asks.

```bash
pnpm exec dw-sdlc gate
```

To turn `file-size-ratchet` on once the Gate is green, set it to `true` and run
`pnpm exec dw-sdlc gate --update-baseline`: it records `.ai/file-size-ratchet.baseline.json`, which
the repository commits. The refresh runs only when every other Check passes.
