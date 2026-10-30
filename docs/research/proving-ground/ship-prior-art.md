# The ship script — prior art side by side

Read on 2026-10-30 from `references/kcd-skills`, `references/pstack`, `references/open-mercato-skills`
and `references/dw-solo-skills` at `600e4dc`, `1ba91fc`, `fc77110` and `4af64f4`. Paths are relative to
`references/`. Short names in the table: `ship-pr` is
`kcd-skills/skills/autopilot/scripts/ship-pr.mjs`; `babysit`, `shipping` are
`pstack/pstack/skills/poteto-mode/playbooks/*.md`; `policy`, `github`, `cli` are
`pstack/pstack/skills/poteto-mode/scripts/watch-pr/*.ts`; `approve`, `fix`, `continue`, `followup` are
the `SKILL.md` of `open-mercato-skills/skills/om-approve-merge-pr`, `om-auto-fix-pr`,
`om-auto-continue-pr`, `om-followup-issue-from-pr`; `land`, `ship` are
`dw-solo-skills/skills/dw-land/SKILL.md` and `dw-solo-skills/skills/dw-ship/SKILL.md`.

## The steps, four ways

| step              | kcd ship-pr                                                                                                                                               | pstack babysit + watch-pr                                                                                                                                   | open-mercato PR skills                                                                                                                                           | dw-solo dw-land + dw-ship                                                                                       |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| draft             | first open-PR step: `mark-ready`, the script runs `gh pr ready` itself (`ship-pr:230-236, 714-717`)                                                       | a merge gate, exit 6; a draft with pending CI waits first (`policy:166-182`); `--allow-draft` lifts it (`cli:130`)                                          | approve stops and asks (`approve:25`); fix promotes once the loop's exit criteria hold (`fix:59`); a human's ready PR is never demoted (`continue:93`)           | no step: `gh pr create` opens the PR ready (`land:98`)                                                          |
| conflicts         | `fix-conflicts`, to the agent, exit 10 (`ship-pr:237-242, 610-624`)                                                                                       | first blocker, exit 2 (`policy:141-147, 317`); reported, never resolved, the owner rebases (`babysit:10-11`)                                                | approve refuses and offers fix (`approve:26`); fix merges the base in first (`fix:53, 67`)                                                                       | no step                                                                                                         |
| behind base       | `update-branch`, command `gh pr update-branch` returned to the agent (`ship-pr:243-249`; only `mark-ready` and `merge` run in-loop, `714-718`)            | not a blocker: `BEHIND` is "allowed" (`policy:8-32`)                                                                                                        | base-first: merge `origin/$BASE_BRANCH` before review or CI, again when base moves (`fix:53, 65`)                                                                | no step                                                                                                         |
| failing CI        | `fix-ci` with the failed checks, exit 10 (`ship-pr:250-253`)                                                                                              | blocker, exit 4, also when GitHub refuses with `BLOCKED` + failed rollup (`policy:8-32, 155-159`); flake gets one rerun (`babysit:19`)                      | `--ci-only` loop: classify real / test / flake / infra, never weaken a test (`fix:55, 66`); approve refuses a red PR (`approve:50, 81`)                          | ship reads `gh pr checks` and waits, says so (`ship:39-40`)                                                     |
| pending CI        | `wait`, exit 20; `--watch` sleeps 60 s, 60 ticks (`ship-pr:254-256, 699-735`)                                                                             | `WAITING` events, 60 s interval, no deadline unless `--timeout`, exit 5 on it (`cli:110-122`; `policy:499-517`)                                             | report before you wait; every wait capped by `ci.maxWaitMinutes`, default 40 (`fix:47, 68`; `continue:85`)                                                       | land does not wait: "opening the PR is what starts it" (`land:99-100`)                                          |
| review threads    | unresolved, non-outdated threads, 300-char bodies, `address-review`, exit 10 (`ship-pr:172-184, 280-287`); `resolve <threadId>` subcommand (`682-696`)    | second blocker, exit 3 (`policy:148-154, 318`); Bugbot threads tagged, passes counted (`github:329-344, 386-406`); bodies are untrusted data (`babysit:12`) | delegated to `om-auto-review-pr --autofix`, human and bot findings inherited (`fix:55`)                                                                          | no step: the verdict is the agent's own four questions (`land:30-38`)                                           |
| changes requested | `address-review` after threads (`ship-pr:288-293`)                                                                                                        | merge gate, exit 6 (`policy:167-169, 320`)                                                                                                                  | label `changes-requested`: confirm intent or route to fix (`approve:42`)                                                                                         | no step                                                                                                         |
| approval          | per risk tier: no reviewer configured → `park`; reviewer login or check name missing → `wait-for-review`; `humanApprovalFor` → `park` (`ship-pr:257-302`) | owner approval is a wait, never a blocker to fix (`babysit:21`); the `Code Review Gate` check is its own kind (`github:250-270`)                            | approve posts "Approved." (`approve:44`); QA gate `needs-qa` without `qa-approved` refuses; hard blocks `qa-failed`, `do-not-merge`, `blocked` (`approve:30-39`) | the agent's verdict line: ready / ready with follow-ups / not ready (`land:44`)                                 |
| merge             | `gh pr merge <pr> --squash --delete-branch` only with `--merge`, else `ready-to-merge` exit 0 (`ship-pr:303-322`)                                         | babysit never merges (`babysit:21, 23`); shipping merges bottom-up with `gh pr merge --squash` after a PASS verdict (`shipping:5, 8`)                       | squash default, branch deletion on request, no admin override (`approve:47-49, 79`); fix never merges (`fix:71`)                                                 | ship, explicit-invoke only: `gh pr merge --squash --subject`, not `--delete-branch` (`ship:6, 41-44`)           |
| after merge       | `verify-deploy` runs `deployCheck` with `SHIP_PR_SHA`, then `done` (`ship-pr:218-226, 586-602`)                                                           | read the PR back, a merge command can report success when only queued (`shipping:8`); queued watcher `ADVANCE`, `COMPLETE` (`policy:778-804`)               | file the follow-up only after a successful merge (`approve:60, 84`); `PR:` / `Issue:` chaining lines (`approve:54-56`)                                           | remote branch via `gh api DELETE`, worktree removed, `git pull`, residue check (`ship:47-72`)                   |
| follow-ups        | `done` carries "File friction issues (one per durable papercut; search first)" (`ship-pr:425-428`)                                                        | after `READY`, sweep triage decisions into the shared rubric as its own PR (`babysit:21`)                                                                   | unfixed nits become issues, idempotent, @-mention else PR author (`fix:57, 70`; `followup:62-64`)                                                                | done-now vs report-open; a `.ai/backlog/` file only when named; archive to `.ai/archive/` (`land:45-46, 84-91`) |

