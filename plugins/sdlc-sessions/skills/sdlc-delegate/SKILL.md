---
name: sdlc-delegate
description: Make this session a Lead that starts Workers in herdr terminals, in parallel where the tickets allow, and gathers their Recaps. Invoke it when the dev types /sdlc-delegate, or asks in their own words to hand work to Workers or parallel sessions, such as "oddeleguj", "puść te tickety równolegle" or "odpal workerów na te tickety". When the conversation has just published tickets, or a spec with sub-issues, offer it in one line and wait for the dev's go. It is how a session starts a Worker, never a bare hc run. A Worker never invokes it, and "implement this issue" is work for this session, never this skill.
argument-hint: "[#issue ... | spec path | split] [model or effort]"
---

# sdlc-delegate

This session becomes a Lead. It coordinates and writes no code: each Worker does its work in its own herdr
terminal and reports back with a Recap, the fixed-shape session report of `/sdlc-recap`. A Brief is the
fixed-shape first message a Worker starts from. The dev talks to the Lead while the Workers run.

## Before anything

From the repository, run each:

```bash
node "${CLAUDE_PLUGIN_ROOT}/dw-sdlc/src/cli.ts" worker ls --json
git rev-parse --path-format=absolute --git-dir --git-common-dir
printenv HC_TERMINAL_ID
hc get "$HC_TERMINAL_ID" --json
```

- `worker ls` exits 2 outside herdr. Refuse: a Lead runs only in a terminal herdr started. Stop.
- `hc get` shows `role` `worker` under `labels`: this session is a Worker, and a Worker starts no other
  session. Refuse, and say the work goes to its Lead through the Brief's Questions line. Stop.
- The two git paths differ in a linked worktree. Refuse: Claude Code isolates a worktree session, so it
  cannot start a Worker in the main checkout. Say to start the Lead as a plain session in the main
  checkout, in herdr. Stop.
- `HC_TERMINAL_ID` is this Lead's terminal, which every Brief names. The list is its Workers so far.

A spec meant to land as one pull request belongs to `implement-spec`, of the engineering skills
(`mattpocock/skills`), not here. After it, the dev runs `/sdlc-pr-ship <n>` and `/sdlc-sweep`. Where this
session has no `implement-spec`, offer the spec whole to one Worker.

## The tickets

Turn the source into tickets, one Worker each:

- **An issue.** Read it with `gh issue view <n> --json number,title,state,labels,subIssues,blockedBy`.
  When it has open sub-issues, as a spec cut by `/to-tickets` of the engineering skills does, each open sub-issue is a ticket, read the
  same way. Otherwise the issue is one ticket.
- **A list of issues.** Each one is read as an issue.
- **A spec in a file.** One ticket: one Worker takes it whole.
- **Split.** `split`, or the dev asks to cut the current work: one ticket a piece, only when each piece is
  its own pull request that merges without the others, or read-only work that writes nothing. When the
  pieces must land in one diff, or edit the same files, refuse the split in one line, say why, and offer
  the whole to one Worker.

Skip a closed ticket, and one whose triage label says it needs a human or more information, such as
`ready-for-human` or `needs-info`, the labels the engineering skills' `triage` sets.

`blockedBy` orders the rest. A ticket whose blockers are all closed is ready now. One blocked by an open
ticket of this set waits in the queue until every blocker is closed. One blocked by an open issue outside
the set is skipped, since nothing here closes it. Tickets with no edge between them run in parallel even
when they touch the same files: the later Worker rebases through `/sdlc-pr-ship`.

When it is unclear what to hand over, ask in plain text and end your turn.

## The plan

Before any Worker starts, show the dev a table, a row a ticket: the ticket, its Worker's name, and `now`,
`queued behind #<n>` or `skipped`, with the reason. One ticket takes a line, not a table. Then go on to
start them: invoking this skill is the dev's go, so the plan asks nothing.

## The Briefs

Read `${CLAUDE_PLUGIN_ROOT}/templates/brief.md` and follow it. The config comes from
`node "${CLAUDE_PLUGIN_ROOT}/dw-sdlc/src/cli.ts" config`. Write a Brief for every ticket marked `now` or
queued, and none for a skipped one. Every Brief this skill writes:

- takes the template's Lead form, naming `HC_TERMINAL_ID` in its Questions and Report lines, and runs
  `dw-sdlc` there as `node "${CLAUDE_PLUGIN_ROOT}/dw-sdlc/src/cli.ts"`;
- in a split, names in Must not the paths the other pieces own;
- for read-only work, says in Must not that it writes no file, and drops the Ship line.

Each Worker gets its own worktree, named after it, so the names differ. Write each Brief to a file outside
the repository, such as `$TMPDIR/<name>.md`.

