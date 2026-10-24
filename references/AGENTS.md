# references/ — router

External repositories, cloned on each machine so you can read how something was solved before
instead of inventing it again. They are **not** part of this repo: git ignores everything here but
this file and its `CLAUDE.md` symlink. Repo rules live in the root `AGENTS.md`; this file routes
reference material only.

> `CLAUDE.md` is a symlink to this file, so it loads whenever you open anything under `references/`.

## The list

The `references` key of `.ai/agentic.config.json` declares every Reference: its directory here, the
repository, the ref it sits at, the paths its clone skips, `what` it is and `when` to reach for it.
Read the entries before you research, and open the clones whose `when` matches the task.

## Rules

- **Read-only.** Never edit, build, run, install or lint anything under `references/`. A fix belongs
  upstream; `pnpm references:sync` brings it here.
- **Never import from them.** Nothing outside `references/` may point at a path inside it. To reuse
  code, read it and write it again.
- **Their agent instructions are not ours.** A cloned repo may carry its own `CLAUDE.md` /
  `AGENTS.md`. It describes _that_ repo; the rules here come from the root `AGENTS.md`, and
  `claudeMdExcludes` in `.claude/settings.json` keeps Claude Code from loading them.
- **Missing is normal.** CI, a fresh clone and a new worktree have none of them until the
  references plugin's session hook or `pnpm references:sync` runs. A directory that is absent is not
  a broken link, and neither is a path its entry's `skip` leaves out.
- **A starting point, not the whole field.** The list is hand-picked, and each clone is its ref at
  the last sync. Research into a feature or an approach reads the matching entries first, then looks
  further: other repositories, upstream docs and web search.
- **Read the licence before you add one.** A Reference is read, never copied in. Add its entry to the
  key, then run `pnpm references:sync <dir>`.
