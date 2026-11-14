// `dw-sdlc pr ship`, run in this process with a fake gh first on PATH: for each pull request on the
// wire, the document or the line it answers, its exit code and the gh calls it made. The pr-ship-*
// files beside it spawn the bin.

import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { COMMITTED_FILE, LOCAL_FILE } from "../../src/agentic-config.ts"
import { run as runShip } from "../../src/commands/pr-ship.ts"
import { forgetCompares } from "../../src/pr/read.ts"
import { lines, repo, runBin, runInProcess, scratch } from "../harness.ts"
import {
  BASE_OID,
  type Context,
  fakeGh,
  GREEN,
  HEAD,
  type Pr,
  pullRequestOf,
  reply,
  type Response,
  RUN,
  type Scenario,
  served,
  type Thread
} from "../pr-harness.ts"

const MERGE_COMMIT = "b04365ad73c61edcf175d9c5632740eb13fd2e4d"
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
/** The compare of `base` with `head`: how the script judges that an update merged the base in. */
function baseWith(head: string, base = BASE_OID): string[] {
  return ["api", `repos/byarcadia-app/foundation/compare/${base}...${head}?per_page=1`]
}
/** What the compare of `base` with `head` answers when the head lacks `behind` commits of the base. */
function comparedBehind(behind: number, head = HEAD, base = BASE_OID): Record<string, Response> {
  const status = behind === 0 ? "ahead" : "diverged"
  const answer = { stdout: JSON.stringify({ status, ahead_by: 1, behind_by: behind }) }
  return { [baseWith(head, base).join(" ")]: answer }
}
/** The merge the script runs, the repository named. */
const MERGE = ["pr", "merge", "40", "-R", "byarcadia-app/foundation", "--squash", "--match-head-commit", HEAD]
/** The merge command an answer hands the dev. */
const DEV_MERGE = `gh pr merge 40 --squash --match-head-commit ${HEAD}`

/** The files of a test's checkout: a relative path and its text, an object written as JSON. */
type Files = Record<string, string | object>
/** pr.review full, so a head no one reviewed asks for a Review with no compare to read; `pr-ship-route` reads auto. */
const FULL: Files = { [COMMITTED_FILE]: { pr: { review: "full" } } }
const AUTO: Files = { [COMMITTED_FILE]: { pr: { merge: "auto", review: "full" } } }

/** As GitHub reports a merged pull request: mergeability no longer computed. */
const MERGED: Pr = {
  ...GREEN,
  state: "MERGED",
  mergeable: "UNKNOWN",
  mergeStateStatus: "UNKNOWN",
  mergeCommit: MERGE_COMMIT
}

const LOG = "gh run view --job 124272841543 -R byarcadia-app/foundation --log-failed"
const CIRCLE = "https://app.circleci.com/pipelines/github/byarcadia-app/foundation/7"
const PASSING: Context = { kind: "run", name: "Check", state: "SUCCESS", link: RUN, startedAt: "2026-10-31T11:01:00Z" }
const FAILING: Context = { ...PASSING, state: "FAILURE" }
const THREAD: Thread = {
  id: "PRRT_kwDOexample",
  path: "packages/payments/src/paywall.tsx",
  line: 42,
  author: "dominikwozniak",
  body: "This hook re-renders on every purchase event; memoise the offerings."
}
/** THREAD as `details` lists it. */
const LISTED = { id: THREAD.id, path: THREAD.path, line: THREAD.line, author: THREAD.author, body: THREAD.body }

/** Every kind of check and thread a reply carries, on a draft another author opened. */
const MIXED: Pr = {
  ...GREEN,
  draft: true,
  mergeable: "UNKNOWN",
  mergeStateStatus: "BLOCKED",
  reviewDecision: "REVIEW_REQUIRED",
  viewerDidAuthor: false,
  checks: [
    { kind: "run", name: "Check", state: "FAILURE", link: RUN, startedAt: "2026-10-31T11:01:00Z", required: true },
    {
      kind: "run",
      name: "Lint",
      state: "IN_PROGRESS",
      link: "https://ci.example.com/7",
      startedAt: "2026-10-31T11:02:00Z"
    },
    { kind: "run", name: "Docs", state: "NEUTRAL" },
    { kind: "run", name: "Deploy", state: "STARTUP_FAILURE" },
    { kind: "status", name: "ci/legacy", state: "EXPECTED", startedAt: "2026-10-31T11:03:00Z" },
    { kind: "status", name: "dw-sdlc/review", state: "SUCCESS", startedAt: "2026-10-31T11:05:00Z" }
  ],
  threads: [
    {
      id: "PRRT_open",
      path: "src/a.ts",
      line: 42,
      author: "dominikwozniak",
      body: "Memoise the offerings.",
      lastByViewer: true
    },
    { id: "PRRT_ghost", path: "src/b.ts", line: null, author: null, body: "A file-level note." },
    { id: "PRRT_resolved", path: "src/c.ts", line: 1, author: "dominikwozniak", body: "Done.", resolved: true },
    { id: "PRRT_outdated", path: "src/d.ts", line: 2, author: "dominikwozniak", body: "Moved.", outdated: true }
  ]
}

/**
 * `dw-sdlc pr ship <args>` against a fake gh playing `scenario`, from a repository with no pull request
 * whose checkout holds `files`, its agentic config among them.
 */
function ship(args: string[], scenario: Scenario, env: NodeJS.ProcessEnv = {}, files: Files = FULL) {
  const gh = fakeGh(scenario)
  forgetCompares()
  const run = runInProcess(runShip, args, repo({ files }), { ...gh.env, ...env })
  return { ...run, calls: gh.calls() }
}

function json(pr: Pr, flags: string[] = [], env: NodeJS.ProcessEnv = {}, files: Files = FULL) {
  const run = ship([...TARGET, "--json", ...flags], { graphql: [served(pr)] }, env, files)
  assert.notEqual(run.stdout, "", `no document; exit ${run.status}: ${run.stderr}`)
  return { ...run, document: JSON.parse(run.stdout) as unknown }
}

describe("dw-sdlc pr ship", () => {
  it("answers done for a merged pull request, with the merge commit and, while its head branch stands, its deletion for the dev", () => {
    const run = json(MERGED)
    assert.equal(run.status, 0, run.stderr)
    assert.deepEqual(run.document, {
      pr: URL,
      head: HEAD,
      base: "main",
      status: "done",
      action: "done",
      actor: "dev",
      reason: "merged as b04365a",
      command: "git push origin --delete feat/example",
      details: { mergeCommit: MERGE_COMMIT },
      blockers: [],
      performed: []
    })
    assert.deepEqual(run.calls, [AUTH, READ])
  })

  it("answers done with no command for a merged pull request from a fork, whose head branch lives on the fork", () => {
    const run = json({ ...MERGED, fromFork: true })
    assert.equal(run.status, 0, run.stderr)
    assert.deepEqual(run.document, json({ ...MERGED, headDeleted: true }).document)
    assert.deepEqual(run.calls, [AUTH, READ])
  })

  it("answers done with no command once the merged pull request's head branch is gone from the remote", () => {
    const run = json({ ...MERGED, headDeleted: true })
    assert.equal(run.status, 0, run.stderr)
    assert.deepEqual(run.document, {
      pr: URL,
      head: HEAD,
      base: "main",
      status: "done",
      action: "done",
      actor: "dev",
      reason: "merged as b04365a",
      details: { mergeCommit: MERGE_COMMIT },
      blockers: [],
      performed: []
    })
    assert.deepEqual(run.calls, [AUTH, READ])
  })

  it("answers done without details for a merged pull request GitHub names no merge commit for", () => {
    const run = json({ ...MERGED, mergeCommit: null })
    assert.equal(run.status, 0, run.stderr)
    assert.ok(typeof run.document === "object" && run.document !== null)
    assert.equal("details" in run.document, false, run.stdout)
    assert.ok("reason" in run.document && run.document.reason === "merged", run.stdout)
  })

  it("shell-quotes a branch name the shell would split or expand in the deletion command", () => {
    const run = json({ ...MERGED, branch: "fix/it's-$HOME" })
    assert.equal(run.status, 0, run.stderr)
    assert.ok(typeof run.document === "object" && run.document !== null && "command" in run.document)
    assert.equal(run.document.command, `git push origin --delete 'fix/it'\\''s-$HOME'`)
  })

  it("parks a pull request closed without merging, the dev's to stop", () => {
    const run = json({ ...GREEN, state: "CLOSED" })
    assert.equal(run.status, 30, run.stderr)
    assert.deepEqual(run.document, {
      pr: URL,
      head: HEAD,
      base: "main",
      status: "park",
      action: "stop",
      actor: "dev",
      reason: "closed without merging",
      blockers: [],
      performed: []
    })
    assert.deepEqual(run.calls, [AUTH, READ])
  })

  it("waits 15 s on an open pull request whose mergeability GitHub is still computing", () => {
    const run = json({ ...GREEN, mergeable: "UNKNOWN", mergeStateStatus: "UNKNOWN" })
    assert.equal(run.status, 20, run.stderr)
    assert.deepEqual(run.document, {
      pr: URL,
      head: HEAD,
      base: "main",
      status: "wait",
      action: "wait",
      actor: "script",
      reason: "mergeability-unknown",
      recheckAfter: 15,
      blockers: [],
      performed: []
    })
    assert.deepEqual(run.calls, [AUTH, READ])
  })

  it("parks a ready pull request with the merge command under pr.merge ask, the default", () => {
    for (const files of [{}, { [COMMITTED_FILE]: { pr: { merge: "ask" } } }]) {
      const run = json(GREEN, [], {}, files)
      assert.equal(run.status, 30, run.stderr)
      assert.deepEqual(run.document, {
        pr: URL,
        head: HEAD,
        base: "main",
        status: "park",
        action: "ready-to-merge",
        actor: "dev",
        reason: "pr.merge is ask: the merge is the dev's",
        command: DEV_MERGE,
        blockers: [],
        performed: []
      })
      assert.deepEqual(run.calls, [AUTH, READ])
    }
  })

  it("adds the state as read under facts with --verbose: buckets as gh pr checks sorts them, open threads only", () => {
    const run = json(MIXED, ["--verbose"])
    assert.equal(run.status, 20, run.stderr)
    assert.ok(typeof run.document === "object" && run.document !== null && "facts" in run.document, run.stdout)
    assert.deepEqual(run.document.facts, {
      url: URL,
      repo: "byarcadia-app/foundation",
      number: 40,
      state: "OPEN",
      draft: true,
      mergeable: "UNKNOWN",
      mergeStateStatus: "BLOCKED",
      reviewDecision: "REVIEW_REQUIRED",
      viewerDidAuthor: false,
      head: HEAD,
      headCommittedAt: "2026-10-31T11:00:00Z",
      readyAt: null,
      branch: "feat/example",
      branchStands: true,
      fromFork: false,
      base: "main",
      baseOid: BASE_OID,
      mergeCommit: null,
      changeRequests: [],
      commits: [HEAD],
      checks: [
        {
          name: "Check",
          bucket: "fail",
          required: true,
          link: RUN,
          log: ["gh", "run", "view", "--job", "124272841543", "-R", "byarcadia-app/foundation", "--log-failed"],
          startedAt: "2026-10-31T11:01:00Z"
        },
        {
          name: "Lint",
          bucket: "pending",
          required: false,
          link: "https://ci.example.com/7",
          log: null,
          startedAt: "2026-10-31T11:02:00Z"
        },
        { name: "Docs", bucket: "skipping", required: false, link: null, log: null, startedAt: null },
        { name: "Deploy", bucket: "fail", required: false, link: null, log: null, startedAt: null },
        {
          name: "ci/legacy",
          bucket: "pending",
          required: false,
          link: null,
          log: null,
          startedAt: "2026-10-31T11:03:00Z"
        },
        {
          name: "dw-sdlc/review",
          bucket: "pass",
          required: false,
          link: null,
          log: null,
          startedAt: "2026-10-31T11:05:00Z"
        }
      ],
      unresolvedThreads: [
        {
          id: "PRRT_open",
          path: "src/a.ts",
          line: 42,
          author: "dominikwozniak",
          body: "Memoise the offerings.",
          lastByViewer: true
        },
        {
          id: "PRRT_ghost",
          path: "src/b.ts",
          line: null,
          author: "ghost",
          body: "A file-level note.",
          lastByViewer: false
        }
      ],
      cutOff: [],
      lastRead: null,
      marks: { count: 0, since: null },
      carried: false,
      changed: null,
      scope: null
    })
    const bare = json({ ...GREEN, checks: [] }, ["--verbose"]).document
    assert.ok(typeof bare === "object" && bare !== null && "facts" in bare)
    assert.deepEqual((bare.facts as { checks: unknown }).checks, [], "a head with no rollup reads as no check")
  })

  it("reads the pull request gh pr view resolves when no number is given, or no repository", () => {
    const view = { stdout: `${JSON.stringify({ url: URL })}\n` }
    const cases: [string[], string[]][] = [
      [[], ["pr", "view", "--json", "url"]],
      [["40"], ["pr", "view", "40", "--json", "url"]]
    ]
    for (const [args, resolve] of cases) {
      const run = ship([...args, "--json"], { commands: { "pr view": view }, graphql: [served(MERGED)] })
      assert.equal(run.status, 0, run.stderr)
      assert.deepEqual(run.calls, [AUTH, resolve, READ])
    }
  })

  it("prints its usage with --help", () => {
    const run = ship(["--help"], {})
    assert.equal(run.status, 0, run.stderr)
    const usage =
      "Usage: dw-sdlc pr ship [<n>] [-R owner/name] [--merge] [--review full|light|off] [--dry-run] [--json] [--verbose]\n"
    assert.ok(run.stdout.startsWith(usage), run.stdout)
    assert.deepEqual(run.calls, [])
  })

  it("prints one line without --json: the status, the action unless it repeats it, the reason and the command", () => {
    const cases: [Pr, number, string][] = [
      [MERGED, 0, "done: merged as b04365a — git push origin --delete feat/example"],
      [{ ...MERGED, headDeleted: true }, 0, "done: merged as b04365a"],
      [{ ...MERGED, fromFork: true }, 0, "done: merged as b04365a"],
      [{ ...GREEN, state: "CLOSED" }, 30, "park stop: closed without merging"],
      [{ ...GREEN, mergeable: "UNKNOWN" }, 20, "wait: mergeability-unknown, recheck in 15 s"],
      [GREEN, 30, `park ready-to-merge: pr.merge is ask: the merge is the dev's — ${DEV_MERGE}`]
    ]
    for (const [pr, status, line] of cases) {
      const run = ship(TARGET, { graphql: [served(pr)] })
      assert.deepEqual([run.status, run.stdout], [status, `${line}\n`], run.stderr)
    }
  })
})

