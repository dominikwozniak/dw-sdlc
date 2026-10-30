# GitHub facts for one PR step through `gh`

Read on 2026-10-30 with gh 2.97.0 (2026-07-31) against `byarcadia-app/foundation` #32 (merged, the
Gate adoption) and #34 (open, not a draft, two green check runs, no reviews). Enum values come from
GraphQL introspection of `api.github.com` on that day; command behaviour from `gh <cmd> --help` of the
installed version and from `cli/cli` at `trunk`. Every read ran; no action did. What no read could
confirm sits under Not verified. The ship script these facts feed is the `pr` subcommand of issue #141.

## Reading: fact, command, JSON path

One `gh pr view N --json <fields>` is one GraphQL request and carries every fact below but the review
threads, which need `gh api graphql` (the query under Sample reads all of them in one request).

| fact                | command                                                                                         | JSON path and values                                                                                                                                                                                                                                                     |
| ------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| merged or closed    | `gh pr view N --json state`                                                                     | `.state`: `OPEN`, `CLOSED` ("closed without being merged"), `MERGED`. #32 `MERGED`, #34 `OPEN`                                                                                                                                                                           |
| draft               | `gh pr view N --json isDraft`                                                                   | `.isDraft` boolean. REST `.draft`. `mergeStateStatus: DRAFT` is deprecated in the schema in favour of `isDraft`                                                                                                                                                          |
| conflicts           | `gh pr view N --json mergeable`                                                                 | `.mergeable`: `MERGEABLE`, `CONFLICTING`, `UNKNOWN` ("still being calculated"). #34 `MERGEABLE`; #32, merged, `UNKNOWN`                                                                                                                                                  |
| merge box           | `gh pr view N --json mergeStateStatus`                                                          | `.mergeStateStatus`: `BEHIND` (head out of date), `BLOCKED`, `CLEAN`, `DIRTY` (no clean merge commit), `HAS_HOOKS`, `UNKNOWN`, `UNSTABLE` (mergeable, a non-passing status). #34 `CLEAN`; #32 `UNKNOWN`. REST `.mergeable_state` is the same word in lower case: `clean` |
| behind base         | `gh pr view N --json mergeStateStatus` or `gh api repos/O/R/compare/BASE...HEAD`                | `.mergeStateStatus == "BEHIND"`; the count in `.behind_by`, `.ahead_by`, `.status`. #34's branch `ahead`, 38/0; #32's `diverged`, 6/2 after the merge                                                                                                                    |
| check runs          | `gh pr checks N --json name,state,bucket,workflow,link`                                         | `[].state` a `CheckConclusionState`, `CheckStatusState` or `StatusState` word; `[].bucket`: `pass`, `fail`, `pending`, `skipping`, `cancel`. No `conclusion` field. #34: two `SUCCESS`/`pass`                                                                            |
| check runs, rollup  | `gh pr view N --json statusCheckRollup`                                                         | `.statusCheckRollup[]`: `__typename` (`CheckRun` or `StatusContext`), `name`, `status`, `conclusion`, `workflowName`, `detailsUrl`, `startedAt`, `completedAt`                                                                                                           |
| rollup verdict      | GraphQL `commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }`                 | `StatusState`: `EXPECTED`, `ERROR`, `FAILURE`, `PENDING`, `SUCCESS`. Both PRs `SUCCESS`. `isRequired(pullRequestNumber: N)` per context; `false` on every Foundation context                                                                                             |
| review decision     | `gh pr view N --json reviewDecision`                                                            | `.reviewDecision`: `APPROVED`, `CHANGES_REQUESTED`, `REVIEW_REQUIRED`; GraphQL `null` and `gh` `""` when the base has no review rule. Both PRs `""`                                                                                                                      |
| who reviewed        | `gh pr view N --json latestReviews,reviews`                                                     | `.latestReviews[]` one per reviewer with `state`; `.reviews[]` every submission. Both `[]` on #34                                                                                                                                                                        |
| unresolved threads  | `gh api graphql` with `reviewThreads(first: 100) { nodes { isResolved isOutdated path line } }` | `.data.repository.pullRequest.reviewThreads.nodes[] \| select(.isResolved == false)`; `totalCount` for the page. Not a `gh pr view` field. 0 on both                                                                                                                     |
| auto-merge          | `gh pr view N --json autoMergeRequest`                                                          | `.autoMergeRequest`: `null`, or `{ enabledAt, mergeMethod, ... }`. `null` on both; Foundation has `allow_auto_merge: false`                                                                                                                                              |
| head sha            | `gh pr view N --json headRefOid`                                                                | `.headRefOid`; REST `.head.sha`. #34 `509443eb…`                                                                                                                                                                                                                         |
| base sha            | `gh pr view N --json baseRefOid`                                                                | `.baseRefOid`; GraphQL `baseRef { target { oid } }`; REST `.base.sha`. #34 `45932704…`                                                                                                                                                                                   |
| repository settings | `gh api repos/O/R --jq '{delete_branch_on_merge, allow_auto_merge, allow_squash_merge}'`        | Foundation: `false`, `false`, `true`; squash title `COMMIT_OR_PR_TITLE`, message `COMMIT_MESSAGES`                                                                                                                                                                       |

