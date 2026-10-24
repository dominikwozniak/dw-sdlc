---
name: guardrails-setup
description: >-
  Set a repository and this machine up for the guardrails plugin: the machine's
  `.ai/agentic.config.local.json` from inference, its git exclude entry, the repository's
  `permissions.deny` backstop, and the lease-push exception in `~/.claude/settings.json`.
  Safe to repeat; a run with nothing changed writes nothing.
disable-model-invocation: true
---

# guardrails-setup

Four files, each written only when its content would change. Run the dry run first and show its
lines; then run for real and show those. A `refused` line ends the run: show it and stop, and never
add `--force` yourself, since it overwrites a file nothing brings back. Nothing is installed; the
only thing the setup runs in the repository is read-only `git`.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/guardrails-setup.ts" --dry-run
node "${CLAUDE_PLUGIN_ROOT}/scripts/guardrails-setup.ts"
```

Pass a flag only for what the argument or the request names, to both commands; a pin the local
config already holds stays without one:

- a commit convention, as `/guardrails-setup ticket-key` does: `--convention ticket-key` or
  `--convention conventional`;
- how a lease push goes: `--force-push ask` (a prompt each time), `--force-push deny` or
  `--force-push lease`;
- no commit on a protected branch: `--commit-on-protected deny`, or `allow`.

A repository where every change goes through a pull request and lease pushes need a prompt, as an
AirHelp one, is `--convention ticket-key --force-push ask --commit-on-protected deny`. A pin that
loosens what the committed config sets is refused.

Node 24 or later is needed for the TypeScript to run natively; the hooks themselves need only bash
and jq.

## What each file is

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

## After the run

Check what the guards now see with `node "${CLAUDE_PLUGIN_ROOT}/scripts/agentic-config.ts"` from the
repository; from a worktree it names the main checkout as the layer's source. One run per repository
covers its worktrees, wherever they sit, so `.worktreeinclude` needs no entry for the local config.

Then run the doctor from the repository and show its lines, one PASS / WARN / FAIL per machine
check. It installs nothing; run a fix a line names only when the user asks.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/guardrails-doctor.ts"
```