## kcd ship-pr: one tick, one step

- The order is the header (`ship-pr:2-6`) and `decide()` (`212-323`): merged → closed → draft →
  conflicts → behind → failing → pending → reviewer tier → missing reviewer → threads → changes
  requested → human approval → merge authority → merge. A pure function of a flat state.
- The state comes from one GraphQL query (`84-91`) normalised in `normalize()` (`135-210`): check
  runs and status contexts map to `success | failure | pending | neutral` (`150-171`);
  `approvedByHuman` excludes `[bot]` logins and the configured AI reviewers (`199-207`).
- `--input` takes the state from any host and returns every host action to the caller, "with your
  tools, then run again with fresh state" (`442-468, 630-653`); the `gh` adapter runs `mark-ready`
  and `merge` itself and ticks on (`714-718`), returns `update-branch` (`610-624`).
- Waiting: `--watch [interval]`, default 60 s, at most 60 ticks, sleeps only on `wait` and
  `wait-for-review` (`346-347, 699-735`); refused with `--input` (`401-405`).
- Config: `reviewers.{low,medium,high}`, `humanApprovalFor: ['high']`, `autoMergeFor: ['low']`,
  `mergeMethod: 'squash'`, `deployCheck: null` (`15-21`), read from `.github/ship-pr.json` or
  `ship-pr.json` with whole-line `//` comments (`45-51, 409`). Risk is `--risk`, default `medium`
  (`341, 364-369`).