## Start the Workers

```bash
node "${CLAUDE_PLUGIN_ROOT}/dw-sdlc/src/cli.ts" worker start --brief <file> --name <name> --model <model> --effort <effort> --max-workers <n> --json
```

- Exit 0: started, and the Worker took its Brief.
- Exit 1: started, but the Brief is not confirmed. Run `hc read <address> --lines 60` and tell the dev. Never
  send the Brief again or start the Worker twice.
- Exit 2: nothing started. Say why.

Start one ticket marked `now` first, alone. Exit 0 proves the command, the account, the model and the
effort, so start every other `now` ticket right after it. On exit 1 or 2 start nothing more: the same
fault would reach every Worker.

At most three Workers are in flight. A Worker is in flight from its start until its Recap reports its
end: merged, parked for the dev, or done for read-only work. Its terminal often stays live after that, until
the Sweep, and `worker start` counts live terminals, so pass `--max-workers` as three plus the Workers that
reported their end and are still `live` in `worker ls`. Only the dev's word raises the three. A ticket ready now beyond the three waits in
the queue.

Tell the dev in a few lines who started, on which model and effort, and which tickets wait in the queue
and on what. Then end your turn. Each Worker's report wakes you; do not wait for it.

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
- `wait`, on CI or anything else: a Worker that waits does not wake by itself. Start a timer of the
  `recheckAfter` seconds its report names, 60 when it names none, whose exit wakes you, and end your turn:
  `hc run --bg --name wake-<address> -- sleep <seconds>`. On its exit, remove it with `hc rm wake-<address>`
  and wake the Worker with `hc send <address> "<seconds> s have passed: call the Ship script again"`. The
  Ship script decides again: a run still going is another `wait`, and one stuck past its budget is a
  `park` the Worker reports. When the dev wants the answer sooner, run `hc kill wake-<address>` and
  `hc rm wake-<address>`, and wake the Worker now. When the exit note of a timer you killed arrives, wake no Worker.

When a Recap reports a Worker's end, start what it frees from the queue: each queued ticket whose blockers
have all closed, read once with `gh issue view <n> --json blockedBy`, while fewer than three are in
flight, on the model and effort its Brief names. Tell the dev in one line who started.

The dev's own words come with these: answer them in plain text, then end your turn.

## The rules while Workers are live

- Never open a question dialog: a Lead held by one refuses its Workers' reports. Ask in plain text,
  numbered, and end your turn.
- Write no code and commit nothing. Never merge a pull request: each Worker carries its own through
  `/sdlc-pr-ship`, and `pr.merge` decides.
- Never answer a Worker's question that lies outside its Brief: the decision is the dev's.
- The dev may answer a Worker in its own terminal. Its next Recap says what the dev decided; take that as
  the dev's word.
- `hc wait` only for a short, bounded wait on the dev's word, never past `--timeout 180`. A Worker's wait,
  on CI or anything else, needs none: its timer wakes you.
  Never poll `gh` in a loop; one read to check a claim is fine.
- Never `hc send --force` and never press keys in a Worker's terminal: typing into a blocked one answers
  its dialog.
- Never remove a Worker's terminal or worktree yourself, by `hc kill`, `hc rm` or a worktree removal. The
  Sweep clears what a Worker leaves behind, on the dev's "go", once every Worker has reported.

## The combined Recap

When every Worker has reported its end and the queue is empty, or the dev asks, give one Recap for all of
them. Use the shape of `${CLAUDE_PLUGIN_ROOT}/skills/sdlc-recap/SKILL.md`, its facts from
`node "${CLAUDE_PLUGIN_ROOT}/dw-sdlc/src/cli.ts" recap --json`,
which counts the live Workers. What happened has a row a Worker with its pull request; check every
"merged" or "green" live with `gh`. Waiting on names each Worker still live and what it waits on, and each
ticket still queued and what it waits behind.

Once every Worker has reported its end, the Recap carries the Sweep follow-up that `sdlc-recap` describes:
the Sweep removes landed branches, clean worktrees and finished Workers' terminals.
The dev's "go" runs `/sdlc-sweep`, which stops and removes the terminals of this Lead's Workers whose turn
has ended and clears their worktrees, which lets the Lead close. A Worker still working or blocked stays,
and so does a finished Worker whose worktree the Sweep keeps, such as one with uncommitted files. After the
Sweep, report what it kept, and name each Worker that stays under Waiting on.

## Naming the Lead

Only when the dev asks, name this session `lead-<topic>`: find the tab holding this terminal in
`herdr-app ls`, then run `herdr-app do tab.rename --id <tab> --name lead-<topic>` and
`hc label <this terminal> role=lead name=lead-<topic>`. Workers are named `worker-<issue>-<slug>`.
