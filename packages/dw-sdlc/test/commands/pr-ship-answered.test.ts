// `dw-sdlc pr ship` on a pull request whose review requests changes: while the review is unanswered the
// agent's turn, once a push answers it the reviewer's.

import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { COMMITTED_FILE } from "../../src/agentic-config.ts"
import { repo, runBin } from "../harness.ts"
import {
  BASE_OID,
  type Context,
  fakeGh,
  GREEN,
  HEAD,
  type Pr,
  type Response,
  RUN,
  served,
  type Thread
} from "../pr-harness.ts"

const URL = "https://github.com/byarcadia-app/foundation/pull/40"
const TARGET = ["40", "-R", "byarcadia-app/foundation", "--json"]
const FULL = { [COMMITTED_FILE]: { pr: { review: "full" } } }
const STARTED = "2026-10-31T11:01:00Z"
const READ_BY_REVIEW = "1111111111111111111111111111111111111111"
const PUSHED = "2222222222222222222222222222222222222222"
const MERGED_IN = "3333333333333333333333333333333333333333"

const PASSING: Context = { kind: "run", name: "Check", state: "SUCCESS", link: RUN, startedAt: STARTED }
const REVIEWED: Context = {
  kind: "status",
  name: "dw-sdlc/review",
  state: "SUCCESS",
  startedAt: "2026-10-31T11:05:00Z"
}
const THREAD: Thread = {
  id: "PRRT_kwDOexample",
  path: "packages/payments/src/paywall.tsx",
  line: 42,
  author: "dominikwozniak",
  body: "This hook re-renders on every purchase event; memoise the offerings.",
  lastByViewer: true
}

/** The compare that judges the head behind: it finds it lacks none of its base. */
const BEHIND: Record<string, Response> = {
  [["api", `repos/byarcadia-app/foundation/compare/${BASE_OID}...${HEAD}?per_page=1`].join(" ")]: {
    stdout: JSON.stringify({ status: "ahead", ahead_by: 1, behind_by: 0 })
  }
}

/** Changes requested by alice on READ_BY_REVIEW, answered by the push of the head, CI green and the head reviewed. */
const ANSWERED: Pr = {
  ...GREEN,
  checks: [PASSING, REVIEWED],
  reviewDecision: "CHANGES_REQUESTED",
  reviews: [{ author: "alice", state: "CHANGES_REQUESTED", commit: READ_BY_REVIEW }],
  history: [{ oid: READ_BY_REVIEW }]
}

/** The answer's document for `pr`, the script's clock `seconds` after STARTED. */
function answer(pr: Pr, seconds = 0) {
  const now = new Date(Date.parse(STARTED) + seconds * 1000).toISOString()
  const gh = fakeGh({ graphql: [served(pr)], commands: BEHIND })
  const run = runBin(["pr", "ship", ...TARGET], repo({ files: FULL }), { ...gh.env, DW_SDLC_NOW: now })
  assert.notEqual(run.stdout, "", `no document; exit ${run.status}: ${run.stderr}`)
  return { status: run.status, stderr: run.stderr, document: JSON.parse(run.stdout) as Record<string, unknown> }
}

/** The actions of the document's blockers, in order. */
function blockersOf({ blockers }: Record<string, unknown>): unknown[] {
  assert.ok(Array.isArray(blockers))
  return blockers.map((blocker: { action: unknown }) => blocker.action)
}

