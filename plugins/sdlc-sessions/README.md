# sdlc-sessions

The skills that run a Claude Code session, beside the [`sdlc`](../sdlc/README.md) plugin that keeps it
safe. It carries `/sdlc-recap`, which tells a dev who did not follow a session where it stands,
`/sdlc-brief`, which writes the start of a Worker session, and `/sdlc-delegate`, which makes a session a
Lead that runs Workers in herdr. The decision to ship it apart is
[ADR 0014](../../docs/adr/0014-session-helpers-ship-as-sdlc-sessions-beside-sdlc.md).

## Install

```bash
claude plugin install sdlc-sessions@dw-sdlc --scope user
```

It comes from the same marketplace as `sdlc` and lists `sdlc` under `dependencies`, so installing it
brings the guards too. `/sdlc-doctor` reports it on its `sessions` line, along with a drift between its
copy of the `dw-sdlc` package and the one `sdlc` runs, and on its `hc` line whether herdr's `hc` is on the
agent's PATH, which `/sdlc-delegate` needs: INFO when it is not, since a machine may go without herdr.

## Layout

- `.claude-plugin/plugin.json` — the manifest. Its version and its entry in the marketplace bump together.
- `dw-sdlc` — a link to `packages/dw-sdlc`, which `claude plugin install` copies as a real directory.
- `skills/sdlc-recap/`, `skills/sdlc-brief/`, `skills/sdlc-delegate/` — the skills, each with its evals
  under `evals/`.
- `templates/brief.md` — the one Brief template, read by every skill that writes a Brief.
- `test/manifest.test.ts` — the manifest, the link, each skill's name and description, the template, the marketplace.

## The Recap

`/sdlc-recap` works in any session. Where `dw-sdlc recap` cannot run, the Recap leaves out the close line
and says the state is unverified. Its first line is a verdict in the Action words,
`done`, `act`, `wait` or `park`, and one sentence. Then come these sections, each only when it has
content: what happened, as a table of outcomes with links; the decisions taken without the dev; numbered
questions, each with a recommendation; what waits on whom; the close line; and the follow-ups.

Each follow-up is "this session" or "a new session", with one recommended disposition: `now`, `issue`,
`worker` or `drop`, the lightest that closes it, and `now` by default when it fits the session. The dev's
one "go" carries out every recommendation, "go, but 2 issue" changes one, and nothing runs before it. The
skill starts no session, so "go" hands a `worker` to the dev as its description, for them to start.

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
- in herdr, the live Workers the session started as a Lead, each with its status and the folder it works in.

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

A detached HEAD or a repository with no remote asks `gh` nothing. `askedGh` is false, the `pull request`
line reads `gh not asked`, and the `clean` reason says so rather
than claim nothing is open. Elsewhere the command needs an authenticated `gh` and a remote it can read: a
remote on another host exits 2. It counts from the pull request's base, or from the default branch when
there is no pull request.

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
new terminal. A new issue takes the Brief as its body and starts later with `/implement #N`. A Lead, in herdr,
starts the Worker. A Brief for a Lead names the Lead's terminal in its Questions and Report lines, because a
Worker that ends its turn looks finished to its Lead.

A Worker carries its pull request through `/sdlc-pr-ship`, which it may start because a Brief tells it to;
`pr.merge` decides whether it ends at merged or parked for the dev.

## The Lead

`/sdlc-delegate` makes the session a Lead. Only the dev invokes it. It refuses outside herdr, and in a
linked worktree, where Claude Code's isolation keeps it from starting a Worker in the main checkout: there
the Lead starts as a plain session in the main checkout.

A hand-off gives one Worker a whole issue or spec. A split cuts the current work into Briefs, only when each
piece is its own pull request or read-only work; pieces that must land in one diff stay with one Worker.
Each Brief comes from the template in its Lead form, naming the Lead's terminal, and `dw-sdlc worker start`
starts its Worker in a worktree of its own. The first Worker a Lead starts is carried through before any
other starts, from a split or a later hand-off, and at most three are live.

After starting Workers the Lead ends its turn, so the dev can talk to it while they work. A Worker's report
wakes it, and on every wake it runs `dw-sdlc worker ls` and takes a `blocked` Worker to the dev. It waits
with `hc wait` only for a short, bounded wait, a CI run or the dev's word, of 180 seconds or less, and never
polls `gh`. A Worker that answers `wait` does not wake by itself. The Lead starts a watcher in herdr whose
exit wakes it, `gh pr checks --watch` for CI or a timer of the wait's `recheckAfter`, ends its turn, and on
the watcher's exit wakes the Worker.

While it has live Workers, the Lead:

- opens no question dialog, which would make `hc send` refuse its Workers' reports, and asks in plain text;
- writes no code and never merges: each Worker carries its own pull request through `/sdlc-pr-ship`;
- answers no Worker's question outside the Brief, and relays a parked question to the dev;
- takes the dev's answer given in a Worker's own terminal from that Worker's next Recap;
- leaves the Workers' terminals and worktrees for the dev to remove.

When the Workers have reported their end, or the dev asks, it gives one combined Recap in the shape of
`/sdlc-recap`, whose close line counts the live Workers. On the dev's ask it renames its herdr tab to
`lead-<topic>`, through `herdr-app`, and labels its terminal `role=lead` and `name=lead-<topic>`.

## Evals

Each skill's evals run through `/skill-creator`, outside `pnpm test` and the Gate, when the skill changes.
The evals of `sdlc-recap` hold the Recap's shape and a follow-up going out as a Brief, and `evals/trigger.json`
its trigger: it fires on `/sdlc-recap` and on a Brief's instruction, not on "co dalej?". Run the trigger set
with the plugin loaded through `--plugin-dir`, since a typed `/sdlc-recap` resolves only to the real skill.
The evals of `sdlc-brief` hold the Brief's shape and its routing of model and effort, and those of
`sdlc-delegate` the Lead's rules: it ends its turn after starting Workers, asks in plain text, refuses a
split whose pieces must merge into one diff, never merges, and refuses outside herdr and in a linked
worktree. Only the dev invokes either, so neither has a trigger set.