/** The script's own review marker on the head: a context, never a check. */
const REVIEWED: Context = {
  kind: "status",
  name: "dw-sdlc/review",
  state: "SUCCESS",
  startedAt: "2026-10-31T11:05:00Z"
}
/** Reviewed, and no check reported on the head, committed at 11:00. */
const UNCHECKED: Pr = { ...GREEN, checks: [REVIEWED] }
const STARTED = "2026-10-31T11:01:00Z"
const READY_AT = "2026-10-31T12:00:00Z"
const SKIPPED_RUN: Context = { kind: "run", name: "Check", state: "SKIPPED", link: RUN, startedAt: STARTED }
/** Reviewed, its one check skipped: what a draft reports in a repository that runs CI once it is ready. */
const SKIPPED: Pr = { ...GREEN, checks: [SKIPPED_RUN, REVIEWED] }
/** Reviewed, its one required check running since STARTED. */
const PENDING: Pr = {
  ...GREEN,
  mergeStateStatus: "BLOCKED",
  checks: [
    { kind: "run", name: "Check", state: "IN_PROGRESS", link: RUN, startedAt: STARTED, required: true },
    REVIEWED
  ]
}

/** The environment that sets the script's clock `seconds` after `time`. */
function clockAt(time: string, seconds: number): NodeJS.ProcessEnv {
  return { DW_SDLC_NOW: new Date(Date.parse(time) + seconds * 1000).toISOString() }
}

describe("dw-sdlc pr ship while no check has answered", () => {
  const merge = `gh pr merge 40 --squash --match-head-commit ${HEAD}`

  it("waits 15 s on a head whose only context is dw-sdlc/review, 60 s after its commit", () => {
    const run = json(UNCHECKED, [], clockAt(GREEN.committedAt, 60))
    assert.equal(run.status, 20, run.stderr)
    assert.deepEqual(run.document, {
      pr: URL,
      head: HEAD,
      base: "main",
      status: "wait",
      action: "wait",
      actor: "script",
      reason: "unverified",
      recheckAfter: 15,
      blockers: [],
      performed: []
    })
    assert.deepEqual(run.calls, [AUTH, READ])
  })

  it("parks the same head 121 s after its commit as unverified, with the merge command for the dev", () => {
    const run = json(UNCHECKED, [], clockAt(GREEN.committedAt, 121))
    assert.equal(run.status, 30, run.stderr)
    assert.deepEqual(run.document, {
      pr: URL,
      head: HEAD,
      base: "main",
      status: "park",
      action: "unverified",
      actor: "dev",
      reason: "no check reported on e36732e within 120 s of its commit",
      command: merge,
      blockers: [],
      performed: []
    })
  })

  it("waits on a ready head whose every check was skipped, its grace counted from its ready", () => {
    const run = json({ ...SKIPPED, readyAt: READY_AT }, [], clockAt(READY_AT, 60))
    assert.equal(run.status, 20, run.stderr)
    assert.deepEqual(run.document, {
      pr: URL,
      head: HEAD,
      base: "main",
      status: "wait",
      action: "wait",
      actor: "script",
      reason: "unverified",
      recheckAfter: 15,
      blockers: [],
      performed: []
    })
  })

  it("parks that head 121 s after its ready, and never merges on the skipped check", () => {
    const run = json({ ...SKIPPED, readyAt: READY_AT }, [], clockAt(READY_AT, 121))
    assert.equal(run.status, 30, run.stderr)
    assert.deepEqual(run.document, {
      pr: URL,
      head: HEAD,
      base: "main",
      status: "park",
      action: "unverified",
      actor: "dev",
      reason: "every check on e36732e was skipped, 120 s after its commit or its ready",
      command: merge,
      blockers: [],
      performed: []
    })
  })

  it("takes a skipped check beside one that ran as verified", () => {
    const run = json({ ...GREEN, checks: [SKIPPED_RUN, ...GREEN.checks] }, [], clockAt(READY_AT, 121))
    assert.ok(!run.stdout.includes('"unverified"'), run.stdout)
  })

  it("waits 60 s on a check pending 10 min", () => {
    const run = json(PENDING, [], clockAt(STARTED, 10 * 60))
    assert.equal(run.status, 20, run.stderr)
    assert.deepEqual(run.document, {
      pr: URL,
      head: HEAD,
      base: "main",
      status: "wait",
      action: "wait",
      actor: "script",
      reason: "ci-pending",
      recheckAfter: 60,
      blockers: [],
      performed: []
    })
  })

  it("parks a check pending 41 min as ci-stuck, the dev's to look at", () => {
    const run = json(PENDING, [], clockAt(STARTED, 41 * 60))
    assert.equal(run.status, 30, run.stderr)
    assert.deepEqual(run.document, {
      pr: URL,
      head: HEAD,
      base: "main",
      status: "park",
      action: "ci-stuck",
      actor: "dev",
      reason: "1 check(s) pending for 41 min, past the 40 min budget",
      blockers: [],
      performed: []
    })
  })

  it("counts the budget from the first start among the pending checks, one not yet started from the commit", () => {
    const passed: Context = { kind: "status", name: "ci/legacy", state: "SUCCESS", startedAt: "2026-10-31T11:00:30Z" }
    const lint: Context = { kind: "run", name: "Lint", state: "IN_PROGRESS", startedAt: "2026-10-31T11:20:00Z" }
    const queued: Context = { kind: "run", name: "Docs", state: "QUEUED", startedAt: null }
    const minute41 = clockAt(GREEN.committedAt, 41 * 60)
    const cases: [Context[], number][] = [
      [[...PENDING.checks, passed, lint], 20],
      [[...PENDING.checks, passed, lint, queued], 30]
    ]
    for (const [checks, status] of cases) {
      const run = json({ ...PENDING, checks }, [], minute41)
      assert.equal(run.status, status, run.stdout)
    }
  })

  it("reads the system clock when DW_SDLC_NOW is not set", () => {
    const cases: [string, number][] = [
      ["2000-01-01T00:00:00Z", 30],
      ["2999-01-01T00:00:00Z", 20]
    ]
    for (const [committedAt, status] of cases) {
      const run = json({ ...UNCHECKED, committedAt }, [], { DW_SDLC_NOW: undefined })
      assert.equal(run.status, status, `${committedAt}: ${run.stdout}`)
    }
  })

  it("prints each wait and park as one line", () => {
    const cases: [Pr, NodeJS.ProcessEnv, number, string][] = [
      [UNCHECKED, clockAt(GREEN.committedAt, 60), 20, "wait: unverified, recheck in 15 s"],
      [
        UNCHECKED,
        clockAt(GREEN.committedAt, 121),
        30,
        `park unverified: no check reported on e36732e within 120 s of its commit — ${merge}`
      ],
      [PENDING, clockAt(STARTED, 10 * 60), 20, "wait: ci-pending, recheck in 60 s"],
      [PENDING, clockAt(STARTED, 41 * 60), 30, "park ci-stuck: 1 check(s) pending for 41 min, past the 40 min budget"]
    ]
    for (const [pr, env, status, line] of cases) {
      const run = ship(TARGET, { graphql: [served(pr)] }, env)
      assert.deepEqual([run.status, run.stdout], [status, `${line}\n`], run.stderr)
    }
  })
})

