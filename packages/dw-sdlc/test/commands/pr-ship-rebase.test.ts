// `dw-sdlc pr ship` after a rebase: the head a Review read is gone from the history, and the timeline's
// force push events name it. The script carries its success when the own changes are as it read them,
// reads from it when they moved, and counts its read mark toward the limit.

import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { COMMITTED_FILE } from "../../src/agentic-config.ts"
import { repo, runBin } from "../harness.ts"
import { BASE_OID, type Commit, fakeGh, GREEN, HEAD, type Pr, type Response, RUN, served } from "../pr-harness.ts"

const URL = "https://github.com/byarcadia-app/foundation/pull/40"
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
/** The head a Review read before the rebase, and one read before it. */
const OLD = "5ae684e1c0ffee0ddba11c0de5ca1ab1e0ddba11"
const OLDER = "ad212a6aa5e5c0ffee0ddba11c0de5ca1ab1e0dd"
/** The first commit the rebase wrote, the head its last. */
const REWRITTEN = "ebf4833f00dfacade0ddba11c0de5ca1ab1e0ddb"

/** The read mark `pr reviewed --findings` posts: a Review read the commit and left a Finding open. */
const MARK: Pick<Commit, "review" | "described"> = { review: "FAILURE", described: "read, findings open" }

/** Green and the viewer's own, rebased: no commit of its history carries a review status. */
function rebased(rewritten: (Commit | null)[], more: Partial<Pr> = {}): Pr {
  const check = { kind: "run", name: "Check", state: "SUCCESS", link: RUN, startedAt: "2026-10-31T11:01:00Z" } as const
  return { ...GREEN, checks: [check], history: [{ oid: REWRITTEN }], rewritten, ...more }
}

/** A file as GitHub's compare lists it. */
type File = { filename: string; status: string; patch?: string }

function compare(commit: string): string[] {
  return ["api", `repos/byarcadia-app/foundation/compare/${BASE_OID}...${commit}?per_page=1`]
}

function compared(commit: string, files: File[]): Record<string, Response> {
  return { [compare(commit).join(" ")]: { stdout: JSON.stringify({ status: "ahead", behind_by: 0, files }) } }
}

const PAYWALL = "packages/payments/src/paywall.tsx"
/** The change as the Review read it. */
const READ_THEN: File = {
  filename: PAYWALL,
  status: "modified",
  patch:
    "@@ -10,3 +10,4 @@ export function Paywall() {\n   const offerings = useOfferings()\n+  const memo = 1\n   return ("
}
/** The same change on the moved base, its lines and context shifted. */
const SHIFTED: File = {
  ...READ_THEN,
  patch:
    "@@ -14,3 +14,4 @@ export function Paywall(props: Props) {\n   const offerings = useOfferings(props)\n+  const memo = 1\n   return ("
}
const ADDED: File = { filename: "src/retry.ts", status: "added", patch: "@@ -0,0 +1 @@\n+export const RETRIES = 3" }

function marked(why: string): string[] {
  const fields = { state: "success", context: "dw-sdlc/review", target_url: URL, description: why }
  const flags = Object.entries(fields).flatMap(([key, value]) => ["-f", `${key}=${value}`])
  return ["api", `repos/byarcadia-app/foundation/statuses/${HEAD}`, "--method", "POST", "--silent", ...flags]
}

function commandOf(args: string[]): string {
  return ["gh", ...args.map((arg) => (arg.includes(" ") ? `'${arg}'` : arg))].join(" ")
}

const FULL = { [COMMITTED_FILE]: { pr: { review: "full" } } }

function ship(args: string[], graphql: Pr[], commands: Record<string, Response> = {}) {
  const gh = fakeGh({ graphql: graphql.map(served), commands })
  const run = runBin(["pr", "ship", ...TARGET, "--json", ...args], repo({ files: FULL }), gh.env)
  const answer = run.stdout === "" ? {} : (JSON.parse(run.stdout) as Record<string, unknown>)
  return { ...run, calls: gh.calls(), answer }
}

function answered(answer: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(keys.map((key) => [key, answer[key]]))
}

const REVIEW = { depth: "full", source: "config", reviewCommand: "/code-review" }

