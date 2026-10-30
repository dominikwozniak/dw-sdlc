# dw-mc — prior art for the `pr` subcommand: `gh` adapters and bucket rules

Read on 2026-10-30 from `references/dw-mc` at `bb857a2`. Paths below are relative to
`references/dw-mc/`. `dw-mc` is frozen; nothing here proposes a change to it.

`dw-mc` is a local CLI on Effect 4 that tracks the open pull requests one person authors: a sweep
reads GitHub through `gh`, writes the facts to a state directory, and `place(facts)` puts each PR in
one bucket. Four layers, imports one way: `cli` → `domain` → `adapters` → `terms`
(`docs/adr/0006-source-layout.md`). Every rule is a function from facts to a decision; every guard
answers `string | null`: the sentence saying why not, or go (`src/cli/pr.ts:64-65`).

## 1. Every `gh` call that reads a PR, and the fields it keeps

One helper runs them all: `readJson(label, "gh", args, schema)` spawns `gh`, decodes stdout with an
Effect Schema and maps the failures to `GhUnavailable | GhReadFailed | GhUnreadable`
(`src/adapters/gh.ts:119-133`). A sweep asks `gh auth status` once up front (`gh.ts:60-71`) and
`gh api user` for the login every read is scoped to (`gh.ts:138-143`).

