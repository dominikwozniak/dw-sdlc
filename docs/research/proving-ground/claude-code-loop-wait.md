# How an agent waits on a PR inside Claude Code

Read on 2026-10-30 from the Claude Code docs under `https://code.claude.com/docs/en/`
(`tools-reference`, `env-vars`, `interactive-mode`, `scheduled-tasks`, `hooks`, `goal`, `headless`,
`github-actions`, `routines`, `channels`), from `gh pr checks --help` (gh 2.97.0), and from the
references `pstack` and `kcd-skills` at their synced refs. Research ticket #149 asked; the design
ticket #143 decides. Two shapes are on the table for `dw-sdlc pr`: a **tick** (one call, one
decision, the agent calls again) and a **run** (one call loops and waits on CI inside the script).

## The options

| option                                                        | how it waits                                                   | limit                                                                             | fits                          |
| ------------------------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------- |
| Foreground Bash call (`gh pr checks --watch`, a run script)   | Holds the turn until the command exits                         | 2 min default, 10 min ceiling; at the ceiling the command moves to the background | run, short waits              |
| Background Bash call (`run_in_background`, Ctrl+B, auto-move) | Command runs on; Claude works or idles; its exit starts a turn | No limit in a local session; 30 min default, 2 h max unattended; 10 min in `-p`   | both                          |
| Monitor tool                                                  | A background script streams lines; each line wakes Claude      | 5 min default, 30 min max, 10 min in `-p`; one notice at the deadline             | tick                          |
| `/loop <interval> <prompt>`                                   | A cron task fires the prompt between turns while idle          | 1 min floor, jitter, 7-day expiry, 50 tasks per session                           | tick                          |
| `/loop <prompt>` self-paced                                   | Claude picks the next wake-up with `ScheduleWakeup`            | 1 min to 1 h per step; one fallback wake-up, then the loop ends                   | both                          |
| Stop hook, `/goal`                                            | Blocks the stop; the next turn starts at once                  | No delay; 8 continuations in a row, then the turn ends                            | neither: a re-arm, not a wait |
| Notification hook                                             | Side effects only                                              | Cannot inject a prompt or block                                                   | neither                       |
| `claude -p` from cron or GitHub Actions                       | One process per tick; `--resume` keeps the thread              | Session-less; cloud scheduled tasks start at 1 h; Actions cron is "fog" (#141)    | tick                          |
| Channels (research preview)                                   | CI pushes an event into the open session                       | Needs a channel plugin and `--channels`; session must be open                     | both, later                   |

## Findings

### Foreground Bash call

- The Bash tool runs each command under a timeout Claude manages: "`BASH_DEFAULT_TIMEOUT_MS` — the
  default when Claude passes no timeout; two minutes out of the box", "`BASH_MAX_TIMEOUT_MS` — ...
  the effective ceiling is the larger of the two, ten minutes out of the box"
  (`tools-reference#timeout-and-output-limits`; the same figures in `env-vars`).
- At the timeout the command is not killed: "When a foreground command reaches its timeout without
  finishing, Claude Code moves it to the background instead of stopping it, unless the command starts
  with `sleep`." The result reads `Command did not complete within its 120s timeout and was moved to
  the background`, then the task id and the output file path
  (`tools-reference#foreground-commands-that-move-to-the-background`). With
  `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1` or `--bare`, it stops instead.
- `gh pr checks --watch` "Watch checks until they finish", `--interval` default 10 s, `--fail-fast`;
  without `--watch` exit code 8 means "Checks pending" (`gh pr checks --help`). So a blocking watch
  fits only when CI ends inside ten minutes; a longer one turns into a background task anyway.

### Background Bash call

- "Claude can set `run_in_background: true` to start the command as a background task and continue
  working while it runs. List and stop background tasks with `/tasks`"
  (`tools-reference#background-commands`). Ctrl+B moves a running command there
  (`interactive-mode#background-bash-commands`).
- Local sessions have no cap: "A local session you work in from a terminal, the desktop app, or the
  VS Code extension has no time limit on background commands." Unattended ones do: "A command that
  Claude starts in the background gets 30 minutes, or the `timeout` Claude passes with
  `run_in_background`, up to a maximum of 2 hours"; in a `-p` run with a text prompt "both defaults
  are 10 minutes" (`tools-reference#time-limit-for-background-commands`). At the limit Claude Code
  stops it "and tells Claude why".
- How the agent learns of the exit: in `-p`, "Claude then takes one more turn with the outcome"
  (`headless#background-tasks-at-exit`); `/goal` says "When the background work finishes, Claude Code
  delivers the result to Claude as a new turn" (`goal#background-work-defers-evaluation`). The Bash
  tool's own description in this session says the same: it "re-invokes you when it exits". Not
  verified: a docs sentence for the interactive case.
- Output is streamed to a file, killed past 5 GB; `--resume` does not restart background commands
  (`scheduled-tasks#limitations`).

### Monitor tool

- "For most watches, Claude writes a small script, runs it in the background, and receives each
  output line as it arrives." Listed use: "Poll a PR or CI job and report when its status changes".
  "Every watch Claude starts has a deadline: 5 minutes by default, at most 30 minutes, and at most 10
  minutes in a non-interactive run"; "At the deadline the watch ends. Claude gets one notice, so it
  can start the watch again" (`tools-reference#monitor-tool`).
- The `/loop` docs prefer it to polling: "Monitor runs a background script and streams each output
  line back, which avoids polling altogether and is often more token-efficient"
  (`scheduled-tasks#let-claude-choose-the-interval`).

### `/loop`, fixed interval

- `/loop 5m check the deploy` creates a cron task (`CronCreate`); units `s m h d`, seconds round up
  to a minute, odd intervals round to a clean cron step (`scheduled-tasks#run-on-a-fixed-interval`).
- "A scheduled prompt fires between your turns, not while Claude is mid-response. If Claude is busy
  when a task comes due, the prompt waits until the current turn ends." Jitter: `/loop 5m` fires at
  4 min 45 s; every 10 min runs 0 to 5 min late; hourly 0 to 30 min late. "No catch-up for missed
  fires." Recurring tasks expire after 7 days; a session holds 50 tasks. Minimum interval 1 minute
  (`scheduled-tasks#how-session-scoped-scheduled-tasks-run`, `#jitter`, `#limitations`).
- Stopping: "ask Claude to cancel it ... `Esc` and `Ctrl+C` don't stop it" (`#stop-a-loop`). Tasks
  are restored on `--resume`, minus expired ones. `CLAUDE_CODE_DISABLE_CRON=1` turns it all off.

### `/loop`, self-paced ("dynamic")

- "When you omit the interval, Claude chooses one dynamically ... After each iteration it picks a
  delay between one minute and one hour based on what it observed ... The chosen delay and the reason
  for it are printed at the end of each iteration" (`scheduled-tasks#let-claude-choose-the-interval`).
- The tool behind it: "`ScheduleWakeup` Reschedules the next iteration of a self-paced `/loop`.
  Claude calls this at the end of each iteration ... To end the loop instead, Claude calls it with
  `stop: true`" (`tools-reference`, tool table). "If an iteration ends without either rescheduling or
  stopping, Claude Code schedules one fallback wakeup about 20 minutes later and ends the loop when
  that iteration doesn't reschedule either" (`#stop-a-loop`). The user stops it with `Esc` while it
  waits. It is not restored on `--resume`.
- pstack's babysit is the model: "Run `drive` and `background` under `/loop` in dynamic mode. Rearm
  the watcher after every push wave and every verdict you act on. Watcher output drives wakeups.
  Never add a second sleep loop." (`references/pstack/pstack/skills/poteto-mode/playbooks/babysit.md:12`).
  Its watcher, `scripts/watch-pr`, polls `gh` every 60 s with no deadline unless `--timeout` is set
  (`scripts/watch-pr/cli.ts:110-122`), backs off on query errors to at most 300 s
  (`scripts/watch-pr/policy.ts:267-269`), streams NDJSON progress verdicts and exits on a terminal
  one: `READY` 0, `BLOCKER` 2 to 7, `TIMEOUT` 5 (`scripts/watch-pr/types.ts:306-365`). The playbook
  does not say whether it runs in the foreground. Note: pstack targets Cursor's `/loop`
  (`playbooks/autonomous-run.md:6`); Claude Code's self-paced `/loop` is the analogue, not the same.

### Stop hook, `/goal`

- Stop "Runs when the main Claude Code agent has finished responding." Its input carries
  `stop_hook_active`, `background_tasks` and `session_crons`, which "let hooks distinguish 'session
  is done' from 'session is paused waiting for background work to wake it back up'". `decision:
  "block"` with `reason` keeps Claude working. The guard: "after stop hooks have continued the turn
  eight times in a row, Claude Code overrides the next block and ends the turn. The count ... resets
  each time Claude calls a tool" (`hooks#stop-input`, `#stop-decision-control`).
- `/goal` "is a wrapper around a session-scoped prompt-based Stop hook"; "If a subagent or a
  background shell command is still running when a turn ends, Claude Code skips the evaluation"; a
  check-in comes after 30 min of waiting (`goal#how-evaluation-works`,
  `#background-work-defers-evaluation`). It works in `-p`.
- Neither adds a delay. A blocked stop re-runs the next turn at once, so a pending CI would be polled
  turn after turn until the cap ends it. They re-arm; they do not wait.

### Notification hook, async hooks

- "Notification hooks can't block or modify notifications. Claude Code discards their `systemMessage`
  and `continue` fields"; `idle_prompt` fires when "Claude finished responding about 60 seconds ago
  and you haven't typed since" (`hooks#notification`). It can page a human, not the agent.
- Async hooks: "Hook output is delivered on the next conversation turn. If the session is idle, the
  response waits until the next user interaction. Exception: an `asyncRewake` hook that exits with
  code 2 wakes Claude immediately even when the session is idle" (`hooks`, async section). Not read
  in full; a hook that watches CI and exits 2 is a possible wake-up, unverified.

### Headless `claude -p`, cron, GitHub Actions

- `claude -p "<prompt>"` runs one turn set and exits 0 or non-zero; `--continue` or
  `--resume <session_id>` keeps the thread, `--output-format json` returns `session_id`; `--bare` is
  "the recommended mode for scripted and SDK calls"; `--permission-prompts none` for unattended runs
  (`headless#basic-usage`, `#continue-conversations`, `#turn-off-permission-prompts-in-unattended-runs`).
- After the result a `-p` run "can stay open to wait for background work", capped at 10 min by
  default (`CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS`), and waits for pending self-paced `/loop` wakeups
  "even past the 10-minute cap" (`headless#background-tasks-at-exit`).
- GitHub Actions: with a `prompt` input the action "runs in automation mode on any GitHub event,
  including a cron schedule"; `claude_args` passes `--max-turns`; "GitHub runs scheduled workflows
  only from the default branch" (`github-actions#run-on-a-schedule`). Cloud scheduled tasks run on a
  fresh clone, minimum interval 1 hour, 100 scheduled runs per hour per account
  (`routines`, `scheduled-tasks#compare-scheduling-options`). The map keeps Actions on a schedule
  in the fog (#141).

### kcd's `--watch`: the sleep inside the script

- `ship-pr.mjs` exits "0 done/parked, 10 needs agent action, 20 waiting, 30 needs PR state from the
  agent" (`references/kcd-skills/skills/autopilot/scripts/ship-pr.mjs:9-10`). With `--watch` it
  loops `for (let tick = 0; tick < 60; tick++)` (line 699); on `wait` or `wait-for-review` it
  `await new Promise((resolve) => setTimeout(resolve, options.interval * 1000))` and continues
  (lines 725-729), default interval 60 s (line 347); `mark-ready` and `merge` run `gh` and loop on
  without sleeping (lines 714-718); after 60 ticks it returns 20 (lines 731, 735). `--watch` refuses
  `--input` (lines 401-403). The kcd skill itself ticks: "re-ticking until `exit.done`"
  (`references/kcd-skills/skills/ship-pr/SKILL.md:20`).
- Cost inside a session: a one-hour `--watch` holds the turn for the 2 or 10 min timeout, then is
  moved to the background; locally it runs on with no cap, in `-p` it is stopped at 10 min and in CI
  or a cloud session at 30 min, 2 h at most. The script never sees the move; its exit code arrives
  as a new turn. Every minute asleep inside a foreground call is a minute the agent cannot act.

### Channels

- "A channel is an MCP server that pushes events into your running Claude Code session"; the docs
  name a "Webhook receiver: a webhook from CI" as a use. Research preview; "You install a channel as
  a plugin" and opt in per session with `--channels` (`channels`). The `/loop` page points here for
  "Reacting to events as they happen instead of polling". Push, not poll; out of reach for now.

## What this means for the `pr` subcommand

No decision here; the design ticket decides. The facts constrain it so:

- A **tick** is short and never sleeps. The wait belongs to the session: self-paced `/loop` (the
  skill's iteration ends with "waiting, next in N min" and `ScheduleWakeup` carries it), or a
  background `gh pr checks --watch` or Monitor that wakes the agent when CI ends. Both are the pstack
  shape with Claude Code's own primitives. A distinct "waiting" exit code (kcd 20, `gh` 8) lets the
  skill route without reading prose.
- A **run** owns the wait, so its length is bounded by the host: under 10 min it is one foreground
  call; longer, it is a background task that re-invokes the agent on exit, with no cap locally and a
  10 min to 2 h cap unattended. A run therefore needs its own ceiling (kcd: 60 ticks) and the same
  "still waiting" exit code, and the agent still needs an outer re-arm.
- Neither shape gets a wait from hooks. Stop and `/goal` re-arm the next turn with no delay and an
  8-turn cap; Notification cannot reach the agent. The one hook-shaped wake-up, `asyncRewake`, is
  unverified.
- Headless `claude -p --resume` from cron or Actions is a tick per process. It fits the tick shape
  only, and the map keeps it in the fog.
- `/loop` fires only while the session is open and idle, with jitter and a 7-day expiry; a run that
  is mid-turn when the fire comes due delays it. Whatever shape wins, the skill must say how the
  loop ends: `ScheduleWakeup stop: true`, a cancelled cron, or the script's terminal exit code.

Not verified: a docs sentence on how an interactive session is told that a background command
exited (taken from the Bash tool's own description); the `asyncRewake` section of `hooks`; whether
pstack runs `watch-pr` in the foreground or the background.
