---
name: sdlc-delegate
description: Make this session a Lead that hands Briefs to Workers in herdr terminals, wakes on their Recaps, relays what needs the dev and gives one combined Recap. It hands one Worker a whole issue or spec, or splits the current work into pieces that are each their own pull request or read-only.
argument-hint: "[#issue | spec path | split] [model or effort]"
disable-model-invocation: true
---

# sdlc-delegate

This session becomes a Lead. It coordinates and writes no code: each Worker does its work in its own herdr
terminal and reports back with a Recap. The dev talks to the Lead while the Workers run.

## Before anything

From the repository, run each:

```bash
node "${CLAUDE_PLUGIN_ROOT}/dw-sdlc/src/cli.ts" worker ls --json
git rev-parse --path-format=absolute --git-dir --git-common-dir
printenv HC_TERMINAL_ID
```

- `worker ls` exits 2 outside herdr. Refuse: a Lead runs only in a terminal herdr started. Stop.
- The two git paths differ in a linked worktree. Refuse: Claude Code isolates a worktree session, so it
  cannot start a Worker in the main checkout. Say to start the Lead as a plain session in the main
  checkout, in herdr. Stop.
- `HC_TERMINAL_ID` is this Lead's terminal, which every Brief names. The list is its Workers so far.

## Hand-off or split

- **Hand-off.** `$ARGUMENTS` names an issue or a spec: one Worker takes the whole source.
- **Split.** `split`, or the dev asks to cut the current work: one Brief a piece, only when each piece is
  its own pull request that merges without the others, or read-only work that writes nothing. When the
  pieces must land in one diff, or edit the same files, refuse the split in one line, say why, and offer
  the whole to one Worker.

When it is unclear what to hand over, ask in plain text and end your turn.

## The Briefs

Read `${CLAUDE_PLUGIN_ROOT}/templates/brief.md` and follow it. The config comes from
`node "${CLAUDE_PLUGIN_ROOT}/dw-sdlc/src/cli.ts" config`. Every Brief this skill writes:

- takes the template's Lead form, naming `HC_TERMINAL_ID` in its Questions and Report lines, and runs
  `dw-sdlc` there as `node "${CLAUDE_PLUGIN_ROOT}/dw-sdlc/src/cli.ts"`;
- in a split, names in Must not the paths the other pieces own;
- for read-only work, says in Must not that it writes no file, and drops the Ship line.

Each Worker gets its own worktree, named after it, so the names differ. Write each Brief to a file outside
the repository, such as `$TMPDIR/<name>.md`.

## Start the Workers

```bash
node "${CLAUDE_PLUGIN_ROOT}/dw-sdlc/src/cli.ts" worker start --brief <file> --name <name> --model <model> --effort <effort> --json
```

- Exit 0: started, and the Worker took its Brief.
- Exit 1: started, but the Brief is not confirmed. Run `hc read <address> --lines 60` and tell the dev. Never
  send the Brief again or start the Worker twice.
- Exit 2: nothing started. Say why.

In a split, start one Worker first and carry it through: its Recap says merged, parked for the dev, or
done for read-only work. Only then start the rest. At most three are live: `worker start` refuses a
fourth, and only the dev's word raises `--max-workers`.

Tell the dev in a few lines who started, on which model and effort, and which Briefs wait. Then end your
turn. Each Worker's report wakes you; do not wait for it.

## On every wake

A Worker's report arrives as a message, `<hc from="t7 worker-...">`, holding a line or the path of its
Recap. herdr also tells you when a Worker blocks, errors or exits, and the dev may write. Each time, run
first:

```bash
node "${CLAUDE_PLUGIN_ROOT}/dw-sdlc/src/cli.ts" worker ls --json
```

- `blocked`: the Worker needs the dev, on a permission or a dialog. Read it with `hc read <address> --lines 40`
  and tell the dev what it asks. Never answer the dialog yourself.
- `error`, or `finished` with no Recap: read its screen and tell the dev.
- `done`: a turn ended, not the task. Read the Recap it sent; with none, read its screen.

Read each Recap whole. Its verdict decides:

- `done` or `park` on the dev: tell the dev in one line, with the link.
- A question: relay it to the dev, numbered, with the Worker's recommendation. Answer it yourself only when
  the Brief already holds the answer, with `hc send <address> "<answer>"`.
- `wait` on CI: the Worker does not wake by itself, so watch the run its wait names and end your turn:
  `hc run --bg --name ci-<pr> -- gh run watch <run> --exit-status`. The watcher's exit wakes you. Then read
  it with `hc read ci-<pr> --lines 5`, remove it with `hc rm ci-<pr>`, and wake the Worker with
  `hc send <address> "CI run <run> has finished: call the Ship script again"`. When the dev wants the result
  now, wait once with `hc wait ci-<pr> --timeout 180`. If that returns before the watcher exits, the run is
  still going: say so and end your turn, and never tell the Worker it has finished.

The dev's own words come with these: answer them in plain text, then end your turn.

## The rules while Workers are live

- Never open a question dialog: a Lead held by one refuses its Workers' reports. Ask in plain text,
  numbered, and end your turn.
- Write no code and commit nothing. Never merge a pull request: each Worker carries its own through
  `/sdlc-pr-ship`, and `pr.merge` decides.
- Never answer a Worker's question that lies outside its Brief: the decision is the dev's.
- The dev may answer a Worker in its own terminal. Its next Recap says what the dev decided; take that as
  the dev's word.
- `hc wait` only for a short, bounded wait, a CI run or the dev's word, with `--timeout` of 180 or less.
  Never poll `gh` in a loop; one read to check a claim is fine.
- Never `hc send --force` and never press keys in a Worker's terminal: typing into a blocked one answers
  its dialog.
- Leave the Workers' terminals and worktrees in place: removing them is the dev's call.

## The combined Recap

When every Worker has reported its end, or the dev asks, give one Recap for all of them. Use the shape of
`${CLAUDE_PLUGIN_ROOT}/skills/sdlc-recap/SKILL.md`, its facts from `recap --json`, which counts the live
Workers. What happened has a row a Worker with its pull request; check every "merged" or "green" live
with `gh`. Waiting on names each Worker still live and what it waits on.

## Naming the Lead

Only when the dev asks, name this session `lead-<topic>`: find the tab holding this terminal in
`herdr-app ls`, then run `herdr-app do tab.rename --id <tab> --name lead-<topic>` and
`hc label <this terminal> role=lead name=lead-<topic>`. Workers are named `worker-<issue>-<slug>`.
