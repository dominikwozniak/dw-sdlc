// The `pinned-actions` Check through `dw-sdlc gate`, on a throwaway repository with workflow files:
// the exit code and each failure line word for word.

import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { lines, repo, runBin } from "../harness.ts"

const CONFIG = ".ai/agentic.config.json"
const SHA = "1f5320e29ee1cf0ff1e3712e6b1298564edddca9"
const REMEDY = "pin it as `<owner>/<repo>@<40-hex commit SHA> # vX.Y.Z`"

/** A Gate run over a repository whose workflow `body` the Check judges. */
function judge(body: string, setting: unknown = true) {
  const root = repo({
    files: {
      [CONFIG]: { version: 1, gate: { checks: { "pinned-actions": setting } } },
      ".github/workflows/ci.yaml": body
    }
  })
  return runBin(["gate"], root)
}

describe("the pinned-actions Check", () => {
  it("passes a SHA with a version comment, a local action and a docker image", () => {
    const run = judge(
      [
        "jobs:",
        "  a:",
        `    uses: org/repo/.github/workflows/q.yaml@${SHA} # v1.1.0`,
        "    steps:",
        `      - uses: actions/checkout@${SHA} # v4.2.2`,
        "      - uses: ./.github/actions/local",
        "      - uses: docker://alpine:3.20",
        ""
      ].join("\n")
    )
    assert.equal(run.status, 0, run.stdout)
    assert.deepEqual(lines(run.stdout), ["gate: check pinned-actions — pass", "gate: green — 0 steps, 1 check"])
  })

  it("fails a tag, a branch and a short SHA with the line and the remedy", () => {
    const run = judge(
      [
        "steps:",
        "  - uses: actions/checkout@v4",
        "  - uses: org/repo@main",
        "  - uses: org/repo@abc1234 # v1.0.0",
        ""
      ].join("\n")
    )
    assert.equal(run.status, 1, run.stdout)
    const out = lines(run.stdout)
    assert.ok(
      out.includes(
        `.github/workflows/ci.yaml:2: pinned-actions: actions/checkout@v4 is not pinned to a full commit SHA — ${REMEDY}`
      ),
      run.stdout
    )
    assert.ok(out.some((line) => line.includes("ci.yaml:3: pinned-actions: org/repo@main is not pinned")))
    assert.ok(out.some((line) => line.includes("ci.yaml:4: pinned-actions: org/repo@abc1234 is not pinned")))
  })

  it("fails a SHA with no version comment or a comment that is no version", () => {
    const run = judge(["steps:", `  - uses: a/b@${SHA}`, `  - uses: a/c@${SHA} # latest`, ""].join("\n"))
    assert.equal(run.status, 1, run.stdout)
    const out = lines(run.stdout)
    assert.ok(out.some((line) => line.includes(`ci.yaml:2: pinned-actions: a/b@${SHA} has no`)))
    assert.ok(out.some((line) => line.includes(`ci.yaml:3: pinned-actions: a/c@${SHA} has no`)))
  })
})