/** The actions of the document's blockers, in order. */
function blockersOf(document: unknown): unknown[] {
  assert.ok(typeof document === "object" && document !== null && "blockers" in document)
  assert.ok(Array.isArray(document.blockers))
  return document.blockers.map((blocker: unknown) =>
    typeof blocker === "object" && blocker !== null && "action" in blocker ? blocker.action : blocker
  )
}

describe("dw-sdlc pr ship hands the pull request to the agent", () => {
  it("answers each of the prototype's states for the agent's rows, as a line, an exit code and blockers", () => {
    const cases: [string, Pr, number, string, string[]][] = [
      [
        "draft, CI failing",
        { ...GREEN, draft: true, checks: [FAILING] },
        10,
        "act fix-ci: 1 check(s) failing",
        ["review", "mark-ready"]
      ],
      [
        "conflicts, CI failing",
        { ...GREEN, mergeable: "CONFLICTING", mergeStateStatus: "DIRTY", checks: [FAILING] },
        10,
        "act fix-conflicts: conflicts with main",
        ["fix-ci", "review"]
      ],
      [
        "CI failing",
        { ...GREEN, mergeStateStatus: "UNSTABLE", checks: [FAILING] },
        10,
        "act fix-ci: 1 check(s) failing",
        ["review"]
      ],
      [
        "open thread, not reviewed",
        { ...GREEN, checks: [PASSING], threads: [THREAD] },
        10,
        "act address-review: 1 unresolved thread(s)",
        ["review"]
      ],
      [
        "changes requested",
        { ...GREEN, reviewDecision: "CHANGES_REQUESTED" },
        10,
        "act address-review: changes requested",
        []
      ],
      [
        "green, not reviewed",
        { ...GREEN, checks: [PASSING] },
        10,
        "act review: no dw-sdlc/review success on e36732e",
        []
      ],
      [
        "thread answered last by the viewer",
        { ...GREEN, threads: [{ ...THREAD, lastByViewer: true }] },
        30,
        "park awaiting-reply: 1 thread(s) await a reply",
        []
      ]
    ]
    for (const [name, pr, status, line, blockers] of cases) {
      const run = ship(TARGET, { graphql: [served(pr)] })
      assert.deepEqual([run.status, run.stdout], [status, `${line}\n`], `${name}: ${run.stderr}`)
      assert.deepEqual(blockersOf(json(pr).document), blockers, name)
    }
  })

  it("asks for the review while CI runs, the wait for CI riding in blockers", () => {
    const running: Context = { kind: "run", name: "Check", state: "IN_PROGRESS", link: RUN, startedAt: STARTED }
    const run = json({ ...GREEN, checks: [running] }, [], clockAt(STARTED, 9 * 60))
    assert.equal(run.status, 10, run.stderr)
    assert.ok(typeof run.document === "object" && run.document !== null && "action" in run.document)
    assert.deepEqual([run.document.action, blockersOf(run.document)], ["review", ["wait"]], run.stdout)
  })

  it("answers fix-conflicts for conflicts and a failing check, the check riding in blockers for the same push", () => {
    const run = json({ ...GREEN, mergeable: "CONFLICTING", mergeStateStatus: "DIRTY", checks: [FAILING] })
    assert.equal(run.status, 10, run.stderr)
    assert.deepEqual(run.document, {
      pr: URL,
      head: HEAD,
      base: "main",
      status: "act",
      action: "fix-conflicts",
      actor: "agent",
      reason: "conflicts with main",
      details: { base: "main" },
      blockers: [
        {
          action: "fix-ci",
          actor: "agent",
          reason: "1 check(s) failing",
          details: { checks: [{ name: "Check", link: RUN, log: LOG }] }
        },
        {
          action: "review",
          actor: "agent",
          reason: "no dw-sdlc/review success on e36732e",
          details: { depth: "full", source: "config", reviewCommand: "/code-review" }
        }
      ],
      performed: []
    })
    assert.deepEqual(run.calls, [AUTH, READ])
  })

  it("lists each failing check with its link, and the command that prints its log only for an Actions job", () => {
    const circle: Context = { kind: "status", name: "ci/circleci", state: "ERROR", link: CIRCLE }
    const skipped: Context = { kind: "run", name: "Docs", state: "SKIPPED" }
    const run = json({ ...GREEN, mergeStateStatus: "UNSTABLE", checks: [FAILING, circle, skipped, REVIEWED] })
    assert.equal(run.status, 10, run.stderr)
    assert.deepEqual(run.document, {
      pr: URL,
      head: HEAD,
      base: "main",
      status: "act",
      action: "fix-ci",
      actor: "agent",
      reason: "2 check(s) failing",
      details: {
        checks: [
          { name: "Check", link: RUN, log: LOG },
          { name: "ci/circleci", link: CIRCLE }
        ]
      },
      blockers: [],
      performed: []
    })
  })

  it("takes a dw-sdlc/review success on the head as its review, and a dw-sdlc/ failure as neither CI nor a review", () => {
    const reviewed = json({ ...GREEN, checks: [FAILING, REVIEWED] })
    assert.deepEqual([reviewed.status, blockersOf(reviewed.document)], [10, []], reviewed.stdout)
    const failed = json({ ...GREEN, checks: [PASSING, { ...REVIEWED, state: "FAILURE" }] })
    assert.equal(failed.status, 10, failed.stderr)
    assert.ok(typeof failed.document === "object" && failed.document !== null && "action" in failed.document)
    assert.deepEqual([failed.document.action, blockersOf(failed.document)], ["review", []], failed.stdout)
  })

  it("hands the agent the threads someone else spoke last on; resolved and outdated threads do not count", () => {
    const ghost: Thread = { id: "PRRT_ghost", path: "src/b.ts", line: null, author: null, body: "A file-level note." }
    const run = json({
      ...GREEN,
      threads: [
        THREAD,
        ghost,
        { ...THREAD, id: "PRRT_replied", lastByViewer: true },
        { ...THREAD, id: "PRRT_outdated", outdated: true },
        { ...THREAD, id: "PRRT_resolved", resolved: true }
      ]
    })
    assert.equal(run.status, 10, run.stderr)
    assert.deepEqual(run.document, {
      pr: URL,
      head: HEAD,
      base: "main",
      status: "act",
      action: "address-review",
      actor: "agent",
      reason: "2 unresolved thread(s)",
      details: { threads: [LISTED, { ...ghost, author: "ghost" }] },
      blockers: [
        {
          action: "awaiting-reply",
          actor: "dev",
          reason: "1 thread(s) await a reply",
          details: { threads: [{ ...LISTED, id: "PRRT_replied" }] }
        }
      ],
      performed: []
    })
  })

  it("parks a pull request whose open threads the viewer answered last, the reply the dev's to await", () => {
    const run = json({
      ...GREEN,
      threads: [
        { ...THREAD, lastByViewer: true },
        { ...THREAD, outdated: true }
      ]
    })
    assert.equal(run.status, 30, run.stderr)
    assert.deepEqual(run.document, {
      pr: URL,
      head: HEAD,
      base: "main",
      status: "park",
      action: "awaiting-reply",
      actor: "dev",
      reason: "1 thread(s) await a reply",
      details: { threads: [LISTED] },
      blockers: [],
      performed: []
    })
  })

  it("answers a merged, closed or still-computing pull request alone, whatever else it needs", () => {
    const busy = { checks: [FAILING], threads: [THREAD], reviewDecision: "CHANGES_REQUESTED" }
    const cases: Pr[] = [
      { ...MERGED, ...busy },
      { ...GREEN, ...busy, state: "CLOSED" },
      { ...GREEN, ...busy, mergeable: "UNKNOWN" }
    ]
    for (const pr of cases) {
      const run = json(pr)
      assert.deepEqual(blockersOf(run.document), [], run.stdout)
    }
  })
})

/** The reply for GREEN with `edit` applied to its pull request. */
function broken(edit: (pr: Record<string, unknown>) => void): Response {
  const node = pullRequestOf(GREEN)
  edit(node)
  return reply(node)
}

