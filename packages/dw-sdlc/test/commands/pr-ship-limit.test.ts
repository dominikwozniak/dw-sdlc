// `dw-sdlc pr ship` after Reviews that each left a Finding open: three with no success between them park
// the pull request for the dev, with the command that accepts its head; a success starts the count again.

import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { COMMITTED_FILE } from "../../src/agentic-config.ts"
import { repo, runBin } from "../harness.ts"
import { type Commit, fakeGh, GREEN, HEAD, type Pr, RUN, served } from "../pr-harness.ts"

const TARGET = ["40", "-R", "byarcadia-app/foundation"]
const AUTH = ["auth", "status", "--active", "--hostname", "github.com"]
const READ = [
  "api",
  "graphql",
  "-f",
  "query=…",
  "-f",
  "owner=byarcadia-app",
  "-f",
  "name=foundation",
  "-F",
  "number=40"
]
const CLEAN = "ad212a6aa5e5c0ffee0ddba11c0de5ca1ab1e0dd"
const FIRST = "5ae684e1c0ffee0ddba11c0de5ca1ab1e0ddba11"
const SECOND = "b01dfacec0ffee0ddba11c0de5ca1ab1e0ddba11"
const THIRD = "c0ffee00c0ffee0ddba11c0de5ca1ab1e0ddba11"
const FOURTH = "d00dfeedc0ffee0ddba11c0de5ca1ab1e0ddba11"
const PUSHED = "ebf4833f00dfacade0ddba11c0de5ca1ab1e0ddb"
const ACCEPT = `dw-sdlc pr reviewed 40 -R byarcadia-app/foundation --head ${HEAD} --accept`

/** The read mark `pr reviewed --findings` posts: a Review read the commit and left a Finding open. */
const MARK: Pick<Commit, "review" | "described"> = { review: "FAILURE", described: "read, findings open" }

/** Green and the viewer's own, its head not reviewed, the history as a test states it. */
function pushed(history: Commit[], more: Partial<Pr> = {}): Pr {
  const check = { kind: "run", name: "Check", state: "SUCCESS", link: RUN, startedAt: "2026-10-31T11:01:00Z" } as const
  return { ...GREEN, checks: [check], history, ...more }
}

/** Three Reviews that left a Finding open since a success on CLEAN, a fix pushed after them. */
const THREE_MARKS: Commit[] = [
  { oid: CLEAN, review: "SUCCESS" },
  { oid: FIRST, ...MARK },
  { oid: SECOND, ...MARK },
  { oid: THIRD, ...MARK },
  { oid: PUSHED, review: null }
]

const FULL = { [COMMITTED_FILE]: { pr: { review: "full" } } }

/** `dw-sdlc pr ship` on the one `pr` read; `pr.review` is full unless `files` say otherwise. */
function ship(args: string[], pr: Pr, files: Record<string, string | object> = FULL) {
  const gh = fakeGh({ graphql: [served(pr)] })
  const run = runBin(["pr", "ship", ...TARGET, "--json", ...args], repo({ files }), gh.env)
  return {
    ...run,
    calls: gh.calls(),
    answer: run.stdout === "" ? {} : (JSON.parse(run.stdout) as Record<string, unknown>)
  }
}

function answered(answer: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(keys.map((key) => [key, answer[key]]))
}

