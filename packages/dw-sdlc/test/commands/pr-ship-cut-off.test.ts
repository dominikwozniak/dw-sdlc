// `dw-sdlc pr ship` on a pull request with more checks or threads than its one read holds: a failure
// past the read shows in no row of the decision, so the merge stays the dev's.

import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { COMMITTED_FILE } from "../../src/agentic-config.ts"
import { repo, runBin } from "../harness.ts"
import { fakeGh, GREEN, HEAD, type Pr, RUN, served } from "../pr-harness.ts"

const AUTO = { [COMMITTED_FILE]: { pr: { merge: "auto", review: "full" } } }
const COMMAND = `gh pr merge 40 --squash --match-head-commit ${HEAD}`
function ship(pr: Pr, args: string[] = []) {
  const gh = fakeGh({ graphql: [served(pr)] })
  const run = runBin(
    ["pr", "ship", "40", "-R", "byarcadia-app/foundation", "--json", ...args],
    repo({ files: AUTO }),
    gh.env
  )
  return {
    ...run,
    calls: gh.calls(),
    answer: run.stdout === "" ? {} : (JSON.parse(run.stdout) as Record<string, unknown>)
  }
}

function assertParked(pr: Pr, reason: string, args: string[] = []): void {
  const run = ship(pr, args)
  assert.equal(run.status, 30, run.stderr)
  const { status, action, actor, reason: said, command } = run.answer
  assert.deepEqual(
    { status, action, actor, reason: said, command },
    { status: "park", action: "partial-read", actor: "dev", reason, command: COMMAND }
  )
  assert.ok(!run.calls.some(([first, second]) => first === "pr" && second === "merge"), "the script did not merge")
}

describe("dw-sdlc pr ship on a pull request its read does not hold whole", () => {
  it("parks instead of merging when more checks follow the ones read", () => {
    assertParked({ ...GREEN, moreChecks: true }, "the read holds only the first 50 checks: the merge is the dev's")
  })

  it("parks instead of merging when more threads follow the ones read", () => {
    assertParked({ ...GREEN, moreThreads: true }, "the read holds only the first 100 threads: the merge is the dev's")
  })

  it("names both lists when both are cut off", () => {
    assertParked(
      { ...GREEN, moreChecks: true, moreThreads: true },
      "the read holds only the first 50 checks and the first 100 threads: the merge is the dev's"
    )
  })

  it("parks under --merge too: the flag says who merges, not that the read is whole", () => {
    assertParked({ ...GREEN, moreChecks: true }, "the read holds only the first 50 checks: the merge is the dev's", [
      "--merge"
    ])
  })

  it("answers the failure it does see first, the cut-off riding in the blockers", () => {
    const failing = {
      kind: "run",
      name: "Lint",
      state: "FAILURE",
      link: RUN,
      startedAt: "2026-10-31T11:02:00Z"
    } as const
    const run = ship({ ...GREEN, moreChecks: true, checks: [...GREEN.checks, failing] })
    assert.equal(run.status, 10, run.stderr)
    assert.equal(run.answer.action, "fix-ci")
    assert.deepEqual(run.answer.blockers, [
      {
        action: "partial-read",
        actor: "dev",
        reason: "the read holds only the first 50 checks: the merge is the dev's"
      }
    ])
  })
})
