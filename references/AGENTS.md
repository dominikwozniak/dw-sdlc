# references/ — router

External repositories, cloned on each machine so you can read how something was solved before
instead of inventing it again. They are **not** part of this repo: git ignores everything here but
this file and its `CLAUDE.md` symlink. Repo rules live in the root `AGENTS.md`; this file routes
reference material only.

> `CLAUDE.md` is a symlink to this file, so it loads whenever you open anything under `references/`.

## The list

The table below is written from the `references` key of `.ai/agentic.config.json` by
`pnpm references:setup`, so edit the key, never the table; the key also holds `what` each Reference
is, its repository, its ref and the paths its clone skips. Before you research, open the clones whose
`when` matches the task.

<!-- references:start — written from .ai/agentic.config.json by the setup; edit the key -->

| dir                       | reach for it when                                                                                                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `dw-solo-skills`          | a skill, hook or plugin for a repo one person reads, or keeping a change alive across `/clear`                                                                                       |
| `mattpocock-skills`       | writing a small single-purpose skill, or a prompt that interrogates an idea, drives TDD or hunts a bug                                                                               |
| `addyosmani-agent-skills` | a phase-by-phase workflow with quality gates, or one skill shipped to Claude, Codex, Gemini and Cursor at once                                                                       |
| `open-mercato-skills`     | automating a team PR flow: labels, autopilot loops, review and QA gates, many contributors                                                                                           |
| `dw-mc`                   | a CLI over `gh` and Claude Code, or Effect in a real tool                                                                                                                            |
| `kcd-skills`              | a skill that carries its own CLI and tests, auditing how ready a repo is for agents, or a loop that drives a PR to merged                                                            |
| `kody`                    | agent instructions and docs for a large repo, harness engineering, or the skills `kcd-skills` comes from                                                                             |
| `byarcadia-foundation`    | a pnpm library monorepo on Vite+ with changesets and npm publishing, a React Native hook package and its tests, or an oxlint JS plugin                                               |
| `dmmulroy-anti-slop`      | writing an oxlint JS plugin rule with RuleTester, a lint policy against `unknown`, `as` and `typeof` in TypeScript, or a skill that vendors code into a repo and updates it in place |
| `pstack`                  | a mode skill that routes a task to playbooks, a skill that runs several models or parallel agents on one task, or engineering principles written as skills                           |
| `grateful-me-app-v2`      | agent instructions, docs and checks for a real product repo, the dw-solo lane in daily use, or guard hooks and a check script for an Expo app                                        |

<!-- references:end -->

## Rules

- **Read-only.** Never edit, build, run, install or lint anything under `references/`. A fix belongs
  upstream; `pnpm references:sync` brings it here.
- **Never import from them.** Nothing outside `references/` may point at a path inside it. To reuse
  code, read it and write it again.
- **Their agent instructions are not ours.** A cloned repo may carry its own `CLAUDE.md` /
  `AGENTS.md`. It describes _that_ repo; the rules here come from the root `AGENTS.md`, and
  `claudeMdExcludes` in `.claude/settings.json` keeps Claude Code from loading them.
- **Missing is normal.** CI, a fresh clone and a new worktree have none of them until the
  sdlc plugin's Sync hook or `pnpm references:sync` runs. A directory that is absent is not
  a broken link, and neither is a path its entry's `skip` leaves out.
- **A starting point, not the whole field.** The list is hand-picked, and each clone is its ref at
  the last sync. Research into a feature or an approach reads the matching entries first, then looks
  further: other repositories, upstream docs and web search.
- **Add one with `/sdlc-references-add <repository>`.** It reads the licence, picks the ref and the
  paths to skip, writes the entry, rewrites the table and syncs it. A Reference is read, never
  copied in.