describe("dw-sdlc pr ship when it cannot run", () => {
  const REMEDY = {
    reply: "gh answered a shape dw-sdlc does not read; report it with the output of gh --version",
    target: "check the number, or name the repository with -R owner/name"
  }

  it("exits 2 with a remedy when gh is not on PATH", () => {
    const run = runBin(["pr", "ship", ...TARGET], repo(), { PATH: scratch("no-gh") })
    assert.equal(run.status, 2)
    assert.deepEqual(lines(run.stderr), [
      "dw-sdlc pr ship: gh is not on PATH — install the GitHub CLI from https://cli.github.com"
    ])
  })

  it("exits 2 with a remedy when gh is not authenticated, and reads nothing", () => {
    const stderr = "You are not logged into any GitHub hosts. To log in, run: gh auth login\n"
    const run = ship(TARGET, { commands: { "auth status": { exit: 1, stderr } } })
    assert.equal(run.status, 2)
    assert.deepEqual(lines(run.stderr), [
      "dw-sdlc pr ship: gh auth status failed: You are not logged into any GitHub hosts. To log in, run: gh auth login — run gh auth login, or set GH_TOKEN"
    ])
    assert.deepEqual(run.calls, [AUTH])
  })

  it("names the failure gh auth status marks under the host, not the host line above it", () => {
    const stderr = "github.com\n  X Failed to log in to github.com using token (GH_TOKEN)\n  - Active account: true\n"
    const run = ship(TARGET, { commands: { "auth status": { exit: 1, stderr } } })
    assert.equal(run.status, 2)
    assert.deepEqual(lines(run.stderr), [
      "dw-sdlc pr ship: gh auth status failed: Failed to log in to github.com using token (GH_TOKEN) — run gh auth login, or set GH_TOKEN"
    ])
  })

  it("checks gh's auth on the host gh api reads from alone, so a broken account elsewhere never stops it", () => {
    const run = ship(TARGET, { graphql: [served(GREEN)] }, { GH_HOST: "ghe.example.com" })
    assert.equal(run.status, 30, run.stderr)
    assert.deepEqual(run.calls[0], ["auth", "status", "--active", "--hostname", "ghe.example.com"])
  })

  it("exits 2 with a remedy when DW_SDLC_NOW is not a time", () => {
    const run = ship([...TARGET, "--json"], { graphql: [served(GREEN)] }, { DW_SDLC_NOW: "yesterday" })
    assert.equal(run.status, 2)
    assert.deepEqual(lines(run.stderr), [
      `dw-sdlc pr ship: DW_SDLC_NOW is "yesterday", not an ISO 8601 time — unset it: it stands in for the clock in tests`
    ])
    assert.equal(run.stdout, "")
  })

  it("exits 2 naming the pull request when GitHub has no such pull request", () => {
    const stderr = "gh: Could not resolve to a PullRequest with the number of 40.\n"
    const run = ship(TARGET, { graphql: [{ exit: 1, stderr }] })
    assert.equal(run.status, 2)
    assert.deepEqual(lines(run.stderr), [
      `dw-sdlc pr ship: byarcadia-app/foundation#40: Could not resolve to a PullRequest with the number of 40. — ${REMEDY.target}`
    ])
  })

  it("exits 2 with a remedy when gh pr view resolves no pull request, and reads nothing", () => {
    const cases: [string[], string, string[]][] = [
      [[], 'no pull requests found for branch "main"', ["pr", "view", "--json", "url"]],
      [
        ["-R", "byarcadia-app/foundation"],
        "argument required when using the --repo flag",
        ["pr", "view", "-R", "byarcadia-app/foundation", "--json", "url"]
      ]
    ]
    for (const [args, said, resolve] of cases) {
      const run = ship(args, { commands: { "pr view": { exit: 1, stderr: `${said}\n\nUsage: gh pr view\n` } } })
      assert.equal(run.status, 2, said)
      assert.deepEqual(lines(run.stderr), [
        `dw-sdlc pr ship: gh pr view found no pull request: ${said} — name it: dw-sdlc pr ship <n> -R owner/name`
      ])
      assert.deepEqual(run.calls, [AUTH, resolve])
    }
  })

  it("exits 2 with the usage on a bad argument, before any gh call", () => {
    const cases: [string[], string][] = [
      [["--frobnicate"], "dw-sdlc pr ship: Unknown option '--frobnicate'"],
      [["forty"], 'dw-sdlc pr ship: "forty" is not a pull request number'],
      [["40", "41"], "dw-sdlc pr ship: name one pull request, not 2"],
      [["40", "-R", "foundation"], 'dw-sdlc pr ship: -R takes owner/name, not "foundation"']
    ]
    for (const [args, problem] of cases) {
      const run = ship(args, {})
      assert.equal(run.status, 2, args.join(" "))
      const [first = "", ...rest] = lines(run.stderr)
      assert.ok(first.startsWith(problem), `${args.join(" ")}: ${first}`)
      assert.ok(
        rest.some((line) => line.startsWith("Usage: dw-sdlc pr ship")),
        run.stderr
      )
      assert.deepEqual(run.calls, [], args.join(" "))
    }
  })

  it("exits 2 naming the field when the reply misses one the state needs or holds a value it does not read", () => {
    const at = "data.repository.pullRequest"
    const cases: [Scenario["graphql"], string][] = [
      [[broken((pr) => delete pr.mergeable)], `${at}.mergeable is missing, not one of MERGEABLE, CONFLICTING, UNKNOWN`],
      [[broken((pr) => (pr.state = "DRAFT"))], `${at}.state is "DRAFT", not one of OPEN, CLOSED, MERGED`],
      [[broken((pr) => (pr.headRefOid = 7))], `${at}.headRefOid is 7, not a string`],
      [[broken((pr) => delete pr.number)], `${at}.number is missing, not an integer`],
      [[broken((pr) => (pr.headRef = "feat/example"))], `${at}.headRef is "feat/example", not an object`],
      [[broken((pr) => delete pr.isCrossRepository)], `${at}.isCrossRepository is missing, not a boolean`],
      [
        [
          broken(
            (pr) => (pr.commits = { nodes: [{ commit: { committedDate: "yesterday", statusCheckRollup: null } }] })
          )
        ],
        `${at}.commits.nodes[0].commit.committedDate is "yesterday", not a time`
      ],
      [
        [
          broken(
            (pr) =>
              (pr.commits = {
                nodes: [
                  {
                    commit: { committedDate: "2026-10-31T11:00:00Z", statusCheckRollup: { contexts: { nodes: [{}] } } }
                  }
                ]
              })
          )
        ],
        `${at}.commits.nodes[0].commit.statusCheckRollup.contexts.nodes[0] is neither a CheckRun nor a StatusContext`
      ],
      [
        [
          broken(
            (pr) =>
              (pr.reviewThreads = {
                nodes: [
                  {
                    id: "PRRT_kwDOexample",
                    isResolved: false,
                    isOutdated: false,
                    path: "src/a.ts",
                    line: 1,
                    comments: { nodes: [{ author: null, body: "A note." }] }
                  }
                ]
              })
          )
        ],
        `${at}.reviewThreads.nodes[0].latest is missing, not an object`
      ],
      [[broken((pr) => (pr.reviewThreads = { nodes: [] }))], `${at}.reviewThreads.pageInfo is missing, not an object`],
      [
        [
          broken(
            (pr) =>
              (pr.commits = {
                nodes: [
                  { commit: { committedDate: "2026-10-31T11:00:00Z", statusCheckRollup: { contexts: { nodes: [] } } } }
                ]
              })
          )
        ],
        `${at}.commits.nodes[0].commit.statusCheckRollup.contexts.pageInfo is missing, not an object`
      ],
      [[{ stdout: "<html>" }], "the reply is not JSON"]
    ]
    for (const [graphql, problem] of cases) {
      const run = ship([...TARGET, "--json"], graphql === undefined ? {} : { graphql })
      assert.equal(run.status, 2, problem)
      assert.deepEqual(lines(run.stderr), [`dw-sdlc pr ship: the reply does not parse: ${problem} — ${REMEDY.reply}`])
      assert.equal(run.stdout, "")
    }
  })
})

/** The fields of a document a test names, those it carries. */
function fieldsOf(document: unknown, keys: string[]): Record<string, unknown> {
  assert.ok(typeof document === "object" && document !== null)
  return Object.fromEntries(Object.entries(document).filter(([key]) => keys.includes(key)))
}

/** The update and the mark-ready the script runs, the repository named. */
const UPDATE = ["pr", "update-branch", "40", "-R", "byarcadia-app/foundation"]
const READY = ["pr", "ready", "40", "-R", "byarcadia-app/foundation"]
const RUNS = { "update-branch": UPDATE, "mark-ready": READY, merge: MERGE }
/** gh's answer as a test stands it in for an Action whose reply was lost after GitHub applied it. */
const LOST: Response = { exit: 1, stderr: 'Post "https://api.github.com/graphql": context deadline exceeded\n' }
/** The base a later push to the base branch leaves. */
const MOVED_BASE = "0c1d2e3f4a5b60718293a4b5c6d7e8f9a0b1c2d3"
/** The head an update of the branch leaves. */
const UPDATED = "5f0c2a7e9d4b1c3a6e8f0d2b4a6c8e0f1a3b5c7d"
/** The compare of the base with the head an update leaves: whether it carries the base the update read. */
const UPDATED_COMPARE = baseWith(UPDATED)

/**
 * A command under `performed`: `ok` whether the read after it shows the Action took effect, beside gh's
 * exit status and stderr, as `response` gives them; under --dry-run `ok` is null and gh never ran.
 */
function performedEntry(command: string, ok: boolean | null, response: Response): Record<string, unknown> {
  if (ok === null) {
    return { command, ok }
  }
  const stderr = response.stderr?.trim() ?? ""
  return { command, ok, exit: response.exit ?? 0, ...(stderr === "" ? {} : { stderr }) }
}

/** A script Action under `performed`, as `performedEntry` records it. */
function ran(action: keyof typeof RUNS, ok: boolean | null, response: Response = {}): unknown {
  return { action, ...performedEntry(`gh ${RUNS[action].join(" ")}`, ok, response) }
}

/** `performed` once the call ran the merge, as `performedEntry` records it. */
function performedMerge(ok: boolean | null, response: Response = {}): unknown[] {
  return [ran("merge", ok, response)]
}

