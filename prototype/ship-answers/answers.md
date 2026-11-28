# `pr ship --json` answers with `next` — rough prototype

Throwaway, for the grilling of "The Ship skill and its answers after the change" (#516). Not built;
every answer below is written by hand. The Review is gone: no `review`, `mark-reviewed`,
`review-limit`, no `--review`, no `details.depth`.

## The shape

```ts
type Step =
  | { by: "agent" | "dev"; run: string } // mechanical: an exact command
  | { by: "agent" | "dev"; do: string } //  judgement: one line, carried out on `details`

type Answer = {
  pr: string; head: string; base: string
  status: "act" | "wait" | "park" | "done"
  action: Action; actor: "script" | "agent" | "dev"; reason: string
  recheckAfter?: number
  details?: Record<string, unknown>
  next: Step[] // in order; `command` is gone, it is a `by: "dev"` step
  blockers: (Blocker & { next: Step[] })[]
  performed: Performed[]
}
```

The skill's whole loop: take each `by: "agent"` step in order; print each `by: "dev"` step and never
run it; then `act` calls again, `wait` ran the `--wait` call in the background, `park` and `done` stop.

Every sample: pull request 42 of `dominikwozniak/dw-sdlc`, branch `feat/x`, head `abc1234`, base `main`.
`pr`, `head`, `base` and `performed: []` are left out after the first.

## act

### act fix-ci

```json
{
  "pr": "https://github.com/dominikwozniak/dw-sdlc/pull/42",
  "head": "abc1234…", "base": "main",
  "status": "act", "action": "fix-ci", "actor": "agent",
  "reason": "1 check(s) failing",
  "details": { "checks": [{ "name": "quality-gate", "log": "gh run view 123 --log-failed", "link": "https://…" }] },
  "next": [
    { "by": "agent", "do": "read each failing check's log under details.checks, fix the cause, then git push" }
  ],
  "blockers": [],
  "performed": []
}
```

### act fix-conflicts

```json
{
  "status": "act", "action": "fix-conflicts", "actor": "agent",
  "reason": "conflicts with main",
  "details": { "base": "main" },
  "next": [
    { "by": "agent", "run": "git fetch origin main && git rebase origin/main" },
    { "by": "agent", "do": "resolve each conflict keeping both sides' intent, git rebase --continue, then git push --force-with-lease" }
  ],
  "blockers": [
    { "action": "fix-ci", "actor": "agent", "reason": "1 check(s) failing", "details": { "checks": ["…"] },
      "next": [{ "by": "agent", "do": "read each failing check's log under details.checks, fix the cause, in the same push" }] }
  ]
}
```

### act address-review, threads

Each thread carries its exact resolve command, and a reply command whose only blank is `<text>`.

```json
{
  "status": "act", "action": "address-review", "actor": "agent",
  "reason": "2 unresolved thread(s)",
  "details": {
    "threads": [{
      "id": "PRRT_kw1", "path": "src/a.ts", "line": 12, "author": "someone", "body": "…",
      "resolve": "gh api graphql -f query='mutation($id:ID!){resolveReviewThread(input:{threadId:$id}){thread{id}}}' -f id=PRRT_kw1",
      "reply": "gh api graphql -f query='mutation($id:ID!,$body:String!){addPullRequestReviewThreadReply(input:{pullRequestReviewThreadId:$id,body:$body}){comment{id}}}' -f id=PRRT_kw1 -f body=<text>"
    }]
  },
  "next": [
    { "by": "agent", "do": "triage each thread under details.threads against the code: fix it and run its resolve, or run its reply with why and leave it open; git push when code changed" }
  ]
}
```

### act address-review, changes requested, no thread

```json
{
  "status": "act", "action": "address-review", "actor": "agent",
  "reason": "changes requested",
  "next": [
    { "by": "agent", "run": "gh pr view 42 -R dominikwozniak/dw-sdlc --json reviews" },
    { "by": "agent", "do": "answer the review asking for changes with a push; with nothing to change it is the reviewer's turn: say so and stop" }
  ]
}
```

### act prove-locally (pr.ciUnavailable gate, gate.steps set)

```json
{
  "status": "act", "action": "prove-locally", "actor": "agent",
  "reason": "CI unavailable on abc1234: quality-gate ran no step",
  "next": [
    { "by": "agent", "run": "dw-sdlc gate --mark" },
    { "by": "agent", "do": "red: fix what it printed, then git push" }
  ]
}
```

### act, the checkout behind the head

When the checkout is the pull request's branch but behind `head` (the script updated it on GitHub),
the script puts the pull first. On another branch, or ahead with unpushed commits, it is a `park`.

```json
{
  "status": "act", "action": "fix-ci", "actor": "agent",
  "reason": "1 check(s) failing",
  "next": [
    { "by": "agent", "run": "git pull --rebase" },
    { "by": "agent", "do": "read each failing check's log under details.checks, fix the cause, then git push" }
  ]
}
```

### act update-branch, mark-ready, merge

The script performs these itself; they show under `performed`, never as an answer, except as a `park` under
`--dry-run`:

```json
{
  "status": "park", "action": "merge", "actor": "script",
  "reason": "--dry-run: the script would merge",
  "next": [{ "by": "dev", "run": "gh pr merge 42 --squash --match-head-commit abc1234…" }],
  "performed": [{ "action": "merge", "command": "gh pr merge 42 -R dominikwozniak/dw-sdlc --squash --match-head-commit abc1234…", "ok": null }]
}
```

## wait

The step is always the same call with `--wait`; its output is the next answer. `--wait` returns at
its own time limit with a `wait` again, whose step is the same call; `ci-stuck` past the 40 min budget
ends it.

### wait ci-pending

```json
{
  "status": "wait", "action": "wait", "actor": "script",
  "reason": "ci-pending", "recheckAfter": 240,
  "next": [{ "by": "agent", "run": "dw-sdlc pr ship 42 -R dominikwozniak/dw-sdlc --wait --json" }]
}
```

### wait mergeability-unknown, wait unverified

As `ci-pending`, `recheckAfter` 15.

## park

Every `park` has its `reason`, and the dev's step when there is one. The agent takes none.

### park ready-to-merge (pr.merge ask, or another author's pull request)

```json
{
  "status": "park", "action": "ready-to-merge", "actor": "dev",
  "reason": "pr.merge is ask: the merge is the dev's",
  "next": [{ "by": "dev", "run": "gh pr merge 42 --squash --match-head-commit abc1234…" }]
}
```

### park with a dev command

`ci-unavailable` (no gate.steps), `unverified` (past the 120 s grace), `partial-read`: as
`ready-to-merge`, its own `reason`.

### park with no command

```json
{ "status": "park", "action": "awaiting-review", "actor": "dev",
  "reason": "changes requested by someone, answered by a push: the next review is the reviewer's",
  "next": [] }
```

Also `stop` (closed without merging), `ci-stuck`, `awaiting-reply` (with `details.threads`),
`awaiting-author`, `awaiting-approval`.

### park, the checkout is not the pull request's branch

```json
{ "status": "park", "action": "wrong-checkout", "actor": "dev",
  "reason": "the checkout is on main, not feat/x at abc1234",
  "next": [{ "by": "dev", "run": "git switch feat/x" }] }
```

## done

### done, main checkout

The session finishes the Landed branch: the base, pulled, and the local branch gone.

```json
{
  "status": "done", "action": "done", "actor": "dev",
  "reason": "merged as def5678",
  "details": { "mergeCommit": "def5678…" },
  "next": [
    { "by": "agent", "run": "git switch main && git pull --rebase && git branch -D feat/x" }
  ]
}
```

### done, the remote branch still stands

`delete_branch_on_merge` is trusted to be on; when the read still shows the head ref, the dev deletes it.

```json
{
  "status": "done", "action": "done", "actor": "dev",
  "reason": "merged as def5678",
  "next": [
    { "by": "agent", "run": "git switch main && git pull --rebase && git branch -D feat/x" },
    { "by": "dev", "run": "git push origin --delete feat/x" }
  ]
}
```

### done, a worktree

The worktree and its branch are the Lead's Sweep's, after the Worker's Recap.

```json
{ "status": "done", "action": "done", "actor": "dev", "reason": "merged as def5678",
  "next": [{ "by": "dev", "do": "the worktree and its branch go with /sdlc-sweep" }] }
```

## exit 2

No `next`: the skill shows `error` and `remedy` and stops.

```json
{ "error": "gh is not authenticated", "remedy": "gh auth login", "performed": [] }
```