describe("dw-sdlc pr ship once a push answers a review that requests changes", () => {
  it("parks for the reviewer, no command, the reason naming who asked", () => {
    const run = answer(ANSWERED)
    assert.equal(run.status, 30, run.stderr)
    assert.deepEqual(run.document, {
      pr: URL,
      head: HEAD,
      base: "main",
      status: "park",
      action: "awaiting-review",
      actor: "dev",
      reason: "changes requested by alice, answered by a push: the next review is the reviewer's",
      blockers: [],
      performed: []
    })
  })

  it("names every reviewer who asked", () => {
    const run = answer({
      ...ANSWERED,
      reviews: [
        { author: "alice", state: "CHANGES_REQUESTED", commit: READ_BY_REVIEW },
        { author: null, state: "CHANGES_REQUESTED", commit: READ_BY_REVIEW }
      ]
    })
    assert.equal(run.status, 30, run.stderr)
    assert.equal(
      run.document.reason,
      "changes requested by alice and ghost, answered by a push: the next review is the reviewer's"
    )
  })

  it("keeps the act while the head is still the commit the review read", () => {
    const review = { author: "alice", state: "CHANGES_REQUESTED", commit: HEAD }
    const run = answer({ ...ANSWERED, history: [], reviews: [review] })
    assert.equal(run.status, 10, run.stderr)
    assert.deepEqual([run.document.action, run.document.reason], ["address-review", "changes requested"])
  })

  it("keeps the act when only merge commits follow the commit the review read", () => {
    const run = answer({
      ...ANSWERED,
      history: [{ oid: READ_BY_REVIEW }, { oid: MERGED_IN, parents: 2 }],
      headParents: 2
    })
    assert.equal(run.status, 10, run.stderr)
    assert.equal(run.document.action, "address-review")
  })

  it("parks once a non-merge commit follows, a merge among the commits after it too", () => {
    const run = answer({
      ...ANSWERED,
      history: [{ oid: READ_BY_REVIEW }, { oid: PUSHED }, { oid: MERGED_IN, parents: 2 }],
      headParents: 2
    })
    assert.equal(run.status, 30, run.stderr)
    assert.equal(run.document.action, "awaiting-review")
  })

  it("keeps the act when the review's commit is not in the history, or the review names none", () => {
    for (const commit of [PUSHED, null]) {
      const run = answer({ ...ANSWERED, reviews: [{ author: "alice", state: "CHANGES_REQUESTED", commit }] })
      assert.equal(run.status, 10, `${commit}: ${run.stderr}`)
      assert.equal(run.document.action, "address-review", String(commit))
    }
  })

  it("keeps the act while one of two reviewers asking for changes is unanswered", () => {
    const run = answer({
      ...ANSWERED,
      reviews: [
        { author: "alice", state: "CHANGES_REQUESTED", commit: READ_BY_REVIEW },
        { author: "bob", state: "CHANGES_REQUESTED", commit: HEAD }
      ]
    })
    assert.equal(run.status, 10, run.stderr)
    assert.equal(run.document.action, "address-review")
  })

  it("keeps the act when the decision requests changes and no review in the reply does", () => {
    const run = answer({ ...ANSWERED, reviews: [{ author: "alice", state: "COMMENTED", commit: READ_BY_REVIEW }] })
    assert.equal(run.status, 10, run.stderr)
    assert.equal(run.document.action, "address-review")
  })

  it("lets awaiting-reply lead, awaiting-review riding in blockers", () => {
    const run = answer({ ...ANSWERED, threads: [THREAD] })
    assert.equal(run.status, 30, run.stderr)
    assert.equal(run.document.action, "awaiting-reply")
    assert.deepEqual(blockersOf(run.document), ["awaiting-review"])
  })

  it("runs the pull request's own Review and CI first", () => {
    const unreviewed = answer({ ...ANSWERED, checks: [PASSING] })
    assert.equal(unreviewed.status, 10, unreviewed.stderr)
    assert.equal(unreviewed.document.action, "review")
    assert.deepEqual(blockersOf(unreviewed.document), ["awaiting-review"])
    const running: Context = { ...PASSING, state: "IN_PROGRESS" }
    const pending = answer({ ...ANSWERED, checks: [running, REVIEWED] }, 60)
    assert.equal(pending.status, 20, pending.stderr)
    assert.equal(pending.document.action, "wait")
    assert.deepEqual(blockersOf(pending.document), ["awaiting-review"])
  })
})