describe("dw-sdlc pr ship ends a pull request", () => {
  it("merges a ready pull request under pr.merge auto with the head it read, reads it again and answers done", () => {
    const run = ship([...TARGET, "--json"], { graphql: [served(GREEN), served(MERGED)] }, {}, AUTO)
    assert.equal(run.status, 0, run.stderr)
    assert.deepEqual(JSON.parse(run.stdout), {
      pr: URL,
      head: HEAD,
      base: "main",
      status: "done",
      action: "done",
      actor: "dev",
      reason: "merged as b04365a",
      command: "git push origin --delete feat/example",
      details: { mergeCommit: MERGE_COMMIT },
      blockers: [],
      performed: performedMerge(true)
    })
    assert.deepEqual(run.calls, [AUTH, READ, MERGE, READ])
  })

  it("merges under pr.merge ask when --merge is given for the call", () => {
    const ask = { [COMMITTED_FILE]: { pr: { merge: "ask" } } }
    const run = ship([...TARGET, "--json", "--merge"], { graphql: [served(GREEN), served(MERGED)] }, {}, ask)
    assert.equal(run.status, 0, run.stderr)
    assert.deepEqual(fieldsOf(JSON.parse(run.stdout), ["status", "performed"]), {
      status: "done",
      performed: performedMerge(true)
    })
    assert.deepEqual(run.calls, [AUTH, READ, MERGE, READ])
  })

  it("parks under ask while a config layer is invalid, whatever the committed file sets", () => {
    const cases: Files[] = [
      { ...AUTO, [LOCAL_FILE]: "{ not json" },
      { ...AUTO, [LOCAL_FILE]: { pr: { merge: "always" } } },
      { [COMMITTED_FILE]: { pr: { merge: "ask" } }, [LOCAL_FILE]: { pr: { merge: "auto" } } }
    ]
    for (const files of cases) {
      const run = json(GREEN, [], {}, files)
      assert.equal(run.status, 30, run.stderr)
      assert.deepEqual(fieldsOf(run.document, ["action", "reason", "command", "performed"]), {
        action: "ready-to-merge",
        reason: "pr.merge is ask: the merge is the dev's",
        command: DEV_MERGE,
        performed: []
      })
      assert.deepEqual(run.calls, [AUTH, READ], JSON.stringify(files))
    }
  })

  it("parks a pull request that needs an approving review as awaiting-approval, under auto too", () => {
    const run = json({ ...GREEN, mergeStateStatus: "BLOCKED", reviewDecision: "REVIEW_REQUIRED" }, [], {}, AUTO)
    assert.equal(run.status, 30, run.stderr)
    assert.deepEqual(run.document, {
      pr: URL,
      head: HEAD,
      base: "main",
      status: "park",
      action: "awaiting-approval",
      actor: "dev",
      reason: "an approving review is required",
      blockers: [],
      performed: []
    })
    assert.deepEqual(run.calls, [AUTH, READ])
  })

  it("lists awaiting-approval among the blockers, and who merges never", () => {
    const unreviewed = json({ ...GREEN, checks: [PASSING], reviewDecision: "REVIEW_REQUIRED" }, [], {}, AUTO)
    assert.deepEqual(blockersOf(unreviewed.document), ["awaiting-approval"], unreviewed.stdout)
    const failing = json({ ...GREEN, checks: [FAILING, REVIEWED], viewerDidAuthor: false }, [], {}, AUTO)
    assert.deepEqual(blockersOf(failing.document), [], failing.stdout)
  })

  it("parks another author's pull request as ready-to-merge, reviewed or not, under ask, auto and --merge", () => {
    for (const [flags, files] of [
      [[], {}],
      [[], AUTO],
      [["--merge"], {}]
    ] satisfies [string[], Files][]) {
      for (const [reviewed, checks] of [
        ["reviewed", GREEN.checks],
        ["not reviewed", [PASSING]]
      ] satisfies [string, Context[]][]) {
        const name = `${reviewed}, flags [${flags.join(" ")}], config ${JSON.stringify(files)}`
        const run = json({ ...GREEN, viewerDidAuthor: false, checks }, flags, {}, files)
        assert.equal(run.status, 30, `${name}: ${run.stderr}`)
        assert.deepEqual(
          run.document,
          {
            pr: URL,
            head: HEAD,
            base: "main",
            status: "park",
            action: "ready-to-merge",
            actor: "dev",
            reason: "another author's pull request: the merge is the dev's",
            command: DEV_MERGE,
            blockers: [],
            performed: []
          },
          name
        )
        assert.deepEqual(run.calls, [AUTH, READ], name)
      }
    }
  })

  it("lists no review among the blockers of another author's pull request, only of the viewer's own", () => {
    for (const [viewerDidAuthor, blockers] of [
      [true, ["review"]],
      [false, []]
    ] satisfies [boolean, string[]][]) {
      const run = json({ ...GREEN, viewerDidAuthor, mergeStateStatus: "UNSTABLE", checks: [FAILING] }, [], {}, AUTO)
      assert.equal(run.status, 10, run.stderr)
      assert.deepEqual(fieldsOf(run.document, ["action"]), { action: "fix-ci" })
      assert.deepEqual(blockersOf(run.document), blockers, run.stdout)
    }
  })

  it("performs nothing with --dry-run: the merge it would run is under performed with ok null, and the dev's", () => {
    for (const [flags, files] of [
      [["--dry-run"], AUTO],
      [["--dry-run", "--merge"], {}]
    ] satisfies [string[], Files][]) {
      const run = json(GREEN, flags, {}, files)
      assert.equal(run.status, 30, run.stderr)
      assert.deepEqual(run.document, {
        pr: URL,
        head: HEAD,
        base: "main",
        status: "park",
        action: "ready-to-merge",
        actor: "dev",
        reason: "the script would merge it; --dry-run performs nothing",
        command: DEV_MERGE,
        blockers: [],
        performed: performedMerge(null)
      })
      assert.deepEqual(run.calls, [AUTH, READ], flags.join(" "))
    }
    const failing = json({ ...GREEN, checks: [FAILING, REVIEWED] }, ["--dry-run"], {}, AUTO)
    assert.deepEqual(fieldsOf(failing.document, ["action", "performed"]), { action: "fix-ci", performed: [] })
  })

  it("ends the line of a ready-to-merge with the merge command", () => {
    const cases: [Files, string[], string][] = [
      [{}, [], "pr.merge is ask: the merge is the dev's"],
      [AUTO, ["--dry-run"], "the script would merge it; --dry-run performs nothing"]
    ]
    for (const [files, flags, reason] of cases) {
      const run = ship([...TARGET, ...flags], { graphql: [served(GREEN)] }, {}, files)
      assert.deepEqual([run.status, run.stdout], [30, `park ready-to-merge: ${reason} — ${DEV_MERGE}\n`], run.stderr)
    }
  })

  it("reads again after a merge refused for a moved head and answers what that read gives", () => {
    const moved = "0d6c3f4a1b2e5d7c9f8a6b4c2e0d1f3a5b7c9e8d"
    const running: Context = { kind: "run", name: "Check", state: "IN_PROGRESS", link: RUN, startedAt: STARTED }
    const stderr = "GraphQL: Head branch was modified. Review and try the merge again. (mergePullRequest)\n"
    const run = ship(
      [...TARGET, "--json"],
      {
        graphql: [served(GREEN), served({ ...GREEN, head: moved, checks: [running] })],
        commands: { "pr merge": { exit: 1, stderr } }
      },
      clockAt(STARTED, 60),
      AUTO
    )
    assert.equal(run.status, 10, run.stderr)
    assert.deepEqual(fieldsOf(JSON.parse(run.stdout), ["head", "status", "action", "reason", "performed"]), {
      head: moved,
      status: "act",
      action: "review",
      reason: "no dw-sdlc/review success on 0d6c3f4",
      performed: performedMerge(false, { exit: 1, stderr })
    })
    assert.deepEqual(run.calls, [AUTH, READ, MERGE, READ])
  })

  it("hands the merge to the dev when the read after it still shows it ready, never merging twice", () => {
    // gh's own refusal of a BLOCKED pull request, the first line its stderr carries, without its icon.
    const blocked =
      "Pull request byarcadia-app/foundation#40 is not mergeable: the base branch policy prohibits the merge."
    const cases: [Response, string][] = [
      [
        {
          exit: 1,
          stderr: `X ${blocked}\nTo have the pull request merged after all the requirements have been met, add the \`--auto\` flag.\n`
        },
        `gh refused the merge: ${blocked}`
      ],
      [{ exit: 1 }, "gh refused the merge: gh exited 1"],
      [{}, "gh accepted the merge; the read does not show it yet"]
    ]
    const ready: Pr = { ...GREEN, mergeStateStatus: "BLOCKED" }
    for (const [merged, reason] of cases) {
      const scenario = { graphql: [served(ready), served(ready)], commands: { "pr merge": merged } }
      const run = ship([...TARGET, "--json"], scenario, {}, AUTO)
      assert.equal(run.status, 30, run.stderr)
      assert.deepEqual(fieldsOf(JSON.parse(run.stdout), ["action", "actor", "reason", "command", "performed"]), {
        action: "ready-to-merge",
        actor: "dev",
        reason,
        command: DEV_MERGE,
        performed: performedMerge(false, merged)
      })
      assert.deepEqual(run.calls, [AUTH, READ, MERGE, READ], reason)
    }
  })

  it("records a merge as ok when the read after it shows it merged, though gh exited non-zero, its stderr beside it", () => {
    // The merge of #207: GitHub merged while the machine slept with the request in flight, and gh exited 1.
    const scenario = { graphql: [served(GREEN), served(MERGED)], commands: { "pr merge": LOST } }
    const run = ship([...TARGET, "--json"], scenario, {}, AUTO)
    assert.equal(run.status, 0, run.stderr)
    assert.deepEqual(fieldsOf(JSON.parse(run.stdout), ["status", "reason", "performed"]), {
      status: "done",
      reason: "merged as b04365a",
      performed: performedMerge(true, LOST)
    })
    assert.deepEqual(run.calls, [AUTH, READ, MERGE, READ])
  })
})

/** Green, reviewed and the viewer's own, behind its base under a rule that wants it up to date. */
const BEHIND: Pr = { ...GREEN, mergeStateStatus: "BEHIND" }
/** Green, reviewed and the viewer's own, still a draft. */
const DRAFT: Pr = { ...GREEN, draft: true }

