// `dw-sdlc pr ship --json`: every answer carries `next`, each blocker its own, and `command` is gone.

import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { repo, runBin } from "../harness.ts"
import { type Context, fakeGh, GREEN, HEAD, type Pr, RUN, served, type Thread } from "../pr-harness.ts"

const REPOSITORY = "byarcadia-app/foundation"
const STARTED = "2026-10-31T11:01:00Z"

const PASSING: Context = { kind: "run", name: "Check", state: "SUCCESS", link: RUN, startedAt: STARTED }
const FAILING: Context = { ...PASSING, state: "FAILURE" }
const RUNNING: Context = { ...PASSING, state: "IN_PROGRESS" }
const THREAD: Thread = {
  id: "PRRT_kwDOexample",
  path: "src/a.ts",
  line: 12,
  author: "someone",
  body: "Memoise it."
}

/** The document `pr ship <args> --json` prints for `pr`, the clock a minute after STARTED. */
function answer(pr: Pr, args: string[] = []): Record<string, unknown> {
  const gh = fakeGh({ graphql: [served(pr)] })
  const now = new Date(Date.parse(STARTED) + 60_000).toISOString()
  const run = runBin(["pr", "ship", "40", "-R", REPOSITORY, ...args, "--json"], repo(), { ...gh.env, DW_SDLC_NOW: now })
  assert.notEqual(run.stdout, "", `no document; exit ${run.status}: ${run.stderr}`)
  return JSON.parse(run.stdout) as Record<string, unknown>
}

const CASES: [string, Pr][] = [
  ["done", { ...GREEN, state: "MERGED", mergeable: "UNKNOWN", mergeStateStatus: "UNKNOWN", mergeCommit: HEAD }],
  ["stop", { ...GREEN, state: "CLOSED" }],
  ["mergeability-unknown", { ...GREEN, mergeable: "UNKNOWN" }],
  ["fix-conflicts", { ...GREEN, mergeable: "CONFLICTING", checks: [FAILING], threads: [THREAD] }],
  ["fix-ci", { ...GREEN, checks: [FAILING] }],
  ["address-review", { ...GREEN, checks: [PASSING], threads: [THREAD] }],
  ["changes requested", { ...GREEN, checks: [PASSING], reviewDecision: "CHANGES_REQUESTED" }],
  ["ci-pending", { ...GREEN, checks: [RUNNING] }],
  ["ready-to-merge", { ...GREEN, checks: [PASSING] }],
  ["awaiting-approval", { ...GREEN, checks: [PASSING], reviewDecision: "REVIEW_REQUIRED" }]
]

describe("dw-sdlc pr ship --json carries next", () => {
  it("gives every answer and every blocker a next, and none a command", () => {
    for (const [name, pr] of CASES) {
      const document = answer(pr)
      assert.ok(Array.isArray(document.next), `${name}: next`)
      assert.ok(Array.isArray(document.blockers), `${name}: blockers`)
      assert.equal("command" in document, false, `${name}: command`)
      for (const blocker of document.blockers as Record<string, unknown>[]) {
        assert.ok(Array.isArray(blocker.next), `${name}: a blocker's next`)
        assert.equal("command" in blocker, false, `${name}: a blocker's command`)
      }
    }
  })

  it("makes every step the agent's or the dev's, a run or a do, and nothing else", () => {
    for (const [name, pr] of CASES) {
      const steps = [answer(pr)].flatMap(({ next, blockers }) => [
        ...(next as unknown[]),
        ...(blockers as { next: unknown[] }[]).flatMap((blocker) => blocker.next)
      ])
      for (const step of steps) {
        assert.ok(typeof step === "object" && step !== null, name)
        const { by, ...rest } = step as Record<string, unknown>
        assert.ok(by === "agent" || by === "dev", `${name}: by ${String(by)}`)
        const keys = Object.keys(rest)
        assert.ok(keys.length === 1 && (keys[0] === "run" || keys[0] === "do"), `${name}: ${keys.join(",")}`)
      }
    }
  })

  it("answers changes requested with no thread by the read of the reviews, then one line of judgement", () => {
    const document = answer({ ...GREEN, checks: [PASSING], reviewDecision: "CHANGES_REQUESTED" })
    assert.deepEqual(document.next, [
      { by: "agent", run: `gh pr view 40 -R ${REPOSITORY} --json reviews` },
      {
        by: "agent",
        do: "answer the review asking for changes with a push; with nothing to change it is the reviewer's turn: say so and stop"
      }
    ])
  })

  it("gives each open thread a resolve command and a reply command whose only blank is <text>", () => {
    const document = answer({ ...GREEN, checks: [PASSING], threads: [THREAD] })
    const { threads } = document.details as { threads: { id: string; resolve: string; reply: string }[] }
    assert.equal(threads.length, 1)
    const [thread] = threads
    assert.ok(thread !== undefined)
    const resolve = "mutation($id:ID!){resolveReviewThread(input:{threadId:$id}){thread{id}}}"
    const reply =
      "mutation($id:ID!,$body:String!){addPullRequestReviewThreadReply(input:{pullRequestReviewThreadId:$id,body:$body}){comment{id}}}"
    assert.equal(thread.resolve, `gh api graphql -f query='${resolve}' -f id=PRRT_kwDOexample`)
    assert.equal(thread.reply, `gh api graphql -f query='${reply}' -f id=PRRT_kwDOexample -f body=<text>`)
    assert.equal(thread.resolve.includes("<"), false)
    assert.equal(thread.reply.split("<").length, 2)
  })

  it("gives each failing check its link, and the log command of an Actions job", () => {
    const document = answer({ ...GREEN, checks: [FAILING] })
    const { checks } = document.details as { checks: Record<string, unknown>[] }
    assert.deepEqual(checks, [
      { name: "Check", link: RUN, log: "gh run view --job 124272841543 -R byarcadia-app/foundation --log-failed" }
    ])
  })

  it("answers a wait with this call again under --wait, its flags kept", () => {
    const document = answer({ ...GREEN, checks: [RUNNING] }, ["--merge"])
    assert.equal(document.status, "wait")
    assert.deepEqual(document.next, [{ by: "agent", run: `dw-sdlc pr ship 40 -R ${REPOSITORY} --merge --wait --json` }])
  })

  it("describes next and its two step forms in --help", () => {
    const run = runBin(["pr", "ship", "--help"], repo(), {})
    assert.equal(run.status, 0, run.stderr)
    assert.match(run.stdout, /Every answer carries next/)
    assert.match(run.stdout, /\{ by, run \} is an exact\s+command/)
    assert.match(run.stdout, /\{ by, do \}\s+is one line of judgement/)
  })

  it("leaves a park with nothing for the dev to run an empty next", () => {
    for (const [name, pr] of [CASES[1], CASES[9]] as [string, Pr][]) {
      assert.deepEqual(answer(pr).next, [], name)
    }
  })

  it("asks the dev to type the merge at ready-to-merge, never the agent to run it", () => {
    const document = answer({ ...GREEN, checks: [PASSING] })
    assert.deepEqual(document.next, [{ by: "dev", run: `gh pr merge 40 --squash --match-head-commit ${HEAD}` }])
  })
})
