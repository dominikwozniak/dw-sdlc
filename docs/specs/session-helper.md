# The session helper

`/sdlc-session` names the herdr session the dev types it in as a Lead or a Worker, and lists the live
sessions. It is a helper on demand and no step of the workflow.

## Problem

A session the dev starts by hand has herdr's number for a name and no role, so the dev cannot tell a
Lead from a Worker in the window or in `hc ls`. Naming one meant raw `herdr-app` and `hc label` lines that
`sdlc-delegate` carried in prose. A session that is a Lead also forgets that it coordinates and starts to
code.

## Goal

A dev in herdr names the session as a Lead or a Worker, and lists the live sessions, with one helper. A
session named Lead knows it coordinates and does not code.

## Solution

- **The skill.** `sdlc-session` in `plugins/sdlc-sessions/skills/`. Model invocation stays on, with a
  narrow description: the name or role of this herdr session. Its frontmatter sets `model: haiku` and
  `effort: low` and has no `context: fork`, since the override lasts one turn and `lead` must change this
  session.
- **Subcommands, all on the calling session.** `lead [topic]` names it `lead-<topic>`; `worker [name]`
  names a session the dev started by hand; `ls` lists every live session with its role, name, status
  and folder, where `worker ls` lists only the Workers of one Lead. With no topic or name, it comes from
  the current work and the answer shows it. Outside herdr it refuses, as `/sdlc-delegate` does.
- **No arguments.** `/sdlc-session` alone prints a table of subcommand, what it does and when to use it,
  with examples. The plugin README carries the same.
- **The bin.** `dw-sdlc session name <name> --role lead|worker` sets the labels `role=<role>` and
  `name=<name>` on `$HC_TERMINAL_ID` with `hc label`, then renames the tab that holds it with `nameTab`
  (`packages/dw-sdlc/src/worker/tabs.ts`). `dw-sdlc session ls` reads `hc ls --json` once for every live
  terminal and once for each role label, since `hc ls` prints no labels. The section Naming the Lead of
  `sdlc-delegate` calls `session name`; delegate names only on the dev's word and keeps a name the
  session already holds.
- **The Lead mode.** Soft, and only once `lead` ran: the session writes no code, turns work into tickets
  or Briefs, keeps one thing at a time, and offers `/sdlc-delegate` once tickets exist. The dev lifts it
  in their words, such as "do it here". No guard enforces it.
- **Words.** The glossary lists "orchestrator" under Avoid for Lead: the skill understands it and answers
  with Lead.

## Out of scope

- Renaming a terminal other than the calling one.
- Adopting Workers another session started as children of this Lead. herdr sets a terminal's parent when
  it starts and `hc` cannot change it, so a label alone makes none. The skill says so when asked.