describe("dw-sdlc pr ship updates a branch and marks a draft ready", () => {
  it("updates a branch behind its base, reads the new head again and answers it, never merging in that call", () => {
    const updated = UPDATED
    const running: Context = { kind: "run", name: "Check", state: "IN_PROGRESS", link: RUN, startedAt: STARTED }
    const after: Pr = { ...GREEN, head: updated, mergeStateStatus: "BLOCKED", checks: [running] }
    const scenario = { graphql: [served(BEHIND), served(after)], commands: comparedBehind(0, UPDATED) }
    const run = ship([...TARGET, "--json"], scenario, clockAt(STARTED, 60), AUTO)
    assert.equal(run.status, 10, run.stderr)
    assert.deepEqual(JSON.parse(run.stdout), {
      pr: URL,
      head: updated,
      base: "main",
      status: "act",
      action: "review",
      actor: "agent",
      reason: "no dw-sdlc/review success on 5f0c2a7",
      details: { depth: "full", source: "config", reviewCommand: "/code-review" },
      blockers: [{ action: "wait", actor: "script", reason: "ci-pending" }],
      performed: [ran("update-branch", true)]
    })
    assert.deepEqual(run.calls, [AUTH, READ, UPDATE, READ, UPDATED_COMPARE])
  })

  it("merges a branch behind its base as it is where GitHub reads it CLEAN or UNSTABLE, under no rule that it be up to date", () => {
    for (const mergeStateStatus of ["CLEAN", "UNSTABLE"]) {
      const scenario = {
        graphql: [served({ ...GREEN, mergeStateStatus }), served(MERGED)],
        commands: comparedBehind(2)
      }
      const run = ship([...TARGET, "--json"], scenario, {}, AUTO)
      assert.equal(run.status, 0, run.stderr)
      assert.deepEqual(fieldsOf(JSON.parse(run.stdout), ["action", "performed"]), {
        action: "done",
        performed: performedMerge(true)
      })
      assert.deepEqual(run.calls, [AUTH, READ, MERGE, READ], mergeStateStatus)
    }
  })

  it("names the update of a branch GitHub reports BEHIND with --dry-run, and performs nothing", () => {
    const run = ship([...TARGET, "--json", "--dry-run"], { graphql: [served(BEHIND)] }, {}, AUTO)
    assert.equal(run.status, 30, run.stderr)
    assert.deepEqual(fieldsOf(JSON.parse(run.stdout), ["status", "action", "actor", "reason", "performed"]), {
      status: "park",
      action: "update-branch",
      actor: "dev",
      reason: "the script would update the branch; --dry-run performs nothing",
      performed: [ran("update-branch", null)]
    })
    assert.deepEqual(run.calls, [AUTH, READ])
  })

  it("reads the base from the base branch's tip, not the baseRefOid GitHub has yet to move to it", () => {
    const lagging: Pr = { ...GREEN, baseOid: MOVED_BASE, reportedBaseOid: BASE_OID }
    const run = ship([...TARGET, "--json", "--verbose"], { graphql: [served(lagging)] })
    assert.equal(run.status, 30, run.stderr)
    assert.equal((JSON.parse(run.stdout) as { facts: { baseOid: string } }).facts.baseOid, MOVED_BASE)
    assert.deepEqual(run.calls, [AUTH, READ])
  })

  it("reads the base from baseRefOid when the base branch is gone", () => {
    const gone: Pr = { ...GREEN, baseOid: MOVED_BASE, reportedBaseOid: BASE_OID, baseDeleted: true }
    const run = ship([...TARGET, "--json", "--verbose"], { graphql: [served(gone)] })
    assert.equal(run.status, 30, run.stderr)
    assert.equal((JSON.parse(run.stdout) as { facts: { baseOid: string } }).facts.baseOid, BASE_OID)
    assert.deepEqual(run.calls, [AUTH, READ])
  })

  it("marks a green, reviewed draft ready, then merges it under pr.merge auto, both under performed in order", () => {
    const run = ship([...TARGET, "--json"], { graphql: [served(DRAFT), served(GREEN), served(MERGED)] }, {}, AUTO)
    assert.equal(run.status, 0, run.stderr)
    assert.deepEqual(JSON.parse(run.stdout), {
      pr: URL,
      head: HEAD,
      base: "main",
      status: "done",
      action: "done",
      actor: "dev",
      reason: "merged as b04365a",
      command: "git push origin --delete feat/example",
      details: { mergeCommit: MERGE_COMMIT },
      blockers: [],
      performed: [ran("mark-ready", true), ran("merge", true)]
    })
    assert.deepEqual(run.calls, [AUTH, READ, READY, READ, MERGE, READ])
  })

  it("marks a reviewed draft ready on its skipped check, then waits for the run ready starts", () => {
    const graphql = [served({ ...SKIPPED, draft: true }), served({ ...SKIPPED, readyAt: READY_AT })]
    const run = ship([...TARGET, "--json"], { graphql }, clockAt(READY_AT, 5), AUTO)
    assert.equal(run.status, 20, run.stderr)
    assert.deepEqual(JSON.parse(run.stdout), {
      pr: URL,
      head: HEAD,
      base: "main",
      status: "wait",
      action: "wait",
      actor: "script",
      reason: "unverified",
      recheckAfter: 15,
      blockers: [],
      performed: [ran("mark-ready", true)]
    })
    assert.deepEqual(run.calls, [AUTH, READ, READY, READ])
  })

  it("marks a draft ready under ask and parks it ready-to-merge; gh's warning that it is ready already is no refusal", () => {
    const warned = { stderr: '! Pull request byarcadia-app/foundation#40 is already "ready for review"\n' }
    const run = ship([...TARGET, "--json"], {
      graphql: [served(DRAFT), served(GREEN)],
      commands: { "pr ready": warned }
    })
    assert.equal(run.status, 30, run.stderr)
    assert.deepEqual(JSON.parse(run.stdout), {
      pr: URL,
      head: HEAD,
      base: "main",
      status: "park",
      action: "ready-to-merge",
      actor: "dev",
      reason: "pr.merge is ask: the merge is the dev's",
      command: DEV_MERGE,
      blockers: [],
      performed: [ran("mark-ready", true, warned)]
    })
    assert.deepEqual(run.calls, [AUTH, READ, READY, READ])
  })

  it("parks another author's draft for the dev with no command, reviewed or not: marking it ready is the author's", () => {
    const awaiting = {
      action: "awaiting-author",
      actor: "dev",
      reason: "another author's draft: marking it ready is the author's"
    }
    for (const [flags, files] of [
      [[], {}],
      [[], AUTO],
      [["--merge"], {}],
      [["--dry-run"], AUTO]
    ] satisfies [string[], Files][]) {
      for (const checks of [GREEN.checks, [PASSING]]) {
        const run = json({ ...DRAFT, viewerDidAuthor: false, checks }, flags, {}, files)
        const name = `flags [${flags.join(" ")}], ${checks.length} check(s)`
        assert.equal(run.status, 30, `${name}: ${run.stderr}`)
        assert.deepEqual(
          run.document,
          { pr: URL, head: HEAD, base: "main", status: "park", ...awaiting, blockers: [], performed: [] },
          name
        )
        assert.deepEqual(run.calls, [AUTH, READ], name)
      }
    }
    const failing = json({ ...DRAFT, viewerDidAuthor: false, checks: [FAILING] }, [], {}, AUTO)
    assert.deepEqual(fieldsOf(failing.document, ["action", "blockers"]), { action: "fix-ci", blockers: [awaiting] })
  })

  it("marks a draft ready last: never while CI fails or runs, the head is unreviewed or a thread awaits a reply", () => {
    const cases: [string, Pr, NodeJS.ProcessEnv, string][] = [
      ["CI failing", { ...DRAFT, checks: [FAILING, REVIEWED] }, {}, "fix-ci"],
      ["not reviewed", { ...DRAFT, checks: [PASSING] }, {}, "review"],
      ["CI pending", { ...PENDING, draft: true }, clockAt(STARTED, 10 * 60), "wait"],
      ["awaiting a reply", { ...DRAFT, threads: [{ ...THREAD, lastByViewer: true }] }, {}, "awaiting-reply"]
    ]
    for (const [name, pr, env, action] of cases) {
      const run = json(pr, [], env, AUTO)
      assert.deepEqual(
        fieldsOf(run.document, ["action", "blockers", "performed"]),
        { action, blockers: [{ action: "mark-ready", actor: "script", reason: "still a draft" }], performed: [] },
        name
      )
      assert.deepEqual(run.calls, [AUTH, READ], name)
    }
  })

  it("reads again after gh refuses the update for a conflict and answers the conflict that read shows", () => {
    const conflicting: Pr = { ...GREEN, mergeable: "CONFLICTING", mergeStateStatus: "DIRTY" }
    const refused = { exit: 1, stderr: "X Cannot update PR branch due to conflicts\n" }
    const scenario = { graphql: [served(BEHIND), served(conflicting)], commands: { "pr update-branch": refused } }
    const run = ship([...TARGET, "--json"], scenario, {}, AUTO)
    assert.equal(run.status, 10, run.stderr)
    assert.deepEqual(fieldsOf(JSON.parse(run.stdout), ["action", "actor", "reason", "performed"]), {
      action: "fix-conflicts",
      actor: "agent",
      reason: "conflicts with main",
      performed: [ran("update-branch", false, refused)]
    })
    assert.deepEqual(run.calls, [AUTH, READ, UPDATE, READ])
  })

  it("hands an update or a mark-ready to the dev when the read after it still calls for it, never running it twice", () => {
    const cases: [Pr, "update-branch" | "mark-ready", Response, string, string][] = [
      [
        BEHIND,
        "update-branch",
        { exit: 1, stderr: "X Cannot update PR branch due to conflicts\n" },
        "gh refused the update: Cannot update PR branch due to conflicts",
        "gh pr update-branch 40"
      ],
      [BEHIND, "update-branch", {}, "gh accepted the update; the read does not show it yet", "gh pr update-branch 40"],
      [
        DRAFT,
        "mark-ready",
        { exit: 1, stderr: "GraphQL: Resource not accessible by integration (markPullRequestReadyForReview)\n" },
        "gh refused the mark-ready: GraphQL: Resource not accessible by integration (markPullRequestReadyForReview)",
        "gh pr ready 40"
      ],
      [DRAFT, "mark-ready", {}, "gh accepted the mark-ready; the read does not show it yet", "gh pr ready 40"]
    ]
    for (const [pr, action, response, reason, command] of cases) {
      const key = action === "update-branch" ? "pr update-branch" : "pr ready"
      const scenario = { graphql: [served(pr), served(pr)], commands: { [key]: response } }
      const run = ship([...TARGET, "--json"], scenario, {}, AUTO)
      assert.equal(run.status, 30, run.stderr)
      assert.deepEqual(
        fieldsOf(JSON.parse(run.stdout), ["status", "action", "actor", "reason", "command", "performed"]),
        {
          status: "park",
          action,
          actor: "dev",
          reason,
          command,
          performed: [ran(action, false, response)]
        }
      )
      assert.deepEqual(run.calls, [AUTH, READ, RUNS[action], READ], reason)
    }
  })

  it("hands an update that took effect to the dev as one that ran when the base moved again, whatever gh's exit", () => {
    const updated: Pr = { ...BEHIND, head: UPDATED }
    const commands = { "pr update-branch": LOST, ...comparedBehind(0, UPDATED) }
    const scenario = { graphql: [served(BEHIND), served({ ...updated, baseOid: MOVED_BASE })], commands }
    const run = ship([...TARGET, "--json"], scenario, {}, AUTO)
    assert.equal(run.status, 30, run.stderr)
    assert.deepEqual(fieldsOf(JSON.parse(run.stdout), ["action", "reason", "performed"]), {
      action: "update-branch",
      reason: "the update ran, and the branch still reads behind its base",
      performed: [ran("update-branch", true, LOST)]
    })
    assert.deepEqual(run.calls, [AUTH, READ, UPDATE, READ, UPDATED_COMPARE])
  })

  it("records an update and a mark-ready as ok when the read after shows them, though gh exited non-zero", () => {
    const cases: [Pr, Pr, "update-branch" | "mark-ready", string][] = [
      [BEHIND, { ...GREEN, head: UPDATED }, "update-branch", "pr update-branch"],
      [DRAFT, GREEN, "mark-ready", "pr ready"]
    ]
    for (const [before, after, action, key] of cases) {
      const commands = { [key]: LOST, ...comparedBehind(0, UPDATED) }
      const scenario = { graphql: [served(before), served(after)], commands }
      const run = ship([...TARGET, "--json"], scenario)
      assert.equal(run.status, 30, `${action}: ${run.stderr}`)
      assert.deepEqual(
        fieldsOf(JSON.parse(run.stdout), ["action", "reason", "performed"]),
        {
          action: "ready-to-merge",
          reason: "pr.merge is ask: the merge is the dev's",
          performed: [ran(action, true, LOST)]
        },
        action
      )
      const compares = action === "update-branch" ? [UPDATED_COMPARE] : []
      assert.deepEqual(run.calls, [AUTH, READ, RUNS[action], READ, ...compares], action)
    }
  })

  it("stops at the first script Action with --dry-run and parks it for the dev with its command, running nothing", () => {
    const cases: [Pr, "update-branch" | "mark-ready", string, string][] = [
      [{ ...BEHIND, draft: true }, "update-branch", "update the branch", "gh pr update-branch 40"],
      [DRAFT, "mark-ready", "mark it ready", "gh pr ready 40"]
    ]
    for (const [pr, action, would, command] of cases) {
      const reason = `the script would ${would}; --dry-run performs nothing`
      const run = json(pr, ["--dry-run"], {}, AUTO)
      assert.equal(run.status, 30, run.stderr)
      assert.deepEqual(fieldsOf(run.document, ["status", "action", "actor", "reason", "command", "performed"]), {
        status: "park",
        action,
        actor: "dev",
        reason,
        command,
        performed: [ran(action, null)]
      })
      assert.deepEqual(run.calls, [AUTH, READ], action)
      const line = ship([...TARGET, "--dry-run"], { graphql: [served(pr)] }, {}, AUTO)
      assert.deepEqual([line.status, line.stdout], [30, `park ${action}: ${reason} — ${command}\n`], line.stderr)
    }
  })
})

