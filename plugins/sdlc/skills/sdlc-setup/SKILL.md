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

Where `cswap` is on PATH, the run also writes `worker.command`, the command a Worker session starts
with, into the local config and shows it on the dry run's `would write` line. No flag asks for it.

A repository where every change goes through a pull request and a lease push needs a prompt is
`--convention ticket-key --force-push ask --commit-on-protected deny`. A pin that loosens what the
committed config sets is refused.

Node 24 or later is needed for the TypeScript to run natively; the hooks themselves need only bash
and jq.

## The package and the Gate

The Gate is the package's `dw-sdlc gate`: the repository's own Steps, then the Checks, named rules over
the tree, its config turns on. A repository with a `package.json` that names no `dw-sdlc` gets this line
from the dry run:

```text
refused     package.json — no dw-sdlc devDependency, and a new one needs your yes: --add-package pins dw-sdlc <version>
```

Before anything is written, ask the user whether to add `dw-sdlc` as a devDependency pinned at the
version the line names, and say that a yes also adds the `gate` key to `.ai/agentic.config.json`, which
this dry run does not show yet. On no, stop: run nothing more. On yes, add `--add-package` to both
commands, run the dry run again and show its lines, then run for real. When the real run wrote
`package.json`, run the install its line names, `pnpm install` in a pnpm repository, so the lockfile
and `node_modules` hold the package. An install the release-age gate refuses is shown and ends the
run; an exclusion for it is the owner's call, not this skill's.

The `gate` key turns on the four Checks that judge the tree as it is: `agents-map`, which reads the
`AGENTS.md` the user writes, `markdown-refs`, `temporal-language` and `comment-budget`. Every other
Check, `routed-docs` among them, is `false` until the repository adds what it reads or opts into its
rule. A repository without a `package.json` gets neither line, and its run is the guards' files alone.

## What the run writes

`setup --help` names every file and the rule of each. Say these to the user from the lines the run
shows, never from memory:

- the machine's layer `.ai/agentic.config.local.json`, excluded through `.git/info/exclude`; its
  `$schema` is a `file://` URL to the schema in the marketplace's clone, which an editor reads offline
  at the installed version;
- `.claude/settings.local.json`, the deny rules that back the guards up on a machine without `jq`;
- `~/.claude/settings.json`, or `$CLAUDE_CONFIG_DIR/settings.json`: the lease-push exception and the
  irreversible deny set, existing entries kept;
- with `--add-package`, `package.json` and the `gate` key in `.ai/agentic.config.json`, both committed.

Run from a linked worktree, the local layer and the two settings files go to the main checkout, and
every worktree reads them there; the committed files go to the worktree, on its branch. Edited by
hand, the local layer may tighten `guardrails` and never loosen it.

A `by hand` line names an edit the setup leaves to the user, such as an `enabledPlugins` entry that
still names `guardrails@dw-sdlc` or `references@dw-sdlc` and needs `sdlc@dw-sdlc` instead. Show it;
never edit `enabledPlugins` yourself.

The setup never writes the agent map, `AGENTS.md`.

## After the run

Check what the guards now see with `node "${CLAUDE_PLUGIN_ROOT}/dw-sdlc/src/cli.ts" config`
from the repository; from a worktree it names the main checkout as the layer's source. One run per
repository covers its worktrees, wherever they sit, so `.worktreeinclude` needs no entry for the
local config.

Then run the doctor from the repository and show its lines, one per check: PASS, WARN, FAIL or
INFO. It installs nothing; run a fix a line names only when the user asks.

```bash
node "${CLAUDE_PLUGIN_ROOT}/dw-sdlc/src/cli.ts" doctor
```

When the run wrote the `gate` key, run the Gate once and show its lines. `agents-map` names what the
agent map lacks, such as the Gate command or a `CLAUDE.md` link to it; edit `AGENTS.md` or
`CLAUDE.md` only when the user asks.

```bash
pnpm exec dw-sdlc gate
```

To turn `file-size-ratchet` on, the Check that lets a file over the size limit stay but never grow, once
the Gate is green, set it to `true` and run
`pnpm exec dw-sdlc gate --update-baseline`: it records `.ai/file-size-ratchet.baseline.json`, which
the repository commits. The refresh runs only when every other Check passes.

## The answer

End with this section, in this order:

1. The outcome in one sentence: what the run wrote, or that it wrote nothing, or the `refused` line that
   ended it.
2. The lines of the dry run and the real run, the `config` check, the doctor and, when it ran, the Gate.
3. `Next: <command>` in a code span as the last line, the dev's command and never run by this skill. The
   closed list:
   - the doctor printed a FAIL: the remedy its first FAIL line names;
   - the Gate failed: `pnpm exec dw-sdlc gate --verbose`;
   - otherwise, or a `refused` line ended the run: no line.

Write the `Next:` line only when the dev invoked the skill. Run from a Brief, or called by another skill,
write none.