describe("dw-sdlc pr ship after three Reviews with no success between them", () => {
  it("parks for the dev with the command that accepts the head, under --dry-run too", () => {
    for (const args of [[], ["--dry-run"]]) {
      const run = ship(args, pushed(THREE_MARKS))
      assert.equal(run.status, 30, `${args.join(" ")}: ${run.stderr}`)
      assert.deepEqual(
        answered(run.answer, ["status", "action", "actor", "reason", "command", "performed"]),
        {
          status: "park",
          action: "review-limit",
          actor: "dev",
          reason: `3 Reviews since the success on ${CLEAN.slice(0, 7)} left a Finding open: accepting the head is the dev's`,
          command: ACCEPT,
          performed: []
        },
        args.join(" ")
      )
      assert.deepEqual(run.calls, [AUTH, READ])
    }
  })

  it("counts from the start of the pull request when it holds no success", () => {
    const run = ship([], pushed(THREE_MARKS.slice(1)))
    assert.equal(run.status, 30, run.stderr)
    assert.equal(
      run.answer.reason,
      "3 Reviews since the start of the pull request left a Finding open: accepting the head is the dev's"
    )
  })

  it("parks at light as at full", () => {
    const run = ship([], pushed(THREE_MARKS), { [COMMITTED_FILE]: { pr: { review: "light" } } })
    assert.equal(run.status, 30, run.stderr)
    assert.deepEqual(answered(run.answer, ["action", "actor"]), { action: "review-limit", actor: "dev" })
  })

  it("asks for one more Review under the dev's --review, at the depth they name", () => {
    const cases: [string, object][] = [
      ["light", { depth: "light", source: "flag", since: THIRD }],
      ["full", { depth: "full", source: "flag", reviewCommand: "/code-review", since: THIRD }]
    ]
    for (const [depth, details] of cases) {
      const run = ship(["--review", depth], pushed(THREE_MARKS))
      assert.equal(run.status, 10, `${depth}: ${run.stderr}`)
      assert.deepEqual(
        answered(run.answer, ["status", "action", "actor", "details"]),
        { status: "act", action: "review", actor: "agent", details },
        depth
      )
    }
  })

  it("parks under the dev's --review once the one Review it buys left a Finding open", () => {
    const history: Commit[] = [...THREE_MARKS.slice(0, -1), { oid: FOURTH, ...MARK }, { oid: PUSHED, review: null }]
    for (const depth of ["light", "full"]) {
      const run = ship(["--review", depth], pushed(history))
      assert.equal(run.status, 30, `${depth}: ${run.stderr}`)
      assert.deepEqual(answered(run.answer, ["action", "actor"]), { action: "review-limit", actor: "dev" }, depth)
    }
  })

  it("parks again after a fourth Review that left a Finding open", () => {
    const history: Commit[] = [...THREE_MARKS.slice(0, -1), { oid: FOURTH, ...MARK }, { oid: PUSHED, review: null }]
    const run = ship([], pushed(history))
    assert.equal(run.status, 30, run.stderr)
    assert.match(String(run.answer.reason), /^4 Reviews since the success on ad212a6 left a Finding open/)
  })

  it("asks for a Review below the limit, at two read marks", () => {
    const run = ship([], pushed(THREE_MARKS.filter(({ oid }) => oid !== THIRD)))
    assert.equal(run.status, 10, run.stderr)
    assert.deepEqual(answered(run.answer, ["action", "actor"]), { action: "review", actor: "agent" })
  })

  it("counts the read mark the head itself carries", () => {
    const run = ship([], pushed(THREE_MARKS.slice(0, -2), { headReview: MARK }))
    assert.equal(run.status, 30, run.stderr)
    assert.equal(run.answer.action, "review-limit")
  })

  it("starts the count again after a success of any kind", () => {
    const successes: [string, Pick<Commit, "review" | "described">][] = [
      ["a clean Review", { review: "SUCCESS" }],
      ["the dev's acceptance", { review: "SUCCESS", described: "accepted by the dev, findings open" }],
      ["a success the script posted under off", { review: "SUCCESS", described: "off: --review off" }]
    ]
    for (const [name, success] of successes) {
      const history: Commit[] = [
        { oid: CLEAN, ...MARK },
        { oid: FIRST, ...MARK },
        { oid: SECOND, ...success },
        { oid: THIRD, ...MARK },
        { oid: PUSHED, review: null }
      ]
      const run = ship([], pushed(history))
      assert.equal(run.status, 10, `${name}: ${run.stderr}`)
      assert.deepEqual(answered(run.answer, ["action", "actor"]), { action: "review", actor: "agent" }, name)
    }
  })
})
