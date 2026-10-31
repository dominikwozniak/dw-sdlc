# Reactions to the `pr next` stub: live runs, SHA-pinned markers, the Action's name

Read on 2026-10-30 and 2026-10-31. The stub (`packages/dw-sdlc/src/commands/pr-next.ts` on this
branch) ran against `byarcadia-app/foundation` #38 and #39 and `dominikwozniak/dw-sdlc` #152 and #153;
`packages/dw-sdlc/test/pr-next.fixtures.ts` drives `decide` through the paths no live PR reached.
Prior art comes from the clones under `references/`, each path relative to its clone; GitHub facts from its docs, schema introspection
and read-only `gh api` calls. No write reached GitHub. What no read could confirm is marked unverified.
The design these facts feed is the ship script's contract, issue #143 of map #141.

## Live runs

| PR                                                  | first answer                          | facts                                                                                                                               |
| --------------------------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| foundation #39, version PR by `github-actions[bot]` | `ready-to-merge`, "every gate passed" | no check on the head (`checks: []`, `rollup: null`) though `quality-gate.yaml` runs on `pull_request`; `mergeStateStatus: UNSTABLE` |
| dw-sdlc #152                                        | `wait`, one check running             | `Check` pending                                                                                                                     |
| foundation #38, merged                              | `done`, the dev deletes the branch    | the remote keeps 16 branches beside `main`, most of them merged                                                                     |

- dw-sdlc's version PR #138 ran no check either, and was merged by hand.
- `isRequired` is `false` on every context: branch protection and rulesets answer 403 ("Upgrade to
  GitHub Pro or make this repository public") on both private repositories, so no check is required
  and only the script gates a merge.
- `BEHIND` never appeared live; whether GitHub reports it without a strict protection rule is unverified.

## Pinning a verification to a head SHA

| mechanism               | bound to the SHA                                        | written with the dev's `gh` token                      | in the one GraphQL query               | caveat                                                                                                                                     |
| ----------------------- | ------------------------------------------------------- | ------------------------------------------------------ | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| label                   | no: `Labelable` is `Issue`, `PullRequest`, `Discussion` | yes                                                    | `labels`, `LabeledEvent.createdAt`     | a push never removes it; an ordinary push's server time is only in REST `repos/O/R/activity`, `Commit.pushedDate` is deprecated and `null` |
| commit status           | yes: `POST /repos/O/R/statuses/{sha}`                   | yes, push access and the `repo` scope                  | `StatusContext` in `statusCheckRollup` | any state but `success` turns `mergeStateStatus` to `UNSTABLE`; shown by `gh pr checks`                                                    |
| check run               | yes                                                     | no: "To create a check run, you must use a GitHub App" | `CheckRun`                             | needs an App or Actions' `GITHUB_TOKEN`                                                                                                    |
| review on a commit      | yes, `commit_id`                                        | yes; approving one's own PR is refused (unverified)    | `reviews { commit { oid } }`           | noise in the conversation                                                                                                                  |
| hidden SHA in a comment | only as the reader compares it                          | yes                                                    | `comments { body author }`             | anyone who comments can forge it                                                                                                           |

Sources: https://docs.github.com/en/rest/commits/statuses,
https://docs.github.com/en/rest/checks/runs,
https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps.

How the references do it:

- open-mercato pins only `qa-approved`, through a visible `QA head: <sha>` line in the comment that
  grants it (`open-mercato-skills/SDLC.md:137`); `om-approve-merge-pr` compares it with `headRefOid`
  and asks when they differ (`skills/om-approve-merge-pr/SKILL.md:40`). A push leaves the label on
  and stales it; removing it on push was considered and rejected (`DECISIONS.md:246`).
- open-mercato's pipeline labels carry no SHA. The set sits under `labels` in
  `.ai/agentic.config.json`, but only `labels.enabled` is read; the names are literal in the skills
  and the guard (`skills/om-setup-agent-pipeline/references/agentic-setup.md:42`,
  `skills/om-auto-review-pr/references/label-transitions.md:10`). One pipeline label at a time:
  `set_pipeline_label` removes the others, then adds one (`skills/om-setup-agent-pipeline/references/trackers/github.md:101-109`).
- dw-mc earns a label only while `reviewRunHead === head` (`dw-mc/src/domain/label.ts:10-19`).
- open-mercato merges with `gh pr merge --squash` and no `--match-head-commit` (`skills/om-setup-agent-pipeline/references/trackers/github.md:347`).

## What the decided thing is called

| source                         | noun                                     | values                                                                                      |
| ------------------------------ | ---------------------------------------- | ------------------------------------------------------------------------------------------- |
| Prow Tide                      | `Action`, "exactly one action each sync" | WAIT, TRIGGER, MERGE, BLOCKED (`pkg/tide/tide.go` L103-112)                                 |
| Mergify                        | actions                                  | per rule                                                                                    |
| open-mercato `om-pr-autopilot` | chain step, "Next action"                | `stop`, `om-auto-fix-pr {pr}` (`skills/om-pr-autopilot/references/state-matrix.md:9-23`)    |
| kcd `ship-pr`                  | `step` from `decide()`                   | `mark-ready` … `merge`, `done`, `stop` (`skills/autopilot/scripts/ship-pr.mjs:212-322`)     |
| pstack babysit                 | verdict                                  | `READY`, `WAITING`, `BLOCKER`, `TIMEOUT`                                                    |
| dw-mc                          | bucket                                   | `needs-me`, `needs-review-run`, `waiting-on-others`, `ready` (`src/domain/bucket.ts:64-81`) |
| Renovate                       | `BranchResult`                           | `automerged`, `pending`, `needs-approval`, `done`                                           |

Taken in this repository's glossary: Step (a Gate command), Verdict and its avoided "decision",
Stage. Task meets the Task Router; Intent meets GitHub's `LabeledEvent.intent`.

## What open-mercato's loop has that the first stub lacked

- every blocker in one cycle, with a `Blockers` line (`SDLC.md:155`; `skills/om-pr-autopilot/references/diagnose.md:147`);
- a wait budget, `ci.maxWaitMinutes`, 40 by default, then local validation and stop (`SDLC.md:153`);
- a review before merge when none exists (`skills/om-pr-autopilot/references/state-matrix.md:18`; dw-mc `needs-review-run`);
- a draft promoted at merge preparation, not first (`skills/om-pr-autopilot/references/state-matrix.md:49-51`);
- ownership: a PR the agent may push to but not drive gets review and hand-off (`skills/om-pr-autopilot/references/diagnose.md:27-35`);
- CI cross-checked against the workflow runs at the head SHA (`skills/om-setup-agent-pipeline/references/trackers/github.md:46`).
