// `dw-sdlc pr ship` while CI runs: the recheck of a `ci-pending` wait follows how long CI took on the heads
// of the repository's last merged pull requests, less the time this head's CI has run, within a floor and
// a ceiling.

import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { COMMITTED_FILE } from "../../src/agentic-config.ts"
import { repo, runInProcess } from "../harness.ts"
import { type Context, fakeGh, GREEN, type Pr, RUN, served } from "../pr-harness.ts"

const TARGET = ["40", "-R", "byarcadia-app/foundation"]
const STARTED = "2026-10-31T11:01:00Z"
const REVIEWED: Context = { kind: "status", name: "dw-sdlc/review", state: "SUCCESS", startedAt: STARTED }
/** Reviewed, its one required check running since STARTED. */
const PENDING: Pr = {
  ...GREEN,
  mergeStateStatus: "BLOCKED",
  checks: [
    { kind: "run", name: "Check", state: "IN_PROGRESS", link: RUN, startedAt: STARTED, required: true },
    REVIEWED
  ]
}

/** A CheckRun on a merged head that ran `seconds` from 10:00, named `name`. */
function ran(seconds: number, name = "Check"): Context {
  const start = Date.parse("2026-10-30T10:00:00Z")
  return {
    kind: "run",
    name,
    state: "SUCCESS",
    startedAt: new Date(start).toISOString(),
    completedAt: new Date(start + seconds * 1000).toISOString()
  }
}

/**
 * The recheck `pr ship` answers on PENDING, `elapsed` seconds after its check started, CI on the merged
 * heads as given and `before` beside its check.
 */
function recheckOf(merged: Context[][], elapsed: number, before: Context[] = []): unknown {
  const gh = fakeGh({ graphql: [served({ ...PENDING, checks: [...before, ...PENDING.checks], merged })] })
  const now = new Date(Date.parse(STARTED) + elapsed * 1000).toISOString()
  const files = { [COMMITTED_FILE]: { pr: { review: "full" } } }
  const run = runInProcess(["pr", "ship", ...TARGET, "--json"], repo({ files }), { ...gh.env, DW_SDLC_NOW: now })
  assert.equal(run.status, 20, run.stdout + run.stderr)
  const answer = JSON.parse(run.stdout) as Record<string, unknown>
  assert.equal(answer.reason, "ci-pending")
  return answer.recheckAfter
}

describe("dw-sdlc pr ship while CI runs", () => {
  it("rechecks 60 s on when no merged pull request shows how long CI takes", () => {
    assert.equal(recheckOf([], 10), 60)
    assert.equal(recheckOf([[], [REVIEWED]], 10), 60, "a merged head with no CheckRun shows nothing")
  })

  it("rechecks when CI usually ends: the median of the merged heads' runs, less the time this one has run", () => {
    assert.equal(recheckOf([[ran(240)], [ran(300)], [ran(360)]], 60), 240)
    assert.equal(recheckOf([[ran(200)], [ran(300)], [ran(500)], [ran(900)]], 100), 400, "the higher middle of four")
  })

  it("times a merged head from its first start to its last completion, its own dw-sdlc statuses left out", () => {
    const late: Context = { ...ran(30, "Lint"), startedAt: "2026-10-30T10:02:00Z", completedAt: "2026-10-30T10:05:00Z" }
    const own: Context = { ...ran(3600, "dw-sdlc/gate") }
    assert.equal(recheckOf([[ran(60), late, own]], 0), 300)
  })

  it("times this head as a merged one, from the first start among its checks, a job done before the pending one", () => {
    const build: Context = {
      kind: "run",
      name: "Build",
      state: "SUCCESS",
      link: RUN,
      startedAt: "2026-10-31T11:00:00Z"
    }
    assert.equal(recheckOf([[ran(300)]], 60, [build]), 180)
  })

  it("keeps the recheck within 60 s and 600 s, no more often than a minute once CI runs past its usual time", () => {
    assert.equal(recheckOf([[ran(300)]], 290), 60, "CI past its usual time")
    assert.equal(recheckOf([[ran(1800)]], 60), 600, "a CI of half an hour")
  })
})