Sources: `gh pr view --help` and `gh pr checks --help` (the field lists); the `MergeStateStatus` enum
in `https://github.com/github/docs/blob/main/src/graphql/data/fpt/schema.docs.graphql`; the
introspected enums `MergeableState`, `PullRequestReviewDecision`, `PullRequestState`, `StatusState`,
`CheckStatusState`, `CheckConclusionState`; the REST guide
`https://docs.github.com/rest/guides/using-the-rest-api-to-interact-with-your-git-database` for the
`mergeable` background job.

## Acting: action, command, notes

| action          | command                                                                                      | notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| mark ready      | `gh pr ready N`                                                                              | `markPullRequestReadyForReview`. A PR already ready: a warning on stderr, exit 0. A closed PR: exit 1. `--undo` converts to draft. Source: `cli/cli` `pkg/cmd/pr/ready/ready.go`                                                                                                                                                                                                                                                                                                                           |
| update branch   | `gh pr update-branch N [--rebase]`                                                           | `updatePullRequestBranch` with `expectedHeadOid` set to the head `gh` read. Default a merge commit from base; `--rebase` rebases. "PR branch already up-to-date" exit 0 when not behind; "Cannot update PR branch due to conflicts" exit 1 when `mergeable` is `CONFLICTING`. Source: `pkg/cmd/pr/update-branch/update_branch.go`                                                                                                                                                                          |
| squash merge    | `gh pr merge N --squash --match-head-commit <headRefOid>`                                    | One of `--merge`, `--rebase`, `--squash` is required outside a terminal. `--match-head-commit` becomes `expectedHeadOid`: GitHub refuses when the head moved since the decision. `--subject`/`--body` set the squash commit; else the repository's squash settings apply. Without `--delete-branch`: the guard refuses that flag (`plugins/sdlc/hooks/block-dangerous-commands.sh`, `check_gh`). On a merge-queue base the PR is queued instead. Source: `gh pr merge --help`, `pkg/cmd/pr/merge/merge.go` |
| wait for checks | `gh pr checks N --watch [--fail-fast] [-i <seconds>]`                                        | Re-reads every 10 s (`-i`) until no check is pending; `--fail-fast` stops on the first failure. Exit 0 all passed, 1 any failed, 8 pending at exit (without `--watch`, or `--fail-fast` with nothing failed). With `--json` the exit is 0 whatever the state: read `bucket`. Source: `gh pr checks --help`, `pkg/cmd/pr/checks/checks.go`                                                                                                                                                                  |
| delete branch   | `gh api -X DELETE repos/O/R/git/refs/heads/<branch>`, or `git push origin --delete <branch>` | REST: 204, 422 for the default branch. Both routes, and `--delete-branch`, are refused by the plugin's guards for the agent (`check_gh_api` on `git/refs/`, `GUARD_PUSH_DELETE`). The step is the user's, or the repository's `delete_branch_on_merge`, off in Foundation                                                                                                                                                                                                                                  |

## Limits

- Primary rate limits, per user: REST 5000 requests an hour; GraphQL 5000 points an hour, counted apart.
  `gh pr view` and `gh pr checks` are GraphQL requests. `gh api rate_limit` reads both counters
  (`.resources.core`, `.resources.graphql`, `.resources.search` at 30 a minute) and is free; the
  `x-ratelimit-*` headers of each response are authoritative when the two disagree. Read live:
  core 4899 of 5000 left, graphql 4916. One read every 10 s is 360 an hour.
  Source: `https://docs.github.com/rest/using-the-rest-api/rate-limits-for-the-rest-api`,
  `https://docs.github.com/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api`.
