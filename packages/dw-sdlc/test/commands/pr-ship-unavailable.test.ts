// `dw-sdlc pr ship` when CI is unavailable: GitHub ran no job on the head, as under a billing lock. With
// gate.steps the agent proves the head with `dw-sdlc gate --mark`, and a Gate mark on the head lets the
// pull request merge as green CI does; without gate.steps the merge is the dev's.

import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { COMMITTED_FILE } from "../../src/agentic-config.ts"
import { repo, runInProcess } from "../harness.ts"
import { type Context, fakeGh, GREEN, HEAD, type Pr, RUN, served } from "../pr-harness.ts"

const TARGET = ["40", "-R", "byarcadia-app/foundation", "--json"]
const MERGE = ["pr", "merge", "40", "-R", "byarcadia-app/foundation", "--squash", "--match-head-commit", HEAD]
const DEV_MERGE = `gh pr merge 40 --squash --match-head-commit ${HEAD}`
const GATED = { [COMMITTED_FILE]: { pr: { merge: "auto", review: "full" }, gate: { steps: ["pnpm test"] } } }
const UNGATED = { [COMMITTED_FILE]: { pr: { merge: "auto", review: "full" } } }

/** A job GitHub refused to start: failed at once, no step run, as a billing lock leaves it. */
const REFUSED: Context = {
  kind: "run",
  name: "Check / Check",
  state: "FAILURE",
  link: RUN,
  startedAt: "2026-10-31T11:01:00Z",
  steps: 0
}
const REVIEWED: Context = { kind: "status", name: "dw-sdlc/review", state: "SUCCESS" }
const MARKED: Context = { kind: "status", name: "dw-sdlc/gate", state: "SUCCESS" }

function ship(pr: Pr, files: Record<string, object>, now = "2026-10-31T11:10:00Z", more: Pr[] = []) {
  const gh = fakeGh({ graphql: [pr, ...more].map(served) })
  const run = runInProcess(["pr", "ship", ...TARGET], repo({ files }), { ...gh.env, DW_SDLC_NOW: now })
  assert.notEqual(run.stdout, "", `no document; exit ${run.status}: ${run.stderr}`)
  return { status: run.status, answer: JSON.parse(run.stdout) as Record<string, unknown>, calls: gh.calls() }
}

describe("dw-sdlc pr ship when CI is unavailable", () => {
  it("hands a head whose job GitHub refused to start to the agent, to prove with the Gate", () => {
    const run = ship({ ...GREEN, checks: [REFUSED, REVIEWED] }, GATED)
    assert.equal(run.status, 10)
    assert.deepEqual(
      [run.answer.status, run.answer.action, run.answer.actor, run.answer.command],
      ["act", "prove-locally", "agent", "dw-sdlc gate --mark"]
    )
    assert.equal(run.answer.reason, "CI unavailable on e36732e: Check / Check ran no step")
  })

  it("merges a head whose Gate mark stands in for the job GitHub refused to start, as it merges green CI", () => {
    const pr = { ...GREEN, checks: [REFUSED, REVIEWED, MARKED] }
    const run = ship(pr, GATED, undefined, [{ ...pr, state: "MERGED", mergeable: "UNKNOWN" }])
    assert.equal(run.status, 0)
    assert.deepEqual([run.answer.status, run.answer.action], ["done", "done"])
    assert.ok(
      run.calls.some((call) => call.join(" ") === MERGE.join(" ")),
      JSON.stringify(run.calls)
    )
  })

  it("leaves the merge to the dev in a repository with no gate.steps to prove the head", () => {
    const run = ship({ ...GREEN, checks: [REFUSED, REVIEWED] }, UNGATED)
    assert.equal(run.status, 30)
    assert.deepEqual(run.answer, {
      pr: "https://github.com/byarcadia-app/foundation/pull/40",
      head: HEAD,
      base: "main",
      status: "park",
      action: "ci-unavailable",
      actor: "dev",
      reason:
        "CI unavailable on e36732e: Check / Check ran no step: no gate.steps to prove it, so the merge is the dev's",
      command: DEV_MERGE,
      blockers: [],
      performed: []
    })
  })

  it("hands a real failure beside a refused job to the agent to fix, the refused job left out", () => {
    const failed: Context = { ...REFUSED, name: "Test", steps: 4 }
    const run = ship({ ...GREEN, checks: [REFUSED, failed, REVIEWED, MARKED] }, GATED)
    assert.equal(run.status, 10)
    assert.equal(run.answer.action, "fix-ci")
    assert.deepEqual(
      (run.answer.details as { checks: { name: string }[] }).checks.map(({ name }) => name),
      ["Test"]
    )
  })

  it("takes a failed check of another app, which reports no steps, as a failure", () => {
    const other: Context = { ...REFUSED, link: "https://app.circleci.com/pipelines/github/byarcadia-app/foundation/7" }
    const run = ship({ ...GREEN, checks: [other, REVIEWED] }, GATED)
    assert.equal(run.answer.action, "fix-ci")
  })

  it("hands a head no check reported on past the grace to the agent to prove, under gate.steps", () => {
    const run = ship({ ...GREEN, checks: [REVIEWED] }, GATED, "2026-10-31T11:02:01Z")
    assert.deepEqual(
      [run.answer.action, run.answer.reason, run.answer.command],
      ["prove-locally", "no check reported on e36732e within 120 s of its commit or its ready", "dw-sdlc gate --mark"]
    )
  })

  it("hands a job that never started past the budget to the agent to prove, and waits on it within it", () => {
    const queued: Context = { kind: "run", name: "Check", state: "QUEUED", link: RUN, startedAt: null }
    const pr = { ...GREEN, checks: [queued, REVIEWED] }
    assert.equal(ship(pr, GATED, "2026-10-31T11:30:00Z").answer.reason, "ci-pending")
    const late = ship(pr, GATED, "2026-10-31T11:41:00Z")
    assert.deepEqual(
      [late.answer.action, late.answer.reason],
      ["prove-locally", "CI unavailable on e36732e: Check never started within 40 min"]
    )
  })

  it("merges a head no check reported on once its Gate mark stands in", () => {
    const pr = { ...GREEN, checks: [REVIEWED, MARKED] }
    const run = ship(pr, GATED, "2026-10-31T11:10:00Z", [{ ...pr, state: "MERGED", mergeable: "UNKNOWN" }])
    assert.equal(run.answer.status, "done")
  })
})
