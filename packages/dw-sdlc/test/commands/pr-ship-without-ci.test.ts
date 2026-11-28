// `dw-sdlc pr ship --without-ci`, the dev's word "merge without CI": a Gate mark on the head stands in for
// CI, only the CI rows move aside, and every merge the script runs or names for the dev carries --admin.

import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { COMMITTED_FILE, LOCAL_FILE } from "../../src/agentic-config.ts"
import { repo, runInProcess } from "../harness.ts"
import { type Context, fakeGh, GREEN, HEAD, type Pr, RUN, type Scenario, served } from "../pr-harness.ts"

const TARGET = ["40", "-R", "byarcadia-app/foundation", "--json"]
const STARTED = "2026-10-31T11:01:00Z"
const ADMIN_MERGE = [
  "pr",
  "merge",
  "40",
  "-R",
  "byarcadia-app/foundation",
  "--admin",
  "--squash",
  "--match-head-commit",
  HEAD
]

const FAILING: Context = { kind: "run", name: "Check", state: "FAILURE", link: RUN, startedAt: STARTED }
const PENDING: Context = { ...FAILING, state: "IN_PROGRESS" }
const MARKED: Context = { kind: "status", name: "dw-sdlc/gate", state: "SUCCESS" }

const AUTO = { [COMMITTED_FILE]: { pr: { merge: "auto" }, gate: { steps: ["pnpm test"] } } }

/** The document `pr ship --json` prints for the scenario, with `files` in the checkout, and the gh calls it made. */
function ship(scenario: Scenario, argv: string[], files: Record<string, string | object> = AUTO) {
  const gh = fakeGh(scenario)
  const run = runInProcess(["pr", "ship", ...TARGET, ...argv], repo({ files }), {
    ...gh.env,
    DW_SDLC_NOW: "2026-10-31T11:10:00Z"
  })
  assert.notEqual(run.stdout, "", `no document; exit ${run.status}: ${run.stderr}`)
  return { status: run.status, answer: JSON.parse(run.stdout) as Record<string, unknown>, calls: gh.calls() }
}

/** `pr`'s read, then its read once merged. */
const merging = (pr: Pr): Scenario => ({
  graphql: [served(pr), served({ ...pr, state: "MERGED", mergeable: "UNKNOWN" })]
})

const merges = (calls: string[][]): string[][] =>
  calls.filter(([command, verb]) => command === "pr" && verb === "merge")