- Secondary limits: 100 concurrent requests across REST and GraphQL; 900 REST points or 2000 GraphQL
  points a minute per endpoint; content-creating requests, which include a merge, a mark-ready and a
  branch update, 80 a minute and 500 an hour. No way to read the secondary counters.
- `mergeable` is `UNKNOWN` while GitHub computes the test merge, a background job the GET itself
  starts; re-read after a pause. A merged PR stays `UNKNOWN` for good (#32).
- Queued checks: `gh pr checks` maps `QUEUED`, `IN_PROGRESS`, `PENDING`, `WAITING`, `REQUESTED`,
  `EXPECTED` and `STALE` to `bucket: pending` and the table shows `pending` in the status column; the
  exit is 8 without `--watch`. `SKIPPED` and `NEUTRAL` are `skipping`; `ERROR`, `FAILURE`,
  `TIMED_OUT`, `ACTION_REQUIRED` are `fail`; `CANCELLED` is `cancel`. Source: `pkg/cmd/pr/checks/aggregate.go`.
- No check at all: "no checks reported on the '<branch>' branch", exit 1. `--required` on a branch
  without a required check: "no required checks reported on the '<branch>' branch", exit 1; observed on #34.
- A required check that never reports (a workflow skipped by a path filter, or never triggered) keeps the
  PR blocked with "Waiting for status to be reported"; `success`, `skipped` and `neutral` satisfy a
  requirement, and only on the latest head. Source:
  `https://docs.github.com/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks`.
- GraphQL introspection: `__Type.enumValues` at most twice per query.

## Sample: the open PR, one read

`gh pr view 34 -R byarcadia-app/foundation --json state,isDraft,mergeable,mergeStateStatus,reviewDecision,headRefOid,autoMergeRequest,statusCheckRollup`,
`statusCheckRollup` trimmed to its first entry:

```json
{
  "autoMergeRequest": null,
  "headRefOid": "509443eb3e61fd579683ac0811c5d23e6690a60e",
  "isDraft": false,
  "mergeStateStatus": "CLEAN",
  "mergeable": "MERGEABLE",
  "reviewDecision": "",
  "state": "OPEN",
  "statusCheckRollup": [
    {
      "__typename": "CheckRun",
      "completedAt": "2026-10-30T07:47:22Z",
      "conclusion": "SUCCESS",
      "detailsUrl": "https://github.com/byarcadia-app/foundation/actions/runs/41022166500/job/123951755637",
      "name": "Check",
      "startedAt": "2026-10-30T07:46:44Z",
      "status": "COMPLETED",
      "workflowName": "Quality gate"
    }
  ]
}
```

The same facts plus the threads in one GraphQL request, `gh api graphql -F query=@pr.graphql -F owner=byarcadia-app -F name=foundation -F number=34`:

```graphql
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      state isDraft mergeable mergeStateStatus reviewDecision headRefOid
      autoMergeRequest { enabledAt mergeMethod }
      baseRef { target { oid } }
      reviewThreads(first: 100) { totalCount nodes { isResolved isOutdated path line } }
      commits(last: 1) { nodes { commit { statusCheckRollup { state
        contexts(first: 50) { nodes { __typename
          ... on CheckRun { name status conclusion isRequired(pullRequestNumber: $number) }
          ... on StatusContext { context state isRequired(pullRequestNumber: $number) } } } } } } }
    }
  }
}
```

Answer for #34: `reviewThreads.totalCount` 0, `statusCheckRollup.state` `SUCCESS`, both contexts
`CheckRun` with `conclusion: SUCCESS` and `isRequired: false`.

## Not verified

- A live `isDraft: true`, `CONFLICTING`, `BEHIND`, `BLOCKED`, `UNSTABLE`, `CHANGES_REQUESTED` or an
  unresolved thread: no PR in Foundation or this repo is in one of those states on the read date.
- How a required check that never reports looks in the API. The expected shape, from the docs and
  `gh`'s source, is `mergeStateStatus: BLOCKED` with the check absent from `statusCheckRollup`, so
  `gh pr checks` cannot list it; Foundation cannot carry a ruleset to show it (free plan, the rules
  endpoints answer 403).
- `gh pr checks --watch` exit codes, `gh pr ready`, `gh pr update-branch` and `gh pr merge` messages:
  from `cli/cli` at `trunk` and `--help`, not run.
