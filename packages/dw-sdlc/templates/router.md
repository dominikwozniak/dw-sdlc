# references/ — router

Repositories cloned on each machine so you can read how something was solved before instead of
inventing it again. They are **not** part of this repository: git ignores everything here but this
file and its `CLAUDE.md` symlink. The repository's rules live in its root agent instructions; this
file routes reference material only.

> `CLAUDE.md` is a symlink to this file, so it loads whenever you open anything under `references/`.

## The list

The table below is written from the `references` key of `.ai/agentic.config.json` by the setup, so
edit the key, never the table; the key also holds `what` each Reference is, its repository, its ref
and the paths its clone skips. Before you research, open the clones whose `when` matches the task.

<!-- references:start — written from .ai/agentic.config.json by the setup; edit the key -->

No Reference is declared yet: `/sdlc-references-add <repository>` adds one.
<!-- references:end -->

## Rules

- **Read-only.** Never edit, build, run, install or lint anything under `references/`. A fix belongs
  upstream; the next Sync brings it here.
- **Never import from them.** Nothing outside `references/` may point at a path inside it. To reuse
  code, read it and write it again.
- **Their agent instructions are not ours.** A cloned repository may carry its own `CLAUDE.md` /
  `AGENTS.md`. It describes _that_ repository; `claudeMdExcludes` in `.claude/settings.json` keeps
  Claude Code from loading them.
- **Missing is normal.** CI, a fresh clone and a new worktree have none of them until a local Claude
  Code session starts with the sdlc plugin enabled, which syncs them. A directory that is
  absent is not a broken link, and neither is a path its entry's `skip` leaves out.
- **A starting point, not the whole field.** The list is hand-picked, and each clone is its ref at
  the last sync. Research into a feature or an approach reads the matching entries first, then looks
  further: other repositories, upstream docs and web search.
- **Add one with `/sdlc-references-add <repository>`.** It reads the licence, picks the ref and the
  paths to skip, writes the entry, rewrites the table and syncs it. A Reference is read, never
  copied in.