describe("dw-sdlc pr ship --without-ci", () => {
  it("merges on a Gate mark past failing or pending CI, with --admin", () => {
    for (const ci of [FAILING, PENDING]) {
      const run = ship(merging({ ...GREEN, checks: [ci, MARKED] }), ["--without-ci"])
      assert.equal(run.status, 0, JSON.stringify(run.answer))
      assert.deepEqual([run.answer.status, run.answer.action], ["done", "done"])
      assert.deepEqual(merges(run.calls), [ADMIN_MERGE])
    }
  })

  it("hands a head with no Gate mark to the agent to prove, whatever its CI says", () => {
    for (const ci of [[FAILING], [PENDING], GREEN.checks]) {
      const run = ship({ graphql: [served({ ...GREEN, checks: ci })] }, ["--without-ci"])
      assert.equal(run.status, 10)
      assert.deepEqual(
        [run.answer.status, run.answer.action, run.answer.actor, run.answer.reason, run.answer.next],
        [
          "act",
          "prove-locally",
          "agent",
          "--without-ci: no Gate mark on e36732e stands in for CI",
          [
            { by: "agent", run: "dw-sdlc gate --mark" },
            { by: "agent", do: "red: fix what it printed, then git push" }
          ]
        ]
      )
      assert.deepEqual(run.answer.blockers, [])
      assert.deepEqual(merges(run.calls), [])
    }
  })

  it("moves aside fix-ci, ci-limit, ci-pending, ci-stuck and unverified, each of which answers without it", () => {
    const red = { oid: "a1", checks: [FAILING] }
    const cases: [Pr, string][] = [
      [{ ...GREEN, checks: [FAILING, MARKED] }, "act fix-ci"],
      [{ ...GREEN, checks: [FAILING, MARKED], history: [red, { ...red, oid: "a2" }] }, "park ci-limit"],
      [{ ...GREEN, checks: [PENDING, MARKED] }, "wait ci-pending"],
      [{ ...GREEN, checks: [{ ...PENDING, startedAt: "2026-10-31T10:00:00Z" }, MARKED] }, "park ci-stuck"],
      [{ ...GREEN, checks: [MARKED] }, "park unverified"],
      [{ ...GREEN, checks: [MARKED], committedAt: "2026-10-31T11:09:30Z" }, "wait unverified"]
    ]
    for (const [pr, label] of cases) {
      const { answer } = ship({ graphql: [served(pr)] }, [])
      assert.equal(
        `${String(answer.status)} ${String(answer.action === "wait" ? answer.reason : answer.action)}`,
        label
      )
      const run = ship(merging(pr), ["--without-ci"])
      assert.deepEqual([run.status, run.answer.action], [0, "done"], label)
      assert.deepEqual(merges(run.calls), [ADMIN_MERGE], label)
    }
  })

  it("still blocks on conflicts, threads, changes requested, a required approval, a draft and another author's pull request", () => {
    const red: Pr = { ...GREEN, checks: [FAILING, MARKED] }
    const thread = { id: "PRRT_1", path: "src/a.ts", line: 3, author: "octocat", body: "rename it" }
    const requested = (commit: string): Pr => ({
      ...red,
      reviewDecision: "CHANGES_REQUESTED",
      reviews: [{ author: "octocat", state: "CHANGES_REQUESTED", commit }],
      history: [{ oid: "a1" }]
    })
    const adminMerge = [{ by: "dev", run: `gh pr merge 40 --admin --squash --match-head-commit ${HEAD}` }]
    const cases: [Pr, string, object[]?][] = [
      [{ ...red, mergeable: "CONFLICTING" }, "act fix-conflicts"],
      [{ ...red, threads: [thread] }, "act address-review"],
      [requested(HEAD), "act address-review"],
      [{ ...red, threads: [{ ...thread, lastByViewer: true }] }, "park awaiting-reply", []],
      [requested("a1"), "park awaiting-review", []],
      [{ ...red, reviewDecision: "REVIEW_REQUIRED" }, "park awaiting-approval", []],
      [{ ...red, draft: true }, "park mark-ready"],
      [{ ...red, draft: true, viewerDidAuthor: false }, "park awaiting-author", []],
      [{ ...red, moreThreads: true }, "park partial-read", adminMerge],
      [{ ...red, viewerDidAuthor: false }, "park ready-to-merge", adminMerge]
    ]
    for (const [pr, label, next] of cases) {
      const run = ship({ graphql: [served(pr)] }, ["--without-ci", "--dry-run"])
      assert.equal(`${String(run.answer.status)} ${String(run.answer.action)}`, label)
      assert.deepEqual(run.answer.blockers, [], label)
      assert.deepEqual(merges(run.calls), [], label)
      if (next !== undefined) {
        assert.deepEqual(run.answer.next, next, label)
      }
    }
  })

  it("hands CI unavailable to the agent to prove too, with no gate.steps where it parks without the flag", () => {
    const refused: Context = { ...FAILING, steps: 0 }
    const files = { [COMMITTED_FILE]: { pr: { merge: "auto", ciUnavailable: "gate" } } }
    const without = ship({ graphql: [served({ ...GREEN, checks: [refused] })] }, [], files)
    assert.equal(without.answer.action, "ci-unavailable")
    const run = ship({ graphql: [served({ ...GREEN, checks: [refused] })] }, ["--without-ci"], files)
    assert.deepEqual([run.status, run.answer.action, run.answer.blockers], [10, "prove-locally", []])
  })

  it("parks a merge GitHub refuses as ready-to-merge, the --admin merge the dev's step", () => {
    // gh's refusal for a viewer whose role cannot bypass the rules, the first line its stderr carries.
    const refusal =
      "Pull request byarcadia-app/foundation#40 is not mergeable: the base branch policy prohibits the merge."
    const stderr = `X ${refusal}\n`
    const pr: Pr = { ...GREEN, checks: [FAILING, MARKED], mergeStateStatus: "BLOCKED" }
    const scenario = { graphql: [served(pr), served(pr)], commands: { "pr merge": { exit: 1, stderr } } }
    const run = ship(scenario, ["--without-ci"])
    assert.equal(run.status, 30)
    assert.deepEqual(
      [run.answer.status, run.answer.action, run.answer.actor, run.answer.reason, run.answer.next],
      [
        "park",
        "ready-to-merge",
        "dev",
        `gh refused the merge: ${refusal}`,
        [{ by: "dev", run: `gh pr merge 40 --admin --squash --match-head-commit ${HEAD}` }]
      ]
    )
    assert.deepEqual(run.answer.performed, [
      { action: "merge", command: `gh ${ADMIN_MERGE.join(" ")}`, exit: 1, stderr: stderr.trim(), ok: false }
    ])
    assert.deepEqual(merges(run.calls), [ADMIN_MERGE])
  })

  it("merges nothing under pr.merge ask without --merge, and names the --admin merge for the dev", () => {
    const ask = { [COMMITTED_FILE]: { gate: { steps: ["pnpm test"] } } }
    const pr: Pr = { ...GREEN, checks: [FAILING, MARKED] }
    const run = ship({ graphql: [served(pr)] }, ["--without-ci"], ask)
    assert.equal(run.status, 30)
    assert.deepEqual(
      [run.answer.action, run.answer.reason, run.answer.next],
      [
        "ready-to-merge",
        "pr.merge is ask: the merge is the dev's",
        [{ by: "dev", run: `gh pr merge 40 --admin --squash --match-head-commit ${HEAD}` }]
      ]
    )
    assert.deepEqual(merges(run.calls), [])
    const merged = ship(merging(pr), ["--without-ci", "--merge"], ask)
    assert.deepEqual([merged.status, merges(merged.calls)], [0, [ADMIN_MERGE]])
  })

  it("carries no --admin on a merge without --without-ci, the script's or the dev's", () => {
    const merged = ship(merging(GREEN), [])
    assert.deepEqual(merges(merged.calls), [ADMIN_MERGE.filter((arg) => arg !== "--admin")])
    const ask = { [COMMITTED_FILE]: {} }
    const parked = ship({ graphql: [served(GREEN)] }, [], ask)
    assert.deepEqual(parked.answer.next, [{ by: "dev", run: `gh pr merge 40 --squash --match-head-commit ${HEAD}` }])
  })

  it("keeps --without-ci in the step at a wait, so the next call carries the dev's word", () => {
    const run = ship({ graphql: [served({ ...GREEN, checks: [FAILING, MARKED], mergeable: "UNKNOWN" })] }, [
      "--without-ci"
    ])
    assert.deepEqual(
      [run.status, run.answer.reason, run.answer.next],
      [
        20,
        "mergeability-unknown",
        [{ by: "agent", run: "dw-sdlc pr ship 40 -R byarcadia-app/foundation --without-ci --wait --json" }]
      ]
    )
  })

  it("takes the Gate mark from the local file under footprint local", () => {
    const files = { ...AUTO, [LOCAL_FILE]: { footprint: "local" }, ".git/dw-sdlc/gates/40.json": [HEAD] }
    const run = ship(merging({ ...GREEN, checks: [FAILING] }), ["--without-ci"], files)
    assert.deepEqual([run.status, merges(run.calls)], [0, [ADMIN_MERGE]])
    const unmarked = ship({ graphql: [served({ ...GREEN, checks: [FAILING, MARKED] })] }, ["--without-ci"], {
      ...AUTO,
      [LOCAL_FILE]: { footprint: "local" }
    })
    assert.equal(unmarked.answer.action, "prove-locally")
  })

  it("is described by --help: the Gate mark for CI, the CI rows it moves aside, and the --admin merge", () => {
    const run = runInProcess(["pr", "ship", "--help"], repo(), {})
    assert.equal(run.status, 0, run.stderr)
    const help = run.stdout.replaceAll("\n", " ")
    for (const words of [
      `--without-ci carries the dev's word "merge without CI" for this call`,
      "A Gate mark on the head stands in for CI, whatever CI says",
      "the answer is act prove-locally, with dw-sdlc gate --mark as its step",
      "It moves aside the CI rows only, fix-ci, unverified, ci-pending, ci-stuck and ci-limit",
      "It does not imply --merge",
      "gh pr merge <n> --admin --squash --match-head-commit <head>",
      "parks ready-to-merge with that command as the dev's step",
      "Without --without-ci no merge carries --admin"
    ]) {
      assert.ok(help.includes(words), words)
    }
  })
})
