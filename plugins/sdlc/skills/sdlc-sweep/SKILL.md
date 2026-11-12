---
name: sdlc-sweep
description: Remove what finished work leaves behind, with the Sweep, and report what it removed and what it kept. It runs only on the dev's word, when the dev types /sdlc-sweep or says go on a Recap follow-up that names a Sweep. A request in other words, such as "clean up" or "delete the old branches", is never this skill.
---

# sdlc-sweep

Run the Sweep from the main checkout, report it and stop. It acts only on the dev's word: the slash
command, or "go" on a Recap follow-up that names it. Without one of those, do not run it. It runs
through the plugin's link to the package, never a `dw-sdlc` from PATH:

```bash
node "${CLAUDE_PLUGIN_ROOT}/dw-sdlc/src/cli.ts" sweep --json
```

Add `--dry-run` only when the dev asked to look first, then report it as "would remove".

## Read the answer

- Exit 0, nothing kept, and exit 1, something kept, both print one document on stdout: `removed` and
  `kept`, each item with its `kind` (`branch`, `worktree`, `lock` or `terminal`), its `name` or
  `path`, its `reason`, and for some kept items the dev's `command`; a kept item with none needs
  nothing from the dev.
- Exit 2: it cannot run, and the reason is on stderr. Say it in one line and stop. In a linked
  worktree, say to run `/sdlc-sweep` from the main checkout; leave out any bare `dw-sdlc` command the
  reason quotes.

## The answer

End with this section, in this order.

**The outcome**, in one sentence: how many items the Sweep removed (or would remove) and how many it kept.

**Report it.** One short table, a row per item, removed first:

| result | kind | item | reason |
| ------ | ---- | ---- | ------ |

`result` is `removed`, `would remove` on a dry run, or `kept`. Under it, one line per kept item that
has a `command`: the item, then the command in a code span, as the dev's to run. With no item at
all, one line: nothing to sweep.

Never run a kept item's command: a forced delete, a forced worktree removal, `git worktree unlock` or
stopping a terminal is the dev's call. Do not run the Sweep again, fix a kept item or clean up beyond
it. Stop after the report.

**Next.** `Next: <command>` in a code span as the last line, the dev's command and never run by this
skill. The closed list:

- a kept item with a `command`: the command of the first such item;
- nothing kept, or no kept item with a `command`: no line.

Write the `Next:` line only when the dev invoked the skill. Run from a Brief, or called by another skill,
write none.
