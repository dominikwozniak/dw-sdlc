// `dw-sdlc pr ship` when CI is unavailable: a job GitHub never ran on the head, as under a billing lock.
// Under pr.ciUnavailable gate the agent proves the head with `dw-sdlc gate --mark` and its Gate mark lets
// the pull request merge as green CI does; under the default ci every decision is the one it was.

import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { COMMITTED_FILE } from "../../src/agentic-config.ts"
import { repo, runInProcess } from "../harness.ts"
import { type Context, fakeGh, GREEN, HEAD, type Pr, RUN, served } from "../pr-harness.ts"

const TARGET = ["40", "-R", "byarcadia-app/foundation", "--json"]
const MERGE = ["pr", "merge", "40", "-R", "byarcadia-app/foundation", "--squash", "--match-head-commit", HEAD]
const DEV_MERGE = `gh pr merge 40 --squash --match-head-commit ${HEAD}`
const PR = { merge: "auto", ciUnavailable: "gate" }
const GATED = { [COMMITTED_FILE]: { pr: PR, gate: { steps: ["pnpm test"] } } }
const UNGATED = { [COMMITTED_FILE]: { pr: PR } }
const DEFAULT = { [COMMITTED_FILE]: { pr: { merge: "auto" }, gate: { steps: ["pnpm test"] } } }

/** A job GitHub refused to start: failed at once, no step run, as a billing lock leaves it. */
const REFUSED: Context = {
  kind: "run",
  name: "Check / Check",
  state: "FAILURE",
  link: RUN,
  startedAt: "2026-10-31T11:01:00Z",
  steps: 0
}
const MARKED: Context = { kind: "status", name: "dw-sdlc/gate", state: "SUCCESS" }

function ship(pr: Pr, files: Record<string, object>, now = "2026-10-31T11:10:00Z", more: Pr[] = []) {
  const gh = fakeGh({ graphql: [pr, ...more].map(served) })
  const run = runInProcess(["pr", "ship", ...TARGET], repo({ files }), { ...gh.env, DW_SDLC_NOW: now })
  assert.notEqual(run.stdout, "", `no document; exit ${run.status}: ${run.stderr}`)
  return { status: run.status, answer: JSON.parse(run.stdout) as Record<string, unknown>, calls: gh.calls() }
}

describe("dw-sdlc pr ship when CI is unavailable", () => {
  it("hands a head whose job GitHub refused to start to the agent, to prove with the Gate", () => {
    const run = ship({ ...GREEN, checks: [REFUSED] }, GATED)
    assert.equal(run.status, 10)
    assert.deepEqual(
      [run.answer.status, run.answer.action, run.answer.actor, run.answer.next],
      [
        "act",
        "prove-locally",
        "agent",
        [
          { by: "agent", run: "dw-sdlc gate --mark" },
          { by: "agent", do: "red: fix what it printed, then git push" }
        ]
      ]
    )
    assert.equal(run.answer.reason, "CI unavailable on e36732e: Check / Check ran no step")
  })

  it("merges a head whose Gate mark stands in for the job GitHub refused to start, as it merges green CI", () => {
    const pr = { ...GREEN, checks: [REFUSED, MARKED] }
    const run = ship(pr, GATED, undefined, [{ ...pr, state: "MERGED", mergeable: "UNKNOWN" }])
    assert.equal(run.status, 0)
    assert.deepEqual([run.answer.status, run.answer.action], ["done", "done"])
    assert.ok(
      run.calls.some((call) => call.join(" ") === MERGE.join(" ")),
      JSON.stringify(run.calls)
    )
  })

  it("leaves the merge to the dev in a repository with no gate.steps to prove the head", () => {
    const run = ship({ ...GREEN, checks: [REFUSED] }, UNGATED)
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
      next: [{ by: "dev", run: DEV_MERGE }],
      blockers: [],
      performed: []
    })
  })

  it("hands a real failure beside a refused job to the agent to fix, the refused job left out", () => {
    const failed: Context = { ...REFUSED, name: "Test", steps: 4 }
    const run = ship({ ...GREEN, checks: [REFUSED, failed, MARKED] }, GATED)
    assert.equal(run.status, 10)
    assert.equal(run.answer.action, "fix-ci")
    assert.deepEqual(
      (run.answer.details as { checks: { name: string }[] }).checks.map(({ name }) => name),
      ["Test"]
    )
  })

  it("takes a failed check of another app, which reports no steps, as a failure", () => {
    const other: Context = { ...REFUSED, link: "https://app.circleci.com/pipelines/github/byarcadia-app/foundation/7" }
    const run = ship({ ...GREEN, checks: [other] }, GATED)
    assert.equal(run.answer.action, "fix-ci")
  })

  it("hands a refused job to the agent to fix under the default ci, gate.steps or not", () => {
    const run = ship({ ...GREEN, checks: [REFUSED, MARKED] }, DEFAULT)
    assert.deepEqual([run.status, run.answer.action], [10, "fix-ci"])
  })

  it("parks a head no check reported on as unverified under gate, a Gate mark on it or not", () => {
    for (const checks of [[], [MARKED]]) {
      const run = ship({ ...GREEN, checks }, GATED, "2026-10-31T11:02:01Z")
      assert.deepEqual([run.answer.status, run.answer.action], ["park", "unverified"])
    }
  })

  it("parks a job that never started past the budget as ci-stuck under gate", () => {
    const queued: Context = { kind: "run", name: "Check", state: "QUEUED", link: RUN, startedAt: null }
    const run = ship({ ...GREEN, checks: [queued, MARKED] }, GATED, "2026-10-31T11:41:00Z")
    assert.deepEqual([run.answer.status, run.answer.action], ["park", "ci-stuck"])
  })

  it("waits on a job still running beside a refused one, once the Gate mark stands in for the refused one", () => {
    const running: Context = {
      kind: "run",
      name: "Lint",
      state: "IN_PROGRESS",
      link: RUN,
      startedAt: "2026-10-31T11:02:00Z"
    }
    const before = ship({ ...GREEN, checks: [REFUSED, running] }, GATED)
    assert.equal(before.answer.action, "prove-locally")
    const after = ship({ ...GREEN, checks: [REFUSED, running, MARKED] }, GATED)
    assert.deepEqual([after.answer.status, after.answer.reason], ["wait", "ci-pending"])
  })
})
