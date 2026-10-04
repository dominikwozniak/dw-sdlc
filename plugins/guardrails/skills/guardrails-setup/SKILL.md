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
only thing run in the repository is read-only `git`.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/guardrails-setup.ts" --dry-run
node "${CLAUDE_PLUGIN_ROOT}/scripts/guardrails-setup.ts"
```

Node 24 or later is needed for the TypeScript to run natively; the hooks themselves need only bash
and jq.

## What each file is

- `.ai/agentic.config.local.json` — the machine's layer over the committed `.ai/agentic.config.json`:
  the Node package manager from the lockfile, only where the committed file leaves it unset, because
  the local layer outranks it. It never pins `commit.convention`; a repository that wants `ticket-key`
  sets `"commit": { "convention": "ticket-key" }` in its committed or local config by hand. `$schema` is a `file://` URL to the schema in the marketplace's
  clone, since the `$id` sits in a private repository an editor cannot fetch. An existing file with
  other content than `$schema` is refused; `--force` overwrites it. In a linked worktree it goes to the worktree, the two files below to the main
  checkout. Edited by hand, the file may tighten `guardrails` and never loosen it.
- `.git/info/exclude` — that file and `.claude/settings.local.json`, so neither reaches a commit and
  the tracked `.gitignore` stays the repository's.
- `.claude/settings.local.json` — `permissions.deny` as the backstop for a machine without `jq`: the
  destructive git commands in plain and `rtk` form, and `Read`/`Edit` rules for every `.env`,
  `.env.*` or `.envrc` git ignores here, `.env.example`, `.env.sample` and `.env.template` aside.
  A tracked env file stays readable.
- `~/.claude/settings.json` — `autoMode.allow` gains the lease-push exception; a list the run
  creates opens with `"$defaults"`, so the classifier's built-in rules stay, and an existing list
  only gains the exception. `permissions.deny` gains the irreversible set: `rm` at `/`, `~` or `.`,
  `shred`, `find -delete`, `git stash clear` in plain and `rtk` form. Existing entries stay.

## After the run

Check what the guards now see with `node "${CLAUDE_PLUGIN_ROOT}/scripts/agentic-config.ts"` from the
repository. To carry the local config into every new worktree, add `.ai/agentic.config.local.json`
to the repository's `.worktreeinclude`.