describe("dw-sdlc pr ship after a rebase left the head a Review read behind", () => {
  it("carries a clean Review's success when the own changes are as it read them", () => {
    const pr = rebased([{ oid: OLD, review: "SUCCESS" }])
    const carried = `carried from ${OLD.slice(0, 7)}`
    const run = ship([], [pr, { ...pr, checks: GREEN.checks }], {
      ...compared(OLD, [READ_THEN]),
      ...compared(HEAD, [SHIFTED])
    })
    assert.equal(run.status, 30, run.stderr)
    assert.deepEqual(answered(run.answer, ["action", "performed"]), {
      action: "ready-to-merge",
      performed: [{ action: "mark-reviewed", command: commandOf(marked(carried)), exit: 0, ok: true }]
    })
    assert.deepEqual(run.calls, [AUTH, READ, compare(OLD), compare(HEAD), marked(carried), READ])
  })

  it("reads from the head a Review read, clean or not, keeping it to the files whose own change moved", () => {
    const cases: [string, Commit][] = [
      ["clean", { oid: OLD, review: "SUCCESS" }],
      ["a read mark", { oid: OLD, ...MARK }]
    ]
    for (const [name, read] of cases) {
      const run = ship([], [rebased([read])], { ...compared(OLD, [READ_THEN]), ...compared(HEAD, [SHIFTED, ADDED]) })
      assert.equal(run.status, 10, `${name}: ${run.stderr}`)
      assert.deepEqual(
        answered(run.answer, ["action", "details", "performed"]),
        { action: "review", details: { ...REVIEW, since: OLD, paths: [ADDED.filename] }, performed: [] },
        name
      )
    }
  })

  it("reads from the newest force push whose head a Review read, past heads no Review read", () => {
    const rewritten: (Commit | null)[] = [
      { oid: OLDER, review: "SUCCESS" },
      { oid: OLD, review: "SUCCESS" },
      null,
      { oid: "f00dfacec0ffee0ddba11c0de5ca1ab1e0ddba11", review: "SUCCESS", described: "off: pr.review" },
      { oid: "facade00c0ffee0ddba11c0de5ca1ab1e0ddba11" }
    ]
    const run = ship([], [rebased(rewritten)], { ...compared(OLD, [READ_THEN]), ...compared(HEAD, [READ_THEN, ADDED]) })
    assert.equal(run.status, 10, run.stderr)
    assert.deepEqual(answered(run.answer, ["action", "details"]), {
      action: "review",
      details: { ...REVIEW, since: OLD, paths: [ADDED.filename] }
    })
  })

  it("passes over a read mark the rebase left as it read it, and reads from the read before it, carrying none", () => {
    const older: Commit = { oid: OLDER, review: "SUCCESS" }
    const cases: [string, (Commit | null)[], File[], { since?: string; paths?: string[] }][] = [
      ["a success before it", [older, { oid: OLD, ...MARK }], [], { since: OLDER, paths: [PAYWALL] }],
      [
        "a success on the same own changes before it",
        [older, { oid: OLD, ...MARK }],
        [READ_THEN],
        { since: OLDER, paths: [] }
      ],
      ["no read before it", [{ oid: OLD, ...MARK }], [], {}]
    ]
    for (const [name, rewritten, atOlder, since] of cases) {
      const run = ship([], [rebased(rewritten)], {
        ...compared(OLDER, atOlder),
        ...compared(OLD, [READ_THEN]),
        ...compared(HEAD, [SHIFTED])
      })
      assert.equal(run.status, 10, `${name}: ${run.stderr}`)
      assert.deepEqual(
        answered(run.answer, ["action", "details", "performed"]),
        { action: "review", details: { ...REVIEW, ...since }, performed: [] },
        name
      )
    }
  })

  it("counts the read marks of heads a rebase left behind toward the limit", () => {
    const rewritten: Commit[] = [
      { oid: OLDER, review: "SUCCESS" },
      { oid: "b01dfacec0ffee0ddba11c0de5ca1ab1e0ddba11", ...MARK },
      { oid: "c0ffee00c0ffee0ddba11c0de5ca1ab1e0ddba11", ...MARK }
    ]
    const pr = rebased(rewritten, { history: [{ oid: REWRITTEN, ...MARK }] })
    const run = ship([], [pr], { ...compared(OLD, [READ_THEN]), ...compared(HEAD, [SHIFTED, ADDED]) })
    assert.equal(run.status, 30, run.stderr)
    assert.deepEqual(answered(run.answer, ["action", "reason"]), {
      action: "review-limit",
      reason: `3 Reviews since the success on ${OLDER.slice(0, 7)} left a Finding open: accepting the head is the dev's`
    })
  })

  it("takes a read the history still holds over a head a force push left behind, reading no compare", () => {
    const pr = rebased([{ oid: OLD, review: "SUCCESS" }], { history: [{ oid: REWRITTEN, ...MARK }] })
    const run = ship([], [pr])
    assert.equal(run.status, 10, run.stderr)
    assert.deepEqual(answered(run.answer, ["action", "details"]), {
      action: "review",
      details: { ...REVIEW, since: REWRITTEN }
    })
    assert.deepEqual(run.calls, [AUTH, READ])
  })

  it("reads the whole diff under the dev's --review full over a head that would carry", () => {
    const run = ship(["--review", "full"], [rebased([{ oid: OLD, review: "SUCCESS" }])], {
      ...compared(OLD, [READ_THEN]),
      ...compared(HEAD, [SHIFTED])
    })
    assert.equal(run.status, 10, run.stderr)
    assert.deepEqual(answered(run.answer, ["action", "details"]), {
      action: "review",
      details: { depth: "full", source: "flag", reviewCommand: "/code-review" }
    })
  })
})