/** Where the script posts the status on HEAD, the repository named in the path. */
const STATUSES = `repos/byarcadia-app/foundation/statuses/${HEAD}`

/** The post that marks HEAD reviewed, `why` its description. */
function marked(why: string): string[] {
  return [
    "api",
    STATUSES,
    "--method",
    "POST",
    "--silent",
    "-f",
    "state=success",
    "-f",
    "context=dw-sdlc/review",
    "-f",
    `target_url=${URL}`,
    "-f",
    `description=${why}`
  ]
}

/** The same post as `performed` and a parked answer print it. */
function markedCommand(why: string): string {
  const fields = `-f state=success -f context=dw-sdlc/review -f target_url=${URL} -f 'description=${why}'`
  return `gh api ${STATUSES} --method POST --silent ${fields}`
}

/** The post under `performed`, as `performedEntry` records it. */
function markedRun(why: string, ok: boolean | null, response: Response = {}): unknown {
  return { action: "mark-reviewed", ...performedEntry(markedCommand(why), ok, response) }
}

/** pr.review off, and the merge the script's. */
const OFF: Files = { [COMMITTED_FILE]: { pr: { merge: "auto", review: "off" } } }
/** Green and the viewer's own, its head not reviewed. */
const UNREVIEWED: Pr = { ...GREEN, checks: [PASSING] }

describe("dw-sdlc pr ship at a Review depth", () => {
  it("asks the agent for a full Review under pr.review full, the depth and where it came from under details", () => {
    const run = json(UNREVIEWED)
    assert.equal(run.status, 10, run.stderr)
    assert.deepEqual(run.document, {
      pr: URL,
      head: HEAD,
      base: "main",
      status: "act",
      action: "review",
      actor: "agent",
      reason: "no dw-sdlc/review success on e36732e",
      details: { depth: "full", source: "config", reviewCommand: "/code-review" },
      blockers: [],
      performed: []
    })
    assert.deepEqual(run.calls, [AUTH, READ])
  })

  it("takes --review full over pr.review off, the flag named as the source", () => {
    const run = json(UNREVIEWED, ["--review", "full"], {}, OFF)
    assert.equal(run.status, 10, run.stderr)
    assert.deepEqual(fieldsOf(run.document, ["action", "actor", "details", "performed"]), {
      action: "review",
      actor: "agent",
      details: { depth: "full", source: "flag", reviewCommand: "/code-review" },
      performed: []
    })
    assert.deepEqual(run.calls, [AUTH, READ])
  })

  it("names the command pr.reviewCommand sets for a full Review, the local layer's over the committed one", () => {
    const toolkit = "/pr-review-toolkit:review-pr code errors"
    const cases: [Files, string[], string][] = [
      [{ [COMMITTED_FILE]: { pr: { review: "full", reviewCommand: "/review" } } }, [], "/review"],
      [
        {
          [COMMITTED_FILE]: { pr: { review: "full", reviewCommand: "/review" } },
          [LOCAL_FILE]: { pr: { reviewCommand: toolkit } }
        },
        [],
        toolkit
      ],
      [{ ...OFF, [LOCAL_FILE]: { pr: { reviewCommand: toolkit } } }, ["--review", "full"], toolkit]
    ]
    for (const [files, flags, reviewCommand] of cases) {
      const run = json(UNREVIEWED, flags, {}, files)
      assert.equal(run.status, 10, run.stderr)
      assert.deepEqual(
        fieldsOf(run.document, ["action", "details"]),
        { action: "review", details: { depth: "full", source: flags.length > 0 ? "flag" : "config", reviewCommand } },
        JSON.stringify(files)
      )
    }
  })

  it("asks the agent for a light Review under pr.review light or --review light, each source named", () => {
    const light: Files = { [COMMITTED_FILE]: { pr: { review: "light" } } }
    const cases: [string[], Files, string][] = [
      [[], light, "config"],
      [["--review", "light"], OFF, "flag"],
      [["--review", "light"], {}, "flag"]
    ]
    for (const [args, files, source] of cases) {
      const run = json(UNREVIEWED, args, {}, files)
      assert.equal(run.status, 10, run.stderr)
      assert.deepEqual(fieldsOf(run.document, ["status", "action", "actor", "details", "performed"]), {
        status: "act",
        action: "review",
        actor: "agent",
        details: { depth: "light", source },
        performed: []
      })
      assert.deepEqual(run.calls, [AUTH, READ], JSON.stringify(args))
    }
  })

  it("posts the dw-sdlc/review success itself under --review off, reads again and answers what that read gives", () => {
    const run = ship([...TARGET, "--json", "--review", "off"], { graphql: [served(UNREVIEWED), served(GREEN)] })
    assert.equal(run.status, 30, run.stderr)
    assert.deepEqual(fieldsOf(JSON.parse(run.stdout), ["action", "reason", "performed"]), {
      action: "ready-to-merge",
      reason: "pr.merge is ask: the merge is the dev's",
      performed: [markedRun("off: --review off", true)]
    })
    assert.deepEqual(run.calls, [AUTH, READ, marked("off: --review off"), READ])
  })

  it("posts the status under pr.review off, then merges under pr.merge auto in the same call", () => {
    const run = ship([...TARGET, "--json"], { graphql: [served(UNREVIEWED), served(GREEN), served(MERGED)] }, {}, OFF)
    assert.equal(run.status, 0, run.stderr)
    assert.deepEqual(fieldsOf(JSON.parse(run.stdout), ["status", "performed"]), {
      status: "done",
      performed: [markedRun("off: pr.review", true), ran("merge", true)]
    })
    assert.deepEqual(run.calls, [AUTH, READ, marked("off: pr.review"), READ, MERGE, READ])
  })

  it("runs full while a config layer is invalid or loosens pr.review, whatever the committed file sets", () => {
    const cases: Files[] = [
      { ...OFF, [LOCAL_FILE]: "{ not json" },
      { ...OFF, [LOCAL_FILE]: { pr: { review: "none" } } },
      { [COMMITTED_FILE]: { pr: { review: "full" } }, [LOCAL_FILE]: { pr: { review: "off" } } }
    ]
    for (const files of cases) {
      const run = json(UNREVIEWED, [], {}, files)
      assert.equal(run.status, 10, run.stderr)
      assert.deepEqual(fieldsOf(run.document, ["action", "details", "performed"]), {
        action: "review",
        details: { depth: "full", source: "config", reviewCommand: "/code-review" },
        performed: []
      })
      assert.deepEqual(run.calls, [AUTH, READ], JSON.stringify(files))
    }
  })

  it("takes --review off over a config layer that is invalid, the dev's word beating the strictest set", () => {
    const files = { ...OFF, [LOCAL_FILE]: "{ not json" }
    const run = ship(
      [...TARGET, "--json", "--review", "off"],
      { graphql: [served(UNREVIEWED), served(GREEN)] },
      {},
      files
    )
    assert.equal(run.status, 30, run.stderr)
    assert.deepEqual(fieldsOf(JSON.parse(run.stdout), ["action", "reason", "performed"]), {
      action: "ready-to-merge",
      reason: "pr.merge is ask: the merge is the dev's",
      performed: [markedRun("off: --review off", true)]
    })
    assert.deepEqual(run.calls, [AUTH, READ, marked("off: --review off"), READ])
  })

  it("keeps every other row under off: conflicts, failing CI and threads go to the agent, the post riding in blockers", () => {
    const cases: [string, Pr, string, string[]][] = [
      [
        "conflicts",
        { ...UNREVIEWED, mergeable: "CONFLICTING", mergeStateStatus: "DIRTY" },
        "fix-conflicts",
        ["mark-reviewed"]
      ],
      ["CI failing", { ...GREEN, mergeStateStatus: "UNSTABLE", checks: [FAILING] }, "fix-ci", ["mark-reviewed"]],
      ["open thread", { ...UNREVIEWED, threads: [THREAD] }, "address-review", ["mark-reviewed"]]
    ]
    for (const [name, pr, action, blockers] of cases) {
      const run = json(pr, [], {}, OFF)
      assert.equal(run.status, 10, `${name}: ${run.stderr}`)
      assert.deepEqual([fieldsOf(run.document, ["action"]), blockersOf(run.document)], [{ action }, blockers], name)
      assert.deepEqual(run.calls, [AUTH, READ], name)
    }
    const conflicting = json({ ...UNREVIEWED, mergeable: "CONFLICTING", mergeStateStatus: "DIRTY" }, [], {}, OFF)
    assert.ok(typeof conflicting.document === "object" && conflicting.document !== null)
    assert.ok("blockers" in conflicting.document && Array.isArray(conflicting.document.blockers))
    assert.deepEqual(conflicting.document.blockers, [
      {
        action: "mark-reviewed",
        actor: "script",
        reason: "no dw-sdlc/review success on e36732e",
        details: { depth: "off", source: "config" }
      }
    ])
  })

  it("never marks another author's pull request reviewed under off: it parks for the dev with no post", () => {
    for (const [flags, files] of [
      [[], OFF],
      [["--review", "off"], {}]
    ] satisfies [string[], Files][]) {
      const name = `flags [${flags.join(" ")}], config ${JSON.stringify(files)}`
      const run = json({ ...UNREVIEWED, viewerDidAuthor: false }, flags, {}, files)
      assert.equal(run.status, 30, `${name}: ${run.stderr}`)
      assert.deepEqual(
        fieldsOf(run.document, ["action", "reason", "command", "blockers", "performed"]),
        {
          action: "ready-to-merge",
          reason: "another author's pull request: the merge is the dev's",
          command: DEV_MERGE,
          blockers: [],
          performed: []
        },
        name
      )
      assert.deepEqual(run.calls, [AUTH, READ], name)
      const failing = json(
        { ...GREEN, viewerDidAuthor: false, mergeStateStatus: "UNSTABLE", checks: [FAILING] },
        flags,
        {},
        files
      )
      assert.deepEqual(blockersOf(failing.document), [], `${name}: ${failing.stdout}`)
    }
  })

  it("posts the status while CI runs, then waits for CI", () => {
    const running: Context = { kind: "run", name: "Check", state: "IN_PROGRESS", link: RUN, startedAt: STARTED }
    const pending: Pr = { ...GREEN, mergeStateStatus: "BLOCKED", checks: [running] }
    const scenario = { graphql: [served(pending), served({ ...pending, checks: [running, REVIEWED] })] }
    const run = ship([...TARGET, "--json"], scenario, clockAt(STARTED, 9 * 60), OFF)
    assert.equal(run.status, 20, run.stderr)
    assert.deepEqual(fieldsOf(JSON.parse(run.stdout), ["action", "reason", "performed"]), {
      action: "wait",
      reason: "ci-pending",
      performed: [markedRun("off: pr.review", true)]
    })
    assert.deepEqual(run.calls, [AUTH, READ, marked("off: pr.review"), READ])
  })

  it("parks the post for the dev with its command under --dry-run, running nothing", () => {
    const reason = "the script would mark it reviewed; --dry-run performs nothing"
    const run = json(UNREVIEWED, ["--dry-run"], {}, OFF)
    assert.equal(run.status, 30, run.stderr)
    assert.deepEqual(run.document, {
      pr: URL,
      head: HEAD,
      base: "main",
      status: "park",
      action: "mark-reviewed",
      actor: "dev",
      reason,
      details: { depth: "off", source: "config" },
      command: markedCommand("off: pr.review"),
      blockers: [],
      performed: [markedRun("off: pr.review", null)]
    })
    assert.deepEqual(run.calls, [AUTH, READ])
    const line = ship([...TARGET, "--dry-run", "--review", "off"], { graphql: [served(UNREVIEWED)] })
    const command = markedCommand("off: --review off")
    assert.deepEqual([line.status, line.stdout], [30, `park mark-reviewed: ${reason} — ${command}\n`], line.stderr)
  })

  it("posts at most once per call: a refused post, or one the next read does not show, goes to the dev", () => {
    const refusal = { exit: 1, stderr: "gh: Resource not accessible by integration (HTTP 403)\n" }
    const cases: [Response, string][] = [
      [refusal, "gh refused the mark-reviewed: Resource not accessible by integration (HTTP 403)"],
      [{}, "gh accepted the mark-reviewed; the read does not show it yet"]
    ]
    for (const [response, reason] of cases) {
      const scenario = {
        graphql: [served(UNREVIEWED), served(UNREVIEWED)],
        commands: { [`api ${STATUSES}`]: response }
      }
      const run = ship([...TARGET, "--json"], scenario, {}, OFF)
      assert.equal(run.status, 30, run.stderr)
      assert.deepEqual(
        fieldsOf(JSON.parse(run.stdout), ["status", "action", "actor", "reason", "command", "performed"]),
        {
          status: "park",
          action: "mark-reviewed",
          actor: "dev",
          reason,
          command: markedCommand("off: pr.review"),
          performed: [markedRun("off: pr.review", false, response)]
        }
      )
      assert.deepEqual(run.calls, [AUTH, READ, marked("off: pr.review"), READ], reason)
    }
  })

  it("records a post as ok when the read after shows it on the head, though gh exited non-zero", () => {
    const scenario = { graphql: [served(UNREVIEWED), served(GREEN)], commands: { [`api ${STATUSES}`]: LOST } }
    const run = ship([...TARGET, "--json", "--review", "off"], scenario)
    assert.equal(run.status, 30, run.stderr)
    assert.deepEqual(fieldsOf(JSON.parse(run.stdout), ["action", "reason", "performed"]), {
      action: "ready-to-merge",
      reason: "pr.merge is ask: the merge is the dev's",
      performed: [markedRun("off: --review off", true, LOST)]
    })
    assert.deepEqual(run.calls, [AUTH, READ, marked("off: --review off"), READ])
  })

  it("exits 2 with the usage on a depth it does not take, before any gh call", () => {
    for (const depth of ["auto", "FULL", "Light"]) {
      const run = ship([...TARGET, "--review", depth], {})
      assert.equal(run.status, 2, depth)
      const [first = "", ...rest] = lines(run.stderr)
      assert.equal(first, `dw-sdlc pr ship: --review takes full, light or off, not ${JSON.stringify(depth)}`)
      assert.ok(
        rest.some((line) => line.startsWith("Usage: dw-sdlc pr ship")),
        run.stderr
      )
      assert.deepEqual(run.calls, [], depth)
    }
  })
})

