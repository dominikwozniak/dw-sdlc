// `dw-sdlc pr ship` at the CI limit: the third head in a row with failing CI parks `ci-limit`, counted from the
// commit history the one read holds, each commit with its CI state.

import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { COMMITTED_FILE, LOCAL_FILE } from "../../src/agentic-config.ts"
import { repo, runBin } from "../harness.ts"
import { type Commit, type Context, fakeGh, GREEN, type Pr, RUN, served } from "../pr-harness.ts"

const TARGET = ["40", "-R", "byarcadia-app/foundation", "--json"]
const STARTED = "2026-10-31T11:01:00Z"

const PASSING: Context = { kind: "run", name: "Check", state: "SUCCESS", link: RUN, startedAt: STARTED }
const FAILING: Context = { ...PASSING, state: "FAILURE" }
const RUNNING: Context = { ...PASSING, state: "IN_PROGRESS" }
/** A job GitHub refused to start: failed at once, no step run, as a billing lock leaves it. */
const REFUSED: Context = { ...FAILING, steps: 0 }
const MARKED: Context = { kind: "status", name: "dw-sdlc/gate", state: "SUCCESS" }

const GATED = { [COMMITTED_FILE]: { pr: { merge: "auto", ciUnavailable: "gate" }, gate: { steps: ["pnpm test"] } } }
const DEFAULT = { [COMMITTED_FILE]: { pr: { merge: "auto" } } }

const red = (oid: string, ...more: Partial<Commit>[]): Commit => ({
  oid,
  checks: [FAILING],
  ...Object.assign({}, ...more)
})
const green = (oid: string): Commit => ({ oid, checks: [PASSING] })
/** A commit CI never ran on, as one of several pushed together. */
const bare = (oid: string): Commit => ({ oid })

/** The document `pr ship --json` prints for `pr`, with `files` in the checkout, and its exit status. */
function ship(pr: Pr, files: Record<string, string | object> = DEFAULT, argv: string[] = []) {
  const gh = fakeGh({ graphql: [served(pr)] })
  const run = runBin(["pr", "ship", ...TARGET, "--dry-run", ...argv], repo({ files }), {
    ...gh.env,
    DW_SDLC_NOW: "2026-10-31T11:10:00Z"
  })
  assert.notEqual(run.stdout, "", `no document; exit ${run.status}: ${run.stderr}`)
  return { status: run.status, answer: JSON.parse(run.stdout) as Record<string, unknown> }
}

const label = ({ answer }: { answer: Record<string, unknown> }): string =>
  `${String(answer.status)} ${String(answer.action)}`

describe("dw-sdlc pr ship at the CI limit", () => {
  it("answers fix-ci on the second red head in a row", () => {
    const run = ship({ ...GREEN, checks: [FAILING], history: [red("a1")] })
    assert.equal(run.status, 10)
    assert.equal(label(run), "act fix-ci")
  })

  it("parks ci-limit on the third, with the failing checks and the dev's two ways on", () => {
    const run = ship({ ...GREEN, checks: [FAILING], history: [red("a1"), red("a2")] })
    assert.equal(run.status, 30)
    assert.equal(label(run), "park ci-limit")
    assert.equal(run.answer.actor, "dev")
    assert.equal(run.answer.reason, "CI failed on 3 heads in a row, the CI limit: Check on e36732e")
    assert.deepEqual(run.answer.details, {
      checks: [
        { name: "Check", link: RUN, log: "gh run view --job 124272841543 -R byarcadia-app/foundation --log-failed" }
      ]
    })
    assert.deepEqual(run.answer.next, [
      { by: "dev", do: "fix the failing checks under details.checks yourself, then push" },
      { by: "dev", do: 'say "merge without CI" to merge on a Gate mark, past the failing CI' }
    ])
    assert.deepEqual(run.answer.blockers, [])
  })

  it("counts older heads too: the fourth red head in a row is parked as the third is", () => {
    const run = ship({ ...GREEN, checks: [FAILING], history: [red("a0"), red("a1"), red("a2")] })
    assert.equal(label(run), "park ci-limit")
  })

  it("does not park a green head after three red ones: the limit holds the head's own CI", () => {
    const run = ship({ ...GREEN, checks: [PASSING], history: [red("a1"), red("a2"), red("a3")] })
    assert.equal(label(run), "park ready-to-merge")
  })

  it("restarts the count at a green head between red ones", () => {
    const run = ship({ ...GREEN, checks: [FAILING], history: [red("a1"), red("a2"), green("a3"), red("a4")] })
    assert.equal(label(run), "act fix-ci")
  })

  it("counts a head the update-branch merge made", () => {
    const run = ship({ ...GREEN, checks: [FAILING], history: [red("a1"), red("a2", { parents: 2 })] })
    assert.equal(label(run), "park ci-limit")
    const last = ship({ ...GREEN, checks: [FAILING], headParents: 2, history: [red("a1"), red("a2")] })
    assert.equal(label(last), "park ci-limit")
  })

  it("passes over a commit no check reported on, or whose checks still run, and counts the heads around it", () => {
    const run = ship({
      ...GREEN,
      checks: [FAILING],
      history: [red("a1"), bare("a2"), { oid: "a3", checks: [RUNNING] }, red("a4")]
    })
    assert.equal(label(run), "park ci-limit")
  })

  it("counts only the history the read holds: a force push that rewrote it restarts the count", () => {
    const rewritten = ship({ ...GREEN, checks: [FAILING], history: [] })
    assert.equal(label(rewritten), "act fix-ci")
  })

  it("counts CI unavailable that no Gate mark stands in for", () => {
    const run = ship({ ...GREEN, checks: [REFUSED], history: [{ oid: "a1", checks: [REFUSED] }, red("a2")] }, GATED)
    assert.equal(label(run), "park ci-limit")
  })

  it("counts no head of CI unavailable with a Gate mark on it", () => {
    const marked = { oid: "a2", checks: [REFUSED, MARKED] }
    const onHistory = ship({ ...GREEN, checks: [REFUSED], history: [{ oid: "a1", checks: [REFUSED] }, marked] }, GATED)
    assert.equal(label(onHistory), "act prove-locally")
    const onHead = ship(
      {
        ...GREEN,
        checks: [REFUSED, MARKED],
        history: [
          { oid: "a1", checks: [REFUSED] },
          { oid: "a2", checks: [REFUSED] }
        ]
      },
      GATED
    )
    assert.equal(label(onHead), "park ready-to-merge")
  })

  it("reads the Gate mark of a past head from the local file under footprint local", () => {
    const files = {
      ...GATED,
      [LOCAL_FILE]: { footprint: "local" },
      ".git/dw-sdlc/gates/40.json": ["a2"]
    }
    const run = ship(
      {
        ...GREEN,
        checks: [REFUSED],
        history: [
          { oid: "a1", checks: [REFUSED] },
          { oid: "a2", checks: [REFUSED] }
        ]
      },
      files
    )
    assert.equal(label(run), "act prove-locally")
  })

  it("lists every red check of the head, a failing job with its log command", () => {
    const other: Context = { kind: "status", name: "ci/lint", state: "FAILURE", link: "https://ci.example/lint" }
    const run = ship({ ...GREEN, checks: [FAILING, other], history: [red("a1"), red("a2")] })
    const details = run.answer.details as { checks: { name: string }[] }
    assert.deepEqual(
      details.checks.map(({ name }) => name),
      ["Check", "ci/lint"]
    )
  })
})
