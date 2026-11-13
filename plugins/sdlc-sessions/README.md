# sdlc-sessions

The session skills of [dw-sdlc](../../README.md), beside the [`sdlc`](../sdlc/README.md) plugin that
guards a session. They tell you where a session stands, write the start of the next one, and let one
session hand tickets to others running in parallel:

- `/sdlc-recap` writes a Recap: where a session stands, in one fixed shape, and whether it can close.
- `/sdlc-brief` writes a Brief: the fixed-shape first message of a Worker, a Claude Code session that
  works on one ticket in a worktree of its own.
- `/sdlc-delegate` makes the session a Lead, a session that starts Workers in herdr terminals and gathers
  their Recaps. herdr is a terminal manager whose `hc` command starts and reads terminals.

A Brief starts its Worker with `/implement`, and a Lead reads the tickets `/to-tickets` cuts: both are
[Engineering skills](https://github.com/mattpocock/skills), which this plugin runs beside and does not
ship. The decision to ship it apart from `sdlc` is
[ADR 0014](../../docs/adr/0014-session-helpers-ship-as-sdlc-sessions-beside-sdlc.md).

## Install

The [root README](../../README.md#install) installs it. It lists `sdlc` under `dependencies`, so it brings
the guards too. `/sdlc-recap` and `/sdlc-brief` run anywhere; `dw-sdlc recap` needs an authenticated `gh`
for the pull request and the next session, and `/sdlc-delegate` needs herdr's `hc` on the agent's PATH.
`/sdlc-doctor` reports the plugin on its `sessions` line, a drift between its copy of the `dw-sdlc`
package and the one `sdlc` runs included, and herdr on its `hc` line.

## What it carries

| part             | kind     | runs                                                                        | section                 |
| ---------------- | -------- | --------------------------------------------------------------------------- | ----------------------- |
| `/sdlc-recap`    | skill    | you type it, or a Brief tells a Worker to end with it                       | [The Recap](#the-recap) |
| `/sdlc-brief`    | skill    | you type it                                                                 | [The Brief](#the-brief) |
| `/sdlc-delegate` | skill    | you type it or ask in your words; offered in one line after tickets are cut | [The Lead](#the-lead)   |
| `brief.md`       | template | read by every skill that writes a Brief                                     | [The Brief](#the-brief) |

## Layout

- `.claude-plugin/plugin.json` — the manifest. Its version and its entry in the marketplace bump together.
- `dw-sdlc` — a link to `packages/dw-sdlc`, which `claude plugin install` copies as a real directory.
- `skills/sdlc-recap/`, `skills/sdlc-brief/`, `skills/sdlc-delegate/` — the skills, each with its evals
  under `evals/`.
- `templates/brief.md` — the one Brief template, read by every skill that writes a Brief.
- `test/manifest.test.ts` — the manifest, the link, each skill's name and description, the template, the marketplace.

## The Recap

`/sdlc-recap` works in any session. Where `dw-sdlc recap` cannot run, the Recap leaves out the close line
and says the state is unverified. Its first line is a verdict in the words of the Ship script's
Actions, the one thing a pull request needs next: `done`, `act` (the agent's turn), `wait` or `park` (the
dev's), and one sentence. Then come these sections, each only when it has
content: what happened, as a table of outcomes with links; the decisions taken without the dev; numbered
questions, each with a recommendation; what waits on whom; the close line; and the follow-ups.

Each follow-up is "this session" or "a new session", with one recommended disposition: `now`, `issue`,
`worker` or `drop`, the lightest that closes it, and `now` by default when it fits the session. The dev's
one "go" carries out every recommendation, "go, but 2 issue" changes one, and nothing runs before it. The
skill starts no session, so "go" hands a `worker` to the dev as its description, for them to start.

In the main checkout the Recap also reads `dw-sdlc sweep --dry-run --json`. When a Sweep would remove
anything, it lists a Sweep as a follow-up `now`, counting the branches, worktrees and terminals, so the dev's
"go" runs `/sdlc-sweep`. A Recap in a linked worktree lists none, since the Sweep refuses there.

When the session can close, or its verdict is `done` or `park`, the Recap ends with the next session: one
issue of `next` the skill picks, why in one line, and the start line `/sdlc-delegate #<n>`. The dev's "go"
starts it as a Lead, as [The next session](#the-next-session) says.

The Recap is written in the conversation's language. It links pull requests and issues instead of
listing files, and it checks every "merged" or "green" live with `gh`.

The model may invoke the skill, because a Brief can tell a Worker to end with a Recap. Its description
limits that to the dev typing `/sdlc-recap` and a Brief's instruction, so "co dalej?" gets a plain answer.

## `dw-sdlc recap`

The facts a Recap rests on, tested like the Ship script. Read-only: `dw-sdlc recap [--json]` reports:

- the branch and the head;
- the uncommitted changes, untracked files among them;
- the upstream and the unpushed commits: past the upstream or, without one, on no remote, and none when
  an open or merged pull request holds the head;
- the operation git has paused: a rebase, `git am`, merge, cherry-pick, revert or bisect;
- the branch's pull request and the Action the Ship script's decision gives it, read and never performed;
- whether the session sits in a linked worktree;
- in herdr, the live Workers the session started as a Lead, each with its status and the folder it works in;
- under `next`, the candidates for the next session: the open issues labelled `ready-for-agent` with no
  assignee and no open blocker, of the 100 opened first. A repository without that label gets no
  candidate. The open sub-issues of an issue the branch's pull
  request closes come first, then the rest, each in issue order, and no issue it closes is a candidate. One GraphQL
  request reads them and what the pull request closes. `next` is null where `gh` is not asked, and when
  the read fails: a warning names why, and the close verdict stands, since no candidate keeps a session open.

Exit 0 means the session can be closed, 1 that it cannot, and 2 that the command cannot run. Under
`close`, the document gives the `verdict`, the `line` a Recap quotes and every reason, each with
`blocks`.

| reason              | blocks | when                                                                                                            |
| ------------------- | ------ | --------------------------------------------------------------------------------------------------------------- |
| `paused`            | yes    | a rebase, `git am`, merge, cherry-pick, revert or bisect is paused, however clean the tree reads                |
| `uncommitted`       | yes    | a change git would commit or could track                                                                        |
| `unpushed`          | yes    | commits past the upstream                                                                                       |
| `no-upstream`       | yes    | commits on no remote, on a branch with no upstream or a detached HEAD                                           |
| `open-pull-request` | yes    | the pull request is open, whatever its Action                                                                   |
| `orphaned`          | yes    | commits of a closed pull request left the branch, as by a reset, and no remote branch holds them                |
| `no-pull-request`   | yes    | commits on top of the base, no pull request holds the head, and the branch is neither the default nor protected |
| `workers`           | yes    | a Worker this session started as a Lead is live, whatever its status                                            |
| `merged`            | no     | the pull request merged                                                                                         |
| `closed`            | no     | the pull request closed without merging; commits only it holds read as `no-upstream`                            |
| `worktree`          | no     | a linked worktree, left to remove                                                                               |
| `clean`             | no     | no reason blocks                                                                                                |

A live Worker blocks even when its turn has ended: herdr's `done` is no Recap, and a Lead that closes leaves
its Workers' reports no one to reach. Outside herdr the command asks `hc` nothing and `workers` is null. In
herdr an `hc` that fails exits 2, since a Worker it cannot see may be live.

An open pull request blocks even when it is parked on the dev: the session's work has not merged, and a
wrong "no" costs less than a wrong "yes". A linked worktree does not block, since the session cannot
remove the directory it runs in. A branch with no upstream and no commit of its own has nothing to lose,
so it can close. A commit an open or merged pull request holds counts as pushed, so a branch whose pull
request merged and whose remote ref is gone still closes. A pull request closed without merging merges
nothing, and a detached HEAD
names no pull request, so there a commit counts as pushed only on a remote branch. The command asks the
remote which branches still stand, because a deleted branch stays in the local tracking refs until a
fetch. An upstream that is a local branch counts as none. A branch `guardrails.protectedBranches` names
takes changes through pull requests, so it needs none of its own; a long-lived branch the config does not
name reads as `no-pull-request`.

The command writes nothing, so it does not fetch, and some states read as yes until a fetch shows them:
another remote branch force-pushed off the head, and an upstream deleted or force-pushed on a branch that
needs no pull request. Run `git fetch --prune` first to be exact. Treating every moved branch as stale
would answer no each time the base moves on. A remote out of reach counts as holding nothing, so it can
answer no, and never yes.

The branch's pull request comes from `gh pr view`, which looks it up by the push target of the branch, else
by its local name. A branch pushed under another name has neither, so when `gh` finds nothing the command
asks again by the head branch the upstream names, read from `branch.<name>.merge`, which survives the
remote deleting the branch. That pull request counts only when its commits hold the local `HEAD`: a branch
started from another tracks it until its first push, and the parent's pull request is never read as this
branch's. The limit follows: a branch pushed under another name, with commits its pull request lacks, gets
no pull request. Those commits read as `unpushed` and `no-pull-request`, and both block. A branch with no
upstream, one named as the branch itself and one that is a local branch make no second lookup.

A detached HEAD or a repository with no remote asks `gh` nothing. `askedGh` is false, the `pull request`
line reads `gh not asked`, and the `clean` reason says so rather
than claim nothing is open. Elsewhere the command needs an authenticated `gh` and a remote it can read: a
remote on another host exits 2. It counts from the pull request's base, or from the default branch when
there is no pull request.

## The next session

The script reads the candidates and the skill picks one, since only the session knows the topic it worked
on. A Recap a Brief asks for leaves the section out: a Worker's Lead names what comes next. Nothing starts
before the dev's "go", and "go, but #<m>" starts another candidate. "go" runs the follow-ups first, then:

```bash
dw-sdlc lead start --name lead-<n>-<slug> --prompt "/sdlc-delegate #<n>" [--wait <seconds>] [--json]
```

It runs `hc run` in the background with the name, the label `role=lead`, the caller's `herdr.space`,
`--outlive-parent` and the main checkout as the folder. The command is `worker.command` of the config
without `--dangerously-skip-permissions`, which Claude Code's auto mode refuses for a session one session
starts, and without `--worktree` or `-w` and its name, since a Lead works in the main checkout. The first
message follows it. Then it names the new tab and reads the terminal back as `worker start` does, exit 1
when the Lead shows no work, and it never sends the first message twice. It refuses outside herdr and in a
linked worktree, as `/sdlc-delegate` does. A Lead's terminal is no Worker's, so the closing session's
`recap` and Sweep leave it alone.

## The Brief

`/sdlc-brief` takes an issue, a spec, a Recap's follow-up or an idea from the conversation and gives the
start of a Worker session. Only the dev invokes it, it works without herdr, and it starts nothing itself.

`templates/brief.md` holds what every Brief shares: its form, its rules, the Worker's name, the routing of
model and effort, and the start line. `/sdlc-recap` reads it too, for a follow-up that goes out as `issue`
or `worker`.

A Brief is in English. It points at its source and never retells it, and what only the conversation holds
counts as no source, so an idea's Goal says all it needs to. The template lists its fields, and the Worker
is named `worker-<issue>-<slug>`.

The Brief's kind sets the model and effort, never the size of the change: the template's table routes a clear
spec to the config's `worker` values and work that needs decisions to a stronger model, with the dev's word
over both.

A Brief comes with three ways out, the lightest that fits recommended. The start line holds `worker.command`
with `--worktree`, `--model` and `--effort`, and the Brief as the first message, for the dev to paste into a
new terminal. A new issue takes the Brief as its body and starts later with `/implement #N`, the
Engineering skills' implement skill. A Lead, in herdr,
starts the Worker. A Brief for a Lead names the Lead's terminal in its Questions and Report lines, because a
Worker that ends its turn looks finished to its Lead.

A Worker carries its pull request through [`/sdlc-pr-ship`](../sdlc/README.md#shipping-a-pull-request),
which it may start because a Brief tells it to; `pr.merge` decides whether it ends at merged or parked for
the dev.

## The Lead

`/sdlc-delegate` makes the session a Lead, and is how a session starts a Worker. The dev types it, or asks
in their own words to hand work to Workers; when a conversation has just published tickets, such as a spec
`/to-tickets` cut, the model offers it in one line and waits for the dev's go. It refuses outside herdr, in
a Worker, whose terminal carries the label `role=worker`, and in a linked worktree, where Claude Code's
isolation keeps it from starting a Worker in the main checkout: there the Lead starts as a plain session in
the main checkout.

The Lead turns its source into tickets, one Worker each: an issue, or each open sub-issue of one; a list of
issues; a spec in a file, whole; or a split of the current work, only when each piece is its own pull
request or read-only work, since pieces that must land in one diff stay with one Worker. It skips closed
tickets and those a triage label keeps for a human. `blockedBy` orders the rest: a ticket blocked by an
open one of the set waits in the queue, and tickets with no edge between them run in parallel. The dev sees
the plan as a table, and the Workers start without a second ask.

Each Brief comes from the template in its Lead form, naming the Lead's terminal, and `dw-sdlc worker start`
starts its Worker in a worktree of its own. The first Worker starts alone; once its Brief is delivered, the
rest start at once. At most three are in flight, from their start until their Recap reports their end. A
Worker's terminal often stays live until the Sweep, so the Lead passes `--max-workers` as three plus the
ended Workers still live. Each end frees the queue: the Lead starts each queued ticket whose blockers have all closed.

After starting Workers the Lead ends its turn, so the dev can talk to it while they work. A Worker's report
wakes it, and on every wake it runs `dw-sdlc worker ls` and takes a `blocked` Worker to the dev. It waits
with `hc wait` only for a short, bounded wait on the dev's word, of 180 seconds or less, and never
polls `gh`. A Worker that answers `wait` does not wake by itself. The Lead starts a timer in herdr of the
wait's `recheckAfter`, whose exit wakes it, ends its turn, and on the timer's exit wakes the Worker, which
asks the Ship script again: a run still going is another `wait`, one stuck past its budget a `park`.

While it has live Workers, the Lead:

- opens no question dialog, which would make `hc send` refuse its Workers' reports, and asks in plain text;
- writes no code and never merges: each Worker carries its own pull request through `/sdlc-pr-ship`;
- answers no Worker's question outside the Brief, and relays a parked question to the dev;
- takes the dev's answer given in a Worker's own terminal from that Worker's next Recap;
- removes no Worker's terminal or worktree itself: the Sweep does, on the dev's "go".

When the Workers have reported their end and the queue is empty, or the dev asks, it gives one combined Recap in the shape of
`/sdlc-recap`, whose close line counts the live Workers. Once every Worker has reported, the combined
Recap carries the Sweep follow-up, so the dev's "go" runs `/sdlc-sweep`, which removes the Workers'
terminals and worktrees and lets the Lead close. On the dev's ask it renames its herdr tab to
`lead-<topic>`, through `herdr-app`, and labels its terminal `role=lead` and `name=lead-<topic>`.

## Config keys it reads

| key                             | read by                                                               |
| ------------------------------- | --------------------------------------------------------------------- |
| `worker.command`                | a Brief's start line, `dw-sdlc worker start` and `dw-sdlc lead start` |
| `worker.model`, `worker.effort` | the model and effort a Brief routes a clear spec to                   |
| `guardrails.protectedBranches`  | `dw-sdlc recap`, for a branch that needs no pull request of its own   |
| `pr.merge`                      | whether a Worker's pull request ends merged or parked for the dev     |

Each skill's evals, outside `pnpm test` and the Gate, are in [Evals](../../docs/contributing/evals.md).
