// `dw-sdlc pr ship` on a reviewed draft of the viewer that no check has reported on: a draft starts no
// run, so waiting on one only parks it as unverified. The script marks it ready, and the run ready
// starts is what the head then waits for.

import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { COMMITTED_FILE } from "../../src/agentic-config.ts"
import { repo, runBin } from "../harness.ts"
import { BASE_OID, type Context, fakeGh, GREEN, HEAD, type Pr, type Response, served } from "../pr-harness.ts"

const TARGET = ["40", "-R", "byarcadia-app/foundation"]
const READY = ["pr", "ready", "40", "-R", "byarcadia-app/foundation"]
const AUTO = { [COMMITTED_FILE]: { pr: { merge: "auto", review: "full" } } }

/** The compare that judges the head behind: it finds it lacks none of its base. */
const AHEAD: Record<string, Response> = {
  [["api", `repos/byarcadia-app/foundation/compare/${BASE_OID}...${HEAD}?per_page=1`].join(" ")]: {
    stdout: JSON.stringify({ status: "ahead", behind_by: 0, files: [] })
  }
}

/** The script's own review marker on the head: a context, never a check. */
const REVIEWED: Context = {
  kind: "status",
  name: "dw-sdlc/review",
  state: "SUCCESS",
  startedAt: "2026-10-31T11:05:00Z"
}
/** Reviewed, and no check reported on the head, committed at 11:00. */
const UNCHECKED: Pr = { ...GREEN, checks: [REVIEWED] }

/** The time `seconds` after the head's commit, as an ISO 8601 time. */
function after(seconds: number): string {
  return new Date(Date.parse(GREEN.committedAt) + seconds * 1000).toISOString()
}

function ship(graphql: Response[], now: string) {
  const gh = fakeGh({ graphql, commands: AHEAD })
  const run = runBin(["pr", "ship", ...TARGET, "--json"], repo({ files: AUTO }), { ...gh.env, DW_SDLC_NOW: now })
  const answer = run.stdout === "" ? {} : (JSON.parse(run.stdout) as Record<string, unknown>)
  return { ...run, answer, calls: gh.calls() }
}

describe("dw-sdlc pr ship on a reviewed draft no check has reported on", () => {
  it("marks it ready within the grace and past it, then waits for the run ready starts", () => {
    for (const seconds of [5, 60, 121, 3600]) {
      const readied = { ...UNCHECKED, readyAt: after(seconds) }
      const run = ship([served({ ...UNCHECKED, draft: true }), served(readied)], after(seconds))
      assert.equal(run.status, 20, `${seconds} s: ${run.stderr}`)
      assert.equal(run.answer.status, "wait", `${seconds} s`)
      assert.equal(run.answer.reason, "unverified", `${seconds} s`)
      const performed = run.answer.performed as { action: string }[]
      assert.deepEqual(
        performed.map(({ action }) => action),
        ["mark-ready"]
      )
      assert.ok(
        run.calls.some((call) => call.join(" ") === READY.join(" ")),
        `${seconds} s: no gh pr ready in ${JSON.stringify(run.calls)}`
      )
    }
  })

  it("keeps the unverified rule for a head that is not a draft", () => {
    const waiting = ship([served(UNCHECKED)], after(60))
    assert.equal(waiting.status, 20, waiting.stderr)
    assert.deepEqual([waiting.answer.status, waiting.answer.reason], ["wait", "unverified"])
    const parked = ship([served(UNCHECKED)], after(121))
    assert.equal(parked.status, 30, parked.stderr)
    assert.deepEqual([parked.answer.status, parked.answer.action], ["park", "unverified"])
  })
})