- Exit codes: 0 done or parked, 10 agent action (`fix-ci`, `fix-conflicts`, `address-review`,
  `deploy-failed`, the host actions), 20 waiting, 30 state needed, 1 error (`9-10, 610-624, 680, 759`).
- Tests (`kcd-skills/test/autopilot-ship-pr.test.mjs`) call `decide` on a flat fixture and
  `normalize` on a GraphQL fixture, no `gh`: comments in config (`57-68`); the check mapping and
  human approval (`70-203`); terminal states (`205-215`); conflicts before behind (`217-239`);
  failing before pending (`241-250`); reviewer by check name (`252-270`); threads before changes
  requested (`324-347`); merge authority never bypasses human approval (`349-391`); auto-merge needs
  `--merge` (`393-419`).
- The skill (`kcd-skills/skills/ship-pr/SKILL.md`, 25 lines) is one command and a risk policy:
  "auto-merge low and medium once CI is green", high waits for Kent (`10-25`). The script's own
  default auto-merges only `low` (`ship-pr:18`); the Kody package the skill calls is not in the
  clone, so which policy runs there is not verified.
- Friction: rung 9, "Agents file friction after every PR with a priority"
  (`kcd-skills/skills/autopilot/SKILL.md:43-44`), labels `friction`, `friction-skipped` (`98-99`);
  the product loop runs "until `ready-to-merge` or `parked`" (`259-260`).

## pstack babysit: a watcher that classifies, a playbook that stops

- Modes: `drive` to merge-ready, `background`, `threads-only`, `check`; default `drive`; small or
  docs-only PRs get `check` (`babysit:7`). `drive` ends at merge-ready; landing is `shipping`
  (`babysit:23`).
- Order "conflicts, then review threads, then CI" (`babysit:11`) is `classifyPr`: conflict, thread,
  CI, gate blocker, then waiting, then ready (`policy:218-236`); a stack is scanned tier-major, so
  an upstack conflict outranks frontier CI (`237-265`; test `policy.test.ts:155-176`).
- The watcher only reads: `gh pr view --json` for facts (`github:474-488`), `gh pr checks --json`
  fast path with a GraphQL rollup fallback (`523-544, 613-634`), paged review threads (`579-586`).
  Readiness is the forge's verdict, not a green list (`babysit:12`; truth table `policy.test.ts:46-70`).
- Verdicts are NDJSON events with `terminal` and `exitCode` (`cli:88`; `types:259-371`): `READY`,
  `STATUS`, `COMPLETE` 0; `BLOCKER` 2 conflicts, 3 threads, 4 checks, 6 gate, 7 status query;
  `TIMEOUT` 5; usage 64 (`cli:182`). Progress: `QUEUE`, `STATUS`, `WAITING`, `ADVANCE`, `RETRY`.
- Waiting: `--interval` 60 s, `--timeout` 0 disables, `--max-query-errors` 5 (`cli:110-128`);
  query backoff `max(interval, 60) * 2^(n-1)`, cap 300 s (`policy:266-269`); the agent runs the
  watcher under `/loop`, re-arms it after each push wave, "Never add a second sleep loop"
  (`babysit:12`). No config file: flags only. Runs on bun with commander (`watch-pr:1`; `cli:2-7`).
- Risk model: never mutate stack topology, a conflict is reported upward (`babysit:10-11`); one
  retry for flake, an identical second failure is not flake, a stale base is checked with
  `git merge-base --is-ancestor` (`babysit:19`); Bugbot claims verified against the code, replies
  posted from a JSON body file, never interpolated (`babysit:20`); security, auth, billing, data,
  migrations escalate (`babysit:20`).
