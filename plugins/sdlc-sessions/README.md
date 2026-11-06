# sdlc-sessions

The skills that run a Claude Code session, beside the [`sdlc`](../sdlc/README.md) plugin that keeps it
safe. It carries `/sdlc-recap`, which tells a dev who did not follow a session where it stands. The
decision to ship it apart is [ADR 0014](../../docs/adr/0014-session-helpers-ship-as-sdlc-sessions-beside-sdlc.md).

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
- `skills/sdlc-recap/` — the skill, and under `evals/` its evals.
- `test/manifest.test.ts` — the manifest, the link, the skill's name and description, the marketplace.

## The Recap

`/sdlc-recap` works in any session. Where `dw-sdlc recap` cannot run, the Recap leaves out the close line
and says the state is unverified. Its first line is a verdict in the Action words,
`done`, `act`, `wait` or `park`, and one sentence. Then come these sections, each only when it has
content: what happened, as a table of outcomes with links; the decisions taken without the dev; numbered
questions, each with a recommendation; what waits on whom; the close line; and the follow-ups.

Each follow-up is "this session" or "a new session", with one recommended disposition: `now`, `issue`,
`worker` or `drop`, the lightest that closes it, and `now` by default when it fits the session. The dev's
one "go" carries out every recommendation, "go, but 2 issue" changes one, and nothing runs before it.

The Recap is written in the conversation's language. It links pull requests and issues instead of
listing files, and it checks every "merged" or "green" live with `gh`.

The model may invoke the skill, because a Brief can tell a Worker to end with a Recap. Its description
limits that to the dev typing `/sdlc-recap` and a Brief's instruction, so "co dalej?" gets a plain answer.

## `dw-sdlc recap`

The facts a Recap rests on, tested like the Ship script. Read-only: `dw-sdlc recap [--json]` reports:

- the branch and the head;
- the uncommitted changes, untracked files among them;
- the upstream and the unpushed commits: past the upstream or, without one, on no remote;
- whether a rebase or `git am` is paused;
- the branch's pull request and the Action the Ship script's decision gives it, read and never performed;
- whether the session sits in a linked worktree.

Exit 0 means the session can be closed, 1 that it cannot, and 2 that the command cannot run. Under
`close`, the document gives the `verdict`, the `line` a Recap quotes and every reason, each with
`blocks`.

| reason              | blocks | when                                                                                                            |
| ------------------- | ------ | --------------------------------------------------------------------------------------------------------------- |
| `rebase`            | yes    | a rebase or `git am` is paused, however clean the tree reads                                                    |
| `uncommitted`       | yes    | a change git would commit or could track                                                                        |
| `unpushed`          | yes    | commits past the upstream                                                                                       |
| `no-upstream`       | yes    | commits on no remote, on a branch with no upstream or a detached HEAD                                           |
| `open-pull-request` | yes    | the pull request is open, whatever its Action                                                                   |
| `no-pull-request`   | yes    | commits on top of the base, no pull request holds the head, and the branch is neither the default nor protected |
| `merged`            | no     | the pull request merged                                                                                         |
| `closed`            | no     | the pull request closed without merging; commits only it holds read as `no-upstream`                            |
| `worktree`          | no     | a linked worktree, left to remove                                                                               |
| `clean`             | no     | no reason blocks                                                                                                |

An open pull request blocks even when it is parked on the dev: the session's work has not landed, and a
wrong "no" costs less than a wrong "yes". A linked worktree does not block, since the session cannot
remove the directory it runs in. A branch with no upstream and no commit of its own has nothing to lose,
so it can close. A commit an open or merged pull request holds counts as pushed, so a merged branch whose
remote ref is gone still closes. A pull request closed without merging lands nothing: its commits count
as pushed only on a remote branch, and the command asks the remote whether the upstream still stands,
since no fetch may have said it is gone. A branch `guardrails.protectedBranches` names takes changes through pull requests,
so it needs none of its own; a long-lived branch the config does not name reads as `no-pull-request`.

A detached HEAD or a repository with no remote asks `gh` nothing, and the `clean` reason says so rather
than claim nothing is open. Elsewhere the command needs an authenticated `gh` and a remote it can read: a
remote on another host exits 2. It counts from the pull request's base, or from the default branch when
there is no pull request.

## Evals

The skill's evals run through `/skill-creator`, outside `pnpm test` and the Gate, when the skill changes.
`evals/evals.json` holds the Recap's shape, and `evals/trigger.json` its trigger: it fires on
`/sdlc-recap` and on a Brief's instruction, not on "co dalej?". Run the trigger set with the plugin
loaded through `--plugin-dir`, since a typed `/sdlc-recap` resolves only to the real skill.