| call                                                                                                | where                                | fields kept                                                                                                                                                                |
| --------------------------------------------------------------------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gh search prs --author=@me --state=open --repo R --limit 100 --json number,repository`             | `src/adapters/pr.ts:37-46`           | `number`, `repository.nameWithOwner`; one search per repo so one unreadable repo costs only its rows                                                                       |
| `gh pr view N --repo R --json <viewFields>`                                                         | `pr.ts:74-84`                        | `number,title,url,isDraft,headRefOid,headRefName,baseRefName,author.login,isCrossRepository,mergeable,reviewDecision,statusCheckRollup,labels[].name` — the one state read |
| `gh pr view N --repo R --json commits`                                                              | `pr.ts:171-183`                      | `commits[].committedDate`, `commits[].authors[].login`; asked only when the PR moved, it is the expensive read                                                             |
| `gh pr view N --repo R --json files`                                                                | `src/adapters/ci.ts:165-173`         | `files[].path`, evidence for the flaky classifier                                                                                                                          |
| `gh pr list --repo R --state open --limit 500 --json number,headRefName,baseRefName`                | `pr.ts:112-121`                      | branch pairs of every open PR, to recognise a stack (`src/domain/rebase.ts:65-74`)                                                                                         |
| `gh api repos/R/compare/BASE...HEAD`                                                                | `pr.ts:142-145`                      | `files[].filename`: what changed since the last review run, for the re-run rule                                                                                            |
| `gh api repos/R/issues/N/comments?per_page=100` and `…/pulls/N/comments?per_page=100`               | `src/adapters/conversation.ts:49-59` | `created_at`, `user.login`, `user.type === "Bot"`; REST because `gh pr view` does not say a login is a bot (`conversation.ts:43-47`)                                       |
| `gh api repos/R/pulls/N/reviews?per_page=100`                                                       | `conversation.ts:78-91`              | `submitted_at`, `user`, `body`; an empty body is a verdict and is dropped, the verdict arrives as `reviewDecision`                                                         |
| `gh api graphql` — `comments`, `reviews`, `reviewThreads{isResolved isOutdated path line comments}` | `conversation.ts:176-231`            | the whole conversation with thread state; the one GraphQL read, because REST has no resolved flag (`conversation.ts:159-167`)                                              |
| `gh repo view R --json defaultBranchRef`                                                            | `ci.ts:108-116`                      | `defaultBranchRef.name`, `main` when null                                                                                                                                  |
| `gh run list --repo R --branch B --workflow W --limit 5 --json conclusion`                          | `ci.ts:137-160`                      | the newest run with a verdict; red on the default branch is one flaky signal                                                                                               |
| `gh api repos/R/actions/jobs/J/logs --allow-escape-sequences`                                       | `ci.ts:191-198`                      | the last 64 KiB of a failing job's log                                                                                                                                     |
| `gh api repos/R/labels/NAME`                                                                        | `src/adapters/label.ts:19-26`        | exists or 404; a label is never created                                                                                                                                    |

Three unions sit in `src/terms/pr.ts:12-21` because `gh` answers in them and the bucket rules decide
on them: `Mergeability = mergeable | conflicting | unknown` (`MERGEABLE`, `CONFLICTING`, else;
`pr.ts:192-198`), `ReviewDecision = approved | changes-requested | review-required | none` (an empty
string is `none`: a repo with no required reviewer; `pr.ts:204-211`), `ChecksState = green | red |
pending | none`. `statusCheckRollup` mixes two shapes, so `CheckEntry` makes every field optional:
`name, context, status, conclusion, state, workflowName, detailsUrl` (`ci.ts:20-30`). `rollupState`
drops the names in `ci.ignore`, says `none` when nothing counts, `red` when any conclusion or state
is in `FAILURE, TIMED_OUT, CANCELLED, STARTUP_FAILURE, ACTION_REQUIRED, ERROR`, `pending` when any
`status !== COMPLETED` or a state is in `QUEUED, IN_PROGRESS, WAITING, PENDING, REQUESTED, EXPECTED`,
else `green` (`ci.ts:33-66`). `reportedAt` reads `/actions/runs/<run>/job/<job>` out of `detailsUrl`:
the run id feeds `gh run rerun`, the job id the logs endpoint (`ci.ts:94-97`).

The writes, for contrast: `gh pr merge N --repo R --squash --delete-branch`, no `--auto`
(`pr.ts:226-230`); `gh run rerun RUN --repo R --failed` (`ci.ts:230-232`); `gh api -X POST|DELETE
repos/R/issues/N/labels` (`label.ts:35-52`); `git push --force-with-lease=refs/heads/B:<head read>`
(`src/adapters/git.ts:414-422`). Never a comment, review, approval or status
(`docs/adr/0002-github-write-boundary.md`). `gh pr update-branch` and `gh pr ready` do not appear.

## 2. The bucket rules, as a decision table

`Facts` is everything the rules may know (`src/domain/bucket.ts:15-41`): `draft`, `head`,
`mergeable`, `reviewDecision`, `checks`, `ciFlaky`, `rebaseConflictAt`, `newestHumanCommentAt`,
`myLastCommentAt`, `myLastCommitAt`, `acknowledgedAt`, `reviewRunHead`, `blockingFindings`. The
sweep assembles it (`src/cli/sweep.ts:72-147`): bots are excluded from `newestHumanCommentAt`
(`sweep.ts:60-62`), `reviewRunHead` and `blockingFindings` come from the state directory
(`src/domain/review.ts:300-311`). `place` tries the rows in order and the first match wins
(`bucket.ts:177-192`); `needsMe` is `bucket.ts:121-141`.

| #   | condition                                                                             | bucket            | reason                                   |
| --- | ------------------------------------------------------------------------------------- | ----------------- | ---------------------------------------- |
| 1   | `mergeable === "conflicting"`                                                         | Needs me          | merge conflict                           |
| 2   | `rebaseConflictAt === head`                                                           | Needs me          | a rebase onto the base conflicted        |
| 3   | `checks === "red"` and `ciFlaky === null`                                             | Needs me          | CI is red                                |
| 4   | `reviewDecision === "changes-requested"`                                              | Needs me          | changes requested                        |
| 5   | `blockingFindings > 0`                                                                | Needs me          | N blocking finding(s)                    |
| 6   | `newestHumanCommentAt` after the latest of my comment, my commit, my ack (`:113-114`) | Needs me          | a comment I have not answered            |
| 7   | `reviewRunHead !== head`                                                              | Needs review run  | no review run on this head               |
| 8   | `reviewDecision === "review-required"`                                                | Waiting on others | a review from someone else               |
| 9   | `checks === "pending"`                                                                | Waiting on others | CI is still running                      |
| 10  | otherwise                                                                             | Ready             | what holds of approved, green, mergeable |

Three choices worth keeping: Ready needs no approval, because a repo with no required reviewer never
produces one, so `none` passes and `review-required` is what waits (`bucket.ts:173-175`);
`mergeable: unknown` holds nothing back (`src/domain/bucket.test.ts:247`); draft is a flag shown on
the row, not a bucket (`bucket.ts:20-21`, test `:251`). A red CI the classifier excused reaches Ready
and the reason says so out loud (`bucket.ts:160-162`).

Three more guards reuse the same facts and the same `string | null` shape:

- **Stamp** (`src/domain/stamp.ts:68-87`), the local "passed my bar": withdrawn at this head → no;
  `reviewRunHead !== head` → no; `blockingFindings > 0` → no; `checks !== "green"` → no, an excused
  red is still not green; `mergeable !== "mergeable"` → no; else stamped.
- **Merge** (`src/domain/merge.ts:83-98`): not mine → refuse; draft → refuse; not Ready by GitHub's
  opinion (`changes-requested`, `review-required`, not green, not mergeable; `merge.ts:28-36`) →
  refuse; no stamp → refuse with the command that earns one. Both bars at the head a fresh
  `pr view` just read (`src/cli/merge.ts:48-65`), never off the last sweep.
- **Rebase** (`src/domain/rebase.ts:149-168`): off in config → refuse; not mine, from a fork, not in
  the open list, or in a stack (`rebase.ts:102-126`) → refuse; `checks === "pending"` → refuse, it
  would cancel the run; `checks === "red"` → refuse, red is mine to fix first.
- **Re-run** (`src/domain/rerun.ts:48-84`): not mine, not red, already re-run at this head, no
  workflow run behind the red → refuse; classifier says legitimate → refuse and never re-run.

The flaky classifier (`src/domain/flaky.ts:101-117`) reads three signals with no model: a log that
names a file the PR changes → legitimate, and it outranks the rest; else red on the default branch
too, or a built-in or configured pattern in the log (`flaky.ts:37-53`) → flaky; else legitimate.
Unexplained is mine, because a real failure called flaky is the costlier mistake (`flaky.ts:96-99`).

## 3. How it runs reviews with Claude Code, and what the verdict does

One review run per head, in a throwaway worktree cut from the tool's own bare clone at
`refs/pull/N/head` (`src/adapters/git.ts:84-141`; `docs/adr/0009-one-review-run.md`). The shape is
decided in `turnFor` (`src/domain/persona.ts:101-111`): with `review.command` set, a slash-command
turn `"<command> <effort>"` with `review.prompt` beside it; without one, the tool's own persona
(`persona.ts:20-54`, from Addy Osmani's `code-reviewer`) with the instructions in front.

| turn                       | argv                                                                                                     | where                            |
| -------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------- |
| slash command, first turn  | `claude -p "<line>" --output-format stream-json --verbose [--append-system-prompt <prompt>] [--model M]` | `src/adapters/claude.ts:148-182` |
| slash command, second turn | `claude -p --resume <session_id> "<reportFindings>" --output-format json --json-schema <schema>`         | `claude.ts:213-242`              |
| own prompt, one turn       | `claude -p "<prompt>" --output-format stream-json --verbose --json-schema <schema> [--model M]`          | `claude.ts:253-287`              |

Two turns because `--json-schema` beside `/code-review` breaks the run, so the findings are asked
for on a second turn that resumes the session, which also reads the diff's line numbers better than
the prose (`claude.ts:134-139`, `:203-205`; dw-mc's claim, "verified by running it"). `--comment` is
never passed (`claude.ts:141-143`). The stream is folded line by line: `assistant` events give the
tools reached for (a heartbeat) and the prose; the `result` event gives `subtype`, `is_error`,
`session_id`, `result`, `structured_output` (`claude.ts:36-57`, `:109-126`). `is_error` or
`subtype !== "success"` is a failure (`claude.ts:89-98`). Patience is 45 min for the review and 5 min
for the report (`src/adapters/agent.ts:53-56`); a late or non-zero turn is an `AgentFailed`
(`agent.ts:68-106`).

The schema the run is held to is derived from the stored shape, not written twice
(`src/domain/findings.ts:79-81`): `{ verdict: "clean" | "findings", findings: [{ file, line,
severity: "error" | "warning" | "info", summary }] }` (`findings.ts:45-55`). The reader also accepts
the persona's words: `Critical`, `Required` → error, `Optional` → warning, `Nit`, `FYI` → info
(`findings.ts:17-29`). A finding blocks when its severity ranks at or above `stamp.blocks_on`
(`findings.ts:98-108`).

What the verdict does: `recordRun` writes the run under `<pr>@<head>`, an `@latest` index and a
Markdown report, as one act (`src/domain/review.ts:116-123`). `reviewedAt` turns it into the two
facts the buckets read: `reviewRunHead` (only when the run reported) and `blockingFindings`
(`review.ts:300-311`). A failure is recorded as a failure and is never a clean verdict
(`review.ts:16-21`, `:133-134`); the command exits non-zero and names `--force`
(`src/cli/review.ts:184-195`). The re-run rule skips a run when the last one reported and every file
`gh api compare` lists matches `review.docs_only` (`review.ts:233-238`). The findings feed an
interactive fix session, or `dw-mc fix --print` prints that prompt for a session already open
(`skills/dw-mc/SKILL.md:67-71`). With `labels.enabled`, the verdict becomes one of two labels on the
PR, reconciled by sweep and review (`src/domain/label.ts:15-45`).

## 4. Effect-specific versus plain logic

56 of 66 non-test modules import `effect`. The ten that do not are all rules or text:
`domain/merge.ts`, `comments.ts`, `label.ts`, `persona.ts`, `quiet.ts`, `coverage.ts`, `pick.ts`,
`reference.ts`, `cli/row.ts`, `cli/table.ts`.

| Effect-specific, written again without it                                                                                                                 | plain replacement in a zero-dependency package                                    |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `capture` on `ChildProcessSpawner`, the fake and stubbed spawners keyed by argv (`src/adapters/spawner.ts:27-141`)                                        | `node:child_process` `spawnSync`, a runner function injected for tests            |
| `Schema.fromJsonString(Schema.Struct(…))` per read (`pr.ts:48-67`, `ci.ts:20-30`, `conversation.ts:12-19`, `:117-147`)                                    | `JSON.parse` plus a hand-written parse per read                                   |
| `Schema.TaggedError` classes and `Effect.catchTags` / `failedAs` (`gh.ts:14-48`, `:105-113`; `agent.ts:12-20`)                                            | one error type with a `kind`, mapped to exit codes                                |
| `KeyValueStore`, `Layer`, `Context.Service` for state and config (`src/adapters/store.ts:37-151`, `src/adapters/config.ts:244-276`)                       | none: the subcommand keeps no state directory and reads `.ai/agentic.config.json` |
| `effect/cli` `Command.make`, `Flag`, `Argument`, `CliError.UserError` (`src/cli/review.ts:42-75`, `:213-224`)                                             | the existing `cli.ts` row and `parseArgs`                                         |
| `Stream.splitLines` + `runFold` over stream-json, `Effect.timeoutOrElse`, `acquireUseRelease` (`claude.ts:109-126`, `agent.ts:101-105`, `git.ts:134-140`) | split on `\n`, the `timeout` option of `child_process`, `try/finally`             |
| `Effect.fn("name")` spans, `Match.value`, `DateTime.Utc` schemas                                                                                          | drop; a record lookup; ISO strings and `Date.parse`                               |

Plain logic to carry over as it stands, each a pure function with its test beside it:

- `place`, `needsMe`, `readyReason`, `answeredAt` (`bucket.ts:113-192`), on a plain `Facts` type.
- `rollupState`, `failedChecks`, `reportedAt`, `failedRuns` (`ci.ts:36-97`, `:211-221`);
  `mergeabilityOf`, `reviewDecisionOf` (`pr.ts:192-211`); the `viewFields` string (`pr.ts:74-76`).
- `stampFor` (`stamp.ts:68-87`), `merge.decide` (`merge.ts:83-98`), `rebase.decide`, `boundary`,
  `stackOf` (`rebase.ts:27-168`), `rerun.decide` (`rerun.ts:48-84`), `classify` and
  `builtInPatterns` (`flaky.ts:37-117`).
- `blocking` and the severity ranks (`findings.ts:98-108`); `turnFor`, `reviewPrompt`
  (`persona.ts:57-111`); `worthRerunning`, `skippedSince` (`review.ts:208-238`, `matchesGlob`
  from `node:path`); `shown`, `acknowledging` (`src/domain/comments.ts`); `relabel` (`label.ts`).
- The test idiom: a fake `gh` answering by argv string, and `prViewOf`, a fixture that defaults every
  field to a healthy PR so a test names only what its question turns on (`pr.ts:239-277`).

## What the dw-sdlc subcommand borrows

- One `gh pr view --json` with the 13 `viewFields` as the state read; the three unions in `terms`;
  `rollupState` with `ci.ignore`; `reportedAt` for run and job ids; `user.type === "Bot"` from REST
  to drop bots; GraphQL `reviewThreads{isResolved isOutdated}` for threads.
- The decision table above as `decide(state)`, first match wins, a reason string beside each bucket;
  Ready without an approval; `unknown` mergeability does not block; draft as a flag.
- Guards that answer `string | null` and are read live before every write, never off a cache.
- Merge as squash without `--auto`, with the delete as a second step (the guard refuses
  `--delete-branch`); a branch update as rebase with `--force-with-lease=<branch>:<head read>`, never
  while CI is pending.
- The findings shape `{ verdict, findings[{ file, line, severity, summary }] }`, the `blocks_on`
  rank, and the rule that a failed review is never a clean verdict. The loop runs inside a session,
  so the headless spawn, the two-turn trick and the state directory stay behind.
- The flaky classifier as the only automatic excuse for a red CI, with one re-run per head.
- Fake `gh` by argv plus a healthy-PR fixture as the test seam.

Not verified here: nothing was run; the `gh` field names and the Claude Code flag behaviours are as
the code and its comments state. `src/cli/status.ts`, `fix.ts`, `comments.ts`, `domain/quiet.ts` and
the full `adapters/store.ts` and `config.ts` were skimmed, not read.