- Tests (`policy.test.ts`) use a fake reader and a fake clock: query planning (`94-153`), draft
  waits then gates (`201-223`), queued cadence and `ADVANCE` (`225-415`), backoff (`417-421`),
  deadline-capped sleeps (`424-452`).
- Shipping adds what a solo loop has no one for: a verifier agent that did not write the code posts
  `PASS`; green CI and bot approval are not verdicts (`shipping:5`); verdicts are re-checked by
  `git patch-id` after a rebase (`shipping:7`).

## open-mercato: a merge-ready skill, a merge skill, and labels between them

- `om-auto-fix-pr` drives to merge-ready and "never merges itself" (`fix:3, 13-14, 71`);
  `om-approve-merge-pr` approves and squash-merges, "one of the QA gate's enforcement points"
  (`approve:8`); `om-auto-continue-pr` resumes an unfinished PR from its plan, adopting one with no
  plan (`continue:8-10`); `om-followup-issue-from-pr` turns a comment into an issue (`followup:8-11`).
- Fixable blockers route, never dead-end: red checks → `om-auto-fix-pr --ci-only`, conflicts or
  review → the full loop; hard label blocks and the QA gate "need humans" (`approve:81`).
- Config in `.ai/agentic.config.json`: `BASE_BRANCH`, `LABELS_ENABLED`, `QA_GATE`,
  `ci.maxWaitMinutes`, `validation.commands` (`fix:47`), `engine.loopStepThreshold` (`continue:28`);
  a tracker descriptor abstracts GitHub, GitLab and Forgejo (`approve:21`; `followup:17-23`).
- Team machinery a solo loop drops: the three-signal claim (`in-progress` label, another assignee,
  a 🤖 comment under 30 minutes), `--force`, a 60-minute stale rule, release in a `trap`
  (`continue:30`; `fix:49`); pipeline labels `in-progress`, `merge-queue`, `needs-qa`,
  `qa-approved`, `ci-monitoring`, `qa` (`approve:29-42`; `fix:59`); the QA head SHA check against
  `headRefOid` (`approve:40`); fork supersede and credit (`fix:69`); isolated worktrees under
  `.ai/tmp/` (`fix:51`); self-approval rejection (`approve:45`); a report template with chaining
  lines (`approve:54-56`).
- Waits are prose, not code: "Report before you wait; bound the wait" (`fix:68`), "Reporting
  never waits for CI" (`continue:85`), `ci-monitoring` while a CI follow-up is owed (`fix:59`).
  No exit codes; the `references/` dir of each skill holds only markdown, no tests.
- Follow-ups: nits, low severity and out-of-scope findings become issues, idempotent (`fix:57, 70`);
  an explicit @-mention wins, else the PR author (`followup:62-64, 93`); a non-actionable comment is
  asked about, never invented (`followup:96`); a design doc gets an `Implement:` issue after a
  dedupe search (`followup:53-56, 79-85`).

## dw-land: the verdict and the close, the merge one skill later

- Two phases gated by the user's word: a verdict over the diff (correct, fits, blast radius, done
  proven, `land:30-38`), then on a go the close and the PR (`land:50-106`). The completion gate
  reads `## Goal` against the diff; "not ready" is never "ready with follow-ups" (`land:40-42`).
- It never merges (`land:113-114`); `dw-ship` does, explicit-invoke only, one decision, the squash
  (`ship:6, 9-11`). `dw-ship` reads the checks and waits (`ship:39-40`), merges with
  `--squash --subject`, deletes the remote branch with `gh api DELETE` after leaving the worktree
  (`ship:41-44, 60-64`), pulls, and removes replayed `.ai/work/` or `.ai/backlog/` residue (`ship:68-72`).
- No PR-state step exists between the two: no draft, conflicts, behind, threads or approval.
- Landing promotes what the user names: decisions judged on three legs, hard to reverse,
  surprising, a real trade-off, "Most changes produce zero records"
  (`dw-solo-skills/skills/dw-land/references/decision-record.md:6-15`); a term into `CONTEXT.md`;
  a gotcha as one bullet (`land:57-81`).
