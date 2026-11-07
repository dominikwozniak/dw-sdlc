# sdlc-sessions

The skills that run a Claude Code session, beside the [`sdlc`](../sdlc/README.md) plugin that keeps it
safe. It carries `/sdlc-recap`, which tells a dev who did not follow a session where it stands, and
`/sdlc-brief`, which writes the start of a Worker session. The decision to ship it apart is
[ADR 0014](../../docs/adr/0014-session-helpers-ship-as-sdlc-sessions-beside-sdlc.md).

## Install

```bash
claude plugin install sdlc-sessions@dw-sdlc --scope user
```

It comes from the same marketplace as `sdlc` and lists `sdlc` under `dependencies`, so installing it
brings the guards too. `/sdlc-doctor` reports it on its `sessions` line, along with a drift between its
copy of the `dw-sdlc` package and the one `sdlc` runs.

## Layout

- `.claude-plugin/plugin.json` — the manifest. Its version and its entry in the marketplace bump together.
- `dw-sdlc` — a link to `packages/dw-sdlc`, which `claude plugin install` copies as a real directory.
- `skills/sdlc-recap/`, `skills/sdlc-brief/` — the skills, each with its evals under `evals/`.
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
- whether the session sits in a linked worktree.

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
| `merged`            | no     | the pull request merged                                                                                         |
| `closed`            | no     | the pull request closed without merging; commits only it holds read as `no-upstream`                            |
| `worktree`          | no     | a linked worktree, left to remove                                                                               |
| `clean`             | no     | no reason blocks                                                                                                |

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
counts as no source, so an idea's Goal says all it needs to. Its fields are the kickoff line, the goal, the
source and the command that reads it, "you are the Worker: do it yourself, start no other session", what it
may write, what it must not do, the proof, the way to ship, what to do with a question, the report
instruction, and the model and effort with the reason. The Worker is named `worker-<issue>-<slug>`.

The Brief's kind sets the model and effort, never the size of the change: the template's table routes a clear
spec to the config's `worker` values and work that needs decisions to a stronger model, with the dev's word
over both.

A Brief comes with three ways out, the lightest that fits recommended. The start line holds `worker.command`
with `--worktree`, `--model` and `--effort`, and the Brief as the first message, for the dev to paste into a
new terminal. A new issue takes the Brief as its body and starts later with `/implement #N`. A Lead, in herdr,
starts the Worker and names its own terminal in the Questions and Report lines, because a Worker that ends its
turn looks finished to its Lead.

A Worker carries its pull request through `/sdlc-pr-ship`, which it may start because a Brief tells it to;
`pr.merge` decides whether it ends at merged or parked for the dev.

## Evals

Each skill's evals run through `/skill-creator`, outside `pnpm test` and the Gate, when the skill changes.
The evals of `sdlc-recap` hold the Recap's shape and a follow-up going out as a Brief, and `evals/trigger.json`
its trigger: it fires on `/sdlc-recap` and on a Brief's instruction, not on "co dalej?". Run the trigger set
with the plugin loaded through `--plugin-dir`, since a typed `/sdlc-recap` resolves only to the real skill.
The evals of `sdlc-brief` hold the Brief's shape and its routing of model and effort; only the dev invokes it,
so it has no trigger set.
