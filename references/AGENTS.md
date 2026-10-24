# references/ — router

External repositories, cloned on each machine so you can read how something was solved before
instead of inventing it again. They are **not** part of this repo: git ignores everything here but
this file and its `CLAUDE.md` symlink. Repo rules live in the root `AGENTS.md`; this file routes
reference material only.

> `CLAUDE.md` is a symlink to this file, so it loads whenever you open anything under `references/`.

## Rules

- **Read-only.** Never edit, build, run, install or lint anything under `references/`. A fix belongs
  upstream; `pnpm references:sync` brings it here.
- **Never import from them.** Nothing outside `references/` may point at a path inside it. To reuse
  code, read it and write it again.
- **Their agent instructions are not ours.** A cloned repo may carry its own `CLAUDE.md` /
  `AGENTS.md`. It describes _that_ repo; the rules here come from the root `AGENTS.md`, and
  `claudeMdExcludes` in `.claude/settings.json` keeps Claude Code from loading them.
- **Missing is normal.** CI, a fresh clone and a new worktree have none of them until the
  SessionStart hook or `pnpm references:sync` runs. A directory that is absent is not a broken link.
- **A starting point, not the whole field.** The list is hand-picked, and each clone is the head of
  its branch at the last sync. Research into a feature or an approach reads the matching rows first,
  then looks further: other repositories, upstream docs and web search.

## Repositories

| dir                       | repository                                         | branch | skip     | what it is                                                                                                                                                                     | reach for it when                                                                                              |
| ------------------------- | -------------------------------------------------- | ------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `dw-solo-skills`          | `https://github.com/dominikwozniak/dw-solo-skills` | `main` |          | Claude Code plugins for a solo change loop — `dw-grill` → `dw-shape` → `dw-next` → `dw-check` → `dw-land` — with the change doc under `.ai/work/`, guard hooks and evals       | a skill, hook or plugin for a repo one person reads, or keeping a change alive across `/clear`                 |
| `mattpocock-skills`       | `https://github.com/mattpocock/skills`             | `main` |          | small, composable skills by Matt Pocock: grilling, TDD, bug diagnosis, domain modelling, codebase design, `to-spec` / `to-tickets`, handoff                                    | writing a small single-purpose skill, or a prompt that interrogates an idea, drives TDD or hunts a bug         |
| `addyosmani-agent-skills` | `https://github.com/addyosmani/agent-skills`       | `main` |          | Addy Osmani's lifecycle skills, spec → plan → build → test → review → ship, with 9 slash commands, reviewer agents and evals, packaged for many coding agents                  | a phase-by-phase workflow with quality gates, or one skill shipped to Claude, Codex, Gemini and Cursor at once |
| `open-mercato-skills`     | `https://github.com/open-mercato/skills`           | `main` |          | 42 `om-*` skills that run a GitHub PR pipeline from issue to merge — plan, implement in a worktree, review, QA gate, labels — configured per repo in `.ai/agentic.config.json` | automating a team PR flow: labels, autopilot loops, review and QA gates, many contributors                     |
| `dw-mc`                   | `https://github.com/dominikwozniak/dw-mc`          | `main` | `repos/` | a local CLI that tracks your open PRs: reads GitHub through `gh`, runs reviews with Claude Code and puts each PR in one bucket; TypeScript on Effect 4, published to npm       | a CLI over `gh` and Claude Code, or Effect in a real tool                                                      |

`skip` lists paths, in backticks, that the clone leaves out through a sparse checkout. `dw-mc` skips
`repos/`, where it vendors Effect: 4044 of its 4298 files.

## Sync

```bash
pnpm references:sync          # every row in the table
pnpm references:sync <dir>... # only these
```

A missing directory is cloned with `--depth 1` from the row's branch; an existing one is fetched and
checked out, detached, at that branch's head. A clone with local edits the update would overwrite
fails its row and is left as it is. The command reports each row and any directory under
`references/` the table no longer lists; it never deletes one.

A `SessionStart` hook, `.claude/hooks/sync-references.sh`, runs the same sync when a Claude Code
session starts and prints where each clone stands. It covers a fresh worktree too, which starts
without the clones: `.worktreeinclude` does not copy a nested repository. Offline, a clone stays where
it was and the hook says so; it never fails the session.

## Add a repository

Add its row to the table, then run `pnpm references:sync <dir>`. The script reads the `dir`,
`repository`, `branch` and `skip` cells, so they hold exactly what it needs, in backticks: `dir` a
single directory name, `repository` a URL `git` can fetch, `skip` empty or one backticked path per
entry. Read the licence before you add a row: a reference is read, never copied in.