- Follow-ups are sorted done-now or report-open; report-open lines go under `## What changes` of
  the PR body (`land:45-46, 104-105`); a `.ai/backlog/<date>-<slug>.md` with `created:`, `source:`,
  `why-not-now:`, `effort:` only when the user names it, and `git rm` for one the diff completed
  (`land:84-86`).
- The archive: `git mv .ai/work/<date>-<slug>/ .ai/archive/<today>-<slug>/`, `status: landed`,
  the doc trimmed to frontmatter, H1 and the `You get:` line, one commit with the corpus baseline
  (`land:87-94`); `reject` archives a turned-down idea with `## Why rejected` (`land:123-126`).
- What this repo does not carry from it: the change doc and its archive (`docs/specs/` records a
  built feature, new work is a GitHub Issue, `AGENTS.md:42-44`), the backlog files (`ideas/` is
  local-only and never pointed at, `AGENTS.md:50, 59`); the three legs stay, as `docs/adr/`
  (`AGENTS.md:39-40`). The eval records the routing pain: the end-of-loop skill names every loop
  noun and stole `dw-shape`'s writeup prompt (`dw-solo-skills/evals/cases/dw-land.json:3, 29-33`).

## Choices the design ticket has to make

- Order: kcd puts draft and conflicts before CI and review before approval; pstack puts conflicts,
  threads, CI, then gates; open-mercato merges the base before anything. Which order, and whether
  `behind` is a step (kcd) or ignored (pstack).
- Host actions: kcd runs `mark-ready` and `merge` in-loop and hands `update-branch` back. The map
  says the script performs all three; `gh pr update-branch` starts a new CI run, so it has to be
  followed by a `wait`, not a `merge`.
- `pr.merge: ask`: kcd's shape is `ready-to-merge` exit 0 without `--merge`, re-run with it. Does
  `ask` return that step for the agent to put to the human, and does `auto` still need a flag.
- Draft: mark ready at once (kcd) or only once CI is green (pstack waits on a draft first, om
  promotes at the exit criteria). A draft that stays a draft hides a half-done PR (om `continue:95`).
- Branch deletion: kcd's merge carries `--delete-branch`; dw-ship deletes via `gh api` after
  leaving the worktree; the guard refuses `gh pr merge --delete-branch`
  (`plugins/sdlc/hooks/block-dangerous-commands.sh:297`). An `after-merge` step, or no deletion.
- Waiting: inside the script (kcd `--watch`, pstack interval with backoff and a deadline) or exit
  20 and let the agent re-run. A cap on ticks, and what the JSON says on the cap.
- Threads: what the payload carries (kcd: id, path, line, author, 300 chars; pstack: bot flag and
  pass count, bodies untrusted), whether the script resolves a thread, whether a bot's
  `CHANGES_REQUESTED` counts in a solo repo with no required reviewer.
- Approval in a solo repo: kcd parks `medium` with no reviewer configured. With `pr.merge: auto` and
  no reviewers, is approval a step at all, and what does `reviewDecision` mean then.
- Failing CI: the agent judges (kcd), or the script reruns a failed job once and treats an identical
  second failure as real (pstack `babysit:19`, om `fix:55`).
- Exit codes: a few classes (kcd 0/10/20/30/1) or one per blocker (pstack 2/3/4/5/6/7), and whether
  progress lines are emitted while waiting.
- Done: merged only (the map) or a verification after (kcd `deployCheck`, pstack shipping reads
  the PR back, dw-ship pulls and tears down). What `done` carries for follow-ups: kcd's one
  reminder line, om's filed issues, dw-land's report-open lines in the PR body.
- Tests: `decide(state)` and the normaliser as pure functions on a flat fixture (kcd), plus the
  wait loop under a fake clock (pstack), or the first only.