describe("dw-sdlc pr ship records what an Action did when the read cannot show it or shows it half", () => {
  it("judges an update by the base it merged in: a moved head that is still behind that base did not take effect", () => {
    const pushed: Pr = { ...BEHIND, head: UPDATED }
    const scenario = { graphql: [served(BEHIND), served(pushed)], commands: comparedBehind(2, UPDATED) }
    const run = ship([...TARGET, "--json"], scenario, {}, AUTO)
    assert.equal(run.status, 30, run.stderr)
    assert.deepEqual(fieldsOf(JSON.parse(run.stdout), ["action", "reason", "performed"]), {
      action: "update-branch",
      reason: "gh accepted the update; the read does not show it yet",
      performed: [ran("update-branch", false)]
    })
    assert.deepEqual(run.calls, [AUTH, READ, UPDATE, READ, UPDATED_COMPARE])
  })

  it("names both heads when the head moved after a mark-reviewed, the same reason when it did not", () => {
    const off: Files = { [COMMITTED_FILE]: { pr: { review: "off" } } }
    const post = ["api", `repos/byarcadia-app/foundation/statuses/${HEAD}`]
    const posted = `gh ${[...post, "--method", "POST", "--silent"].join(" ")}`
    const unreviewed: Pr = { ...GREEN, checks: [] }
    const cases: [Pr, string][] = [
      [
        { ...unreviewed, head: UPDATED },
        `the mark-reviewed posted on ${HEAD.slice(0, 7)}, and the head moved to ${UPDATED.slice(0, 7)}`
      ],
      [unreviewed, "gh accepted the mark-reviewed; the read does not show it yet"]
    ]
    for (const [after, reason] of cases) {
      const scenario = { graphql: [served(unreviewed), served(after)], commands: comparedBehind(0, UPDATED) }
      const run = ship([...TARGET, "--json"], scenario, {}, off)
      assert.equal(run.status, 30, run.stderr)
      const document = JSON.parse(run.stdout) as { action: string; reason: string; performed: { command: string }[] }
      assert.equal(document.action, "mark-reviewed")
      assert.equal(document.reason, reason)
      assert.ok(document.performed[0]?.command.startsWith(posted), document.performed[0]?.command)
    }
  })

  it("keeps gh's refusal as the reason when the head moved after a mark-reviewed gh refused", () => {
    const off: Files = { [COMMITTED_FILE]: { pr: { review: "off" } } }
    const unreviewed: Pr = { ...GREEN, checks: [] }
    const refused = { exit: 1, stderr: "X HTTP 422: Validation Failed\n" }
    const post = `api repos/byarcadia-app/foundation/statuses/${HEAD}`
    const scenario = {
      graphql: [served(unreviewed), served({ ...unreviewed, head: UPDATED })],
      commands: { [post]: refused, ...comparedBehind(0, UPDATED) }
    }
    const run = ship([...TARGET, "--json"], scenario, {}, off)
    assert.equal(run.status, 30, run.stderr)
    const { reason } = JSON.parse(run.stdout) as { reason: string }
    assert.equal(reason, "gh refused the mark-reviewed: HTTP 422: Validation Failed")
  })

  it("answers exit 2 when gh refuses the compare after an update, or its reply does not parse, the update named as run with ok null", () => {
    const cases: [Response, string][] = [
      [{ exit: 1, stderr: "gh: Not Found (HTTP 404)\n" }, "Not Found (HTTP 404)"],
      [{ stdout: JSON.stringify({ status: "ahead" }) }, "behind_by is missing, not an integer"]
    ]
    for (const [response, message] of cases) {
      const scenario = {
        graphql: [served(BEHIND), served({ ...BEHIND, head: UPDATED })],
        commands: { [UPDATED_COMPARE.join(" ")]: response }
      }
      const run = ship([...TARGET, "--json"], scenario, {}, AUTO)
      assert.equal(run.status, 2, message)
      assert.ok(run.stderr.includes(message), run.stderr)
      assert.deepEqual(lines(run.stderr).at(-1), "update-branch ran (gh exit 0)")
      assert.deepEqual(JSON.parse(run.stdout).performed, [
        { action: "update-branch", command: `gh ${UPDATE.join(" ")}`, exit: 0, ok: null }
      ])
      assert.deepEqual(run.calls, [AUTH, READ, UPDATE, READ, UPDATED_COMPARE], message)
    }
  })

  it("answers exit 2 naming each Action that ran when the read after it fails, its gh exit beside it", () => {
    const failed = { exit: 1, stderr: "Post https://api.github.com/graphql: context deadline exceeded\n" }
    const scenario = { graphql: [served(GREEN), failed], commands: { "pr merge": { exit: 0 } } }
    const stderr = [
      `dw-sdlc pr ship: byarcadia-app/foundation#40: Post https://api.github.com/graphql: context deadline exceeded — check gh auth status and the network, then call again`,
      "merge ran (gh exit 0)"
    ]
    const text = ship(TARGET, scenario, {}, AUTO)
    assert.equal(text.status, 2)
    assert.deepEqual(lines(text.stderr), stderr)
    assert.equal(text.stdout, "")
    const run = ship([...TARGET, "--json"], scenario, {}, AUTO)
    assert.equal(run.status, 2)
    assert.deepEqual(lines(run.stderr), stderr)
    assert.deepEqual(JSON.parse(run.stdout), {
      error: "byarcadia-app/foundation#40: Post https://api.github.com/graphql: context deadline exceeded",
      remedy: "check gh auth status and the network, then call again",
      performed: [{ action: "merge", command: `gh ${MERGE.join(" ")}`, ok: null, exit: 0 }]
    })
    assert.deepEqual(run.calls, [AUTH, READ, MERGE, READ])
  })
})
