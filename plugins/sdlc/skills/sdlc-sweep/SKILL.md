---
name: sdlc-sweep
description: Remove what finished work leaves behind, with the Sweep, and report what it removed and what it kept. It runs only on the dev's word, when the dev types /sdlc-sweep or says go on a Recap follow-up that names a Sweep. A request in other words, such as "clean up" or "delete the old branches", is never this skill.
---

# sdlc-sweep

Run the Sweep from the main checkout, report it and stop. It acts only on the dev's word: the slash
command, or "go" on a Recap follow-up that names it. Without one of those, do not run it, not even
as a dry run. It runs through the plugin's link to the package, never a `dw-sdlc` from PATH:

```bash
node "${CLAUDE_PLUGIN_ROOT}/dw-sdlc/src/cli.ts" sweep --json
```

Add `--dry-run` only when the dev asked to look first, then report it as "would remove".

## Read the answer

- Exit 0: nothing is kept but the default, the base or a protected branch. Exit 1: something else is
  kept. Both print one document, `removed` and `kept`, each item with its `kind` (`branch`,
  `worktree`, `lock` or `terminal`), its `name` or `path`, its `reason`, and for a kept item the dev's
  `command`.
- Exit 2: it cannot run. Say what it printed in one line and stop. In a linked worktree that line
  tells the dev to run it from the main checkout; add nothing.

## Report it

One short table, a row per item, removed first:

| result | kind | item | reason |
| ------ | ---- | ---- | ------ |

`result` is `removed`, `would remove` on a dry run, or `kept`. Under it, one line per kept item that
has a `command`: the item, then the command in a code span, as the dev's to run. With no item at
all, one line: nothing to sweep.

Never run a kept item's command: a forced delete, a forced worktree removal, `git worktree unlock` or
stopping a terminal is the dev's call. Do not run the Sweep again, fix a kept item or clean up beyond
it. Stop after the report.
