// `dw-sdlc pr ship` and `pr reviewed` under footprint local: the Review state read from and written to
// `.git/dw-sdlc/reviews/<n>.json` in the place of the dw-sdlc/review statuses, with no status posted, and
// every decision the one footprint github takes on the same history.

import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"

import { COMMITTED_FILE, LOCAL_FILE } from "../../src/agentic-config.ts"
import { repo, runBin } from "../harness.ts"
import { BASE_OID, type Commit, fakeGh, GREEN, HEAD, type Pr, type Response, RUN, served } from "../pr-harness.ts"

const REPOSITORY = "byarcadia-app/foundation"
const TARGET = ["40", "-R", REPOSITORY]
const REVIEWS = join(".git", "dw-sdlc", "reviews", "40.json")
const CLEAN = "ad212a6aa5e5c0ffee0ddba11c0de5ca1ab1e0dd"
const FIRST = "5ae684e1c0ffee0ddba11c0de5ca1ab1e0ddba11"
const SECOND = "b01dfacec0ffee0ddba11c0de5ca1ab1e0ddba11"
const THIRD = "c0ffee00c0ffee0ddba11c0de5ca1ab1e0ddba11"
const MERGE = "ebf4833f00dfacade0ddba11c0de5ca1ab1e0ddb"

/** What the Review state holds for a head, as the local file writes it. */
type Mark = "clean" | "findings" | "off" | "accepted"
type Marks = Record<string, Mark>

/** The dw-sdlc/review status footprint github posts for each mark. */
const STATUS: Record<Mark, { review: string; described: string }> = {
  clean: { review: "SUCCESS", described: "a clean review of this head" },
  findings: { review: "FAILURE", described: "read, findings open" },
  off: { review: "SUCCESS", described: "off: pr.review" },
  accepted: { review: "SUCCESS", described: "accepted by the dev, findings open" }
}

/** Green, the viewer's own, CI passed, no Review status anywhere: `history` the commits before the head. */
function unmarked(history: Commit[], more: Partial<Pr> = {}): Pr {
  const check = { kind: "run", name: "Check", state: "SUCCESS", link: RUN, startedAt: "2026-10-31T11:01:00Z" } as const
  return { ...GREEN, checks: [check], history, ...more }
}

/** `pr` as GitHub reports it once footprint github posted `marks`: each on its commit, the head's in its rollup. */
function posted(pr: Pr, marks: Marks): Pr {
  const head = marks[pr.head]
  const history = pr.history.map((commit) => {
    const mark = marks[commit.oid]
    return mark === undefined ? commit : { ...commit, ...STATUS[mark] }
  })
  if (head === undefined) {
    return { ...pr, history }
  }
  const review = { kind: "status", name: "dw-sdlc/review", state: STATUS[head].review } as const
  return { ...pr, history, headReview: STATUS[head], checks: [...pr.checks, review] }
}

/** The own changes at `commit` from the base: one file, the same at every commit asked. */
function ownAt(commit: string): Record<string, Response> {
  const files = [
    { filename: "src/paywall.tsx", status: "modified", additions: 1, deletions: 0, patch: "@@ -1 +1,2 @@\n a\n+b" }
  ]
  const call = `api repos/${REPOSITORY}/compare/${BASE_OID}...${commit}?per_page=1`
  return { [call]: { stdout: JSON.stringify({ status: "ahead", behind_by: 0, files }) } }
}

/** The compare from `from` to the head once a fix is pushed: one file changed since. */
function fixedSince(from: string): Record<string, Response> {
  const files = [
    { filename: "src/paywall.tsx", status: "modified", additions: 1, deletions: 1, patch: "@@ -1 +1 @@\n-a\n+b" }
  ]
  const call = `api repos/${REPOSITORY}/compare/${from}...${HEAD}?per_page=1`
  return { [call]: { stdout: JSON.stringify({ status: "ahead", behind_by: 0, files }) } }
}

type Files = Record<string, string | object>
const FULL = { pr: { review: "full" } }

/** A checkout under footprint local, `marks` already in its Review state file when given. */
function localCheckout(marks: Marks | undefined, committed: object = FULL): string {
  const files: Files = { [COMMITTED_FILE]: committed, [LOCAL_FILE]: { footprint: "local" } }
  return repo({ files: marks === undefined ? files : { ...files, [REVIEWS]: marks } })
}

/** `dw-sdlc <args>` in `root`, gh serving `graphql` in order and answering `commands`. */
function run(args: string[], root: string, graphql: Pr[], commands: Record<string, Response> = {}) {
  const gh = fakeGh({ graphql: graphql.map(served), commands })
  const ran = runBin(args, root, gh.env)
  return { ...ran, calls: gh.calls().map((call) => call.join(" ")) }
}

/** What both footprints must agree on. */
function decision(stdout: string): Record<string, unknown> {
  const { status, action, actor, reason, details, blockers } = JSON.parse(stdout) as Record<string, unknown>
  return { status, action, actor, reason, details, blockers }
}

function marksIn(root: string): unknown {
  const file = join(root, REVIEWS)
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : undefined
}

const posts = (calls: string[]): string[] => calls.filter((call) => call.includes("/statuses/"))

/** A history, the marks on it, and what each footprint answers, the same under both. */
type Case = { name: string; pr: Pr; marks: Marks; commands?: Record<string, Response>; config?: object }

const CASES: Case[] = [
  { name: "a head no Review read", pr: unmarked([]), marks: {} },
  { name: "a clean Review of the head", pr: unmarked([]), marks: { [HEAD]: "clean" } },
  { name: "a Review of the head with Findings", pr: unmarked([]), marks: { [HEAD]: "findings" } },
  {
    name: "a fix pushed after a Review with Findings",
    pr: unmarked([{ oid: FIRST }]),
    marks: { [FIRST]: "findings" },
    commands: fixedSince(FIRST)
  },
  {
    name: "three Reviews with Findings since a clean one",
    pr: unmarked([{ oid: CLEAN }, { oid: FIRST }, { oid: SECOND }, { oid: THIRD }]),
    marks: { [CLEAN]: "clean", [FIRST]: "findings", [SECOND]: "findings", [THIRD]: "findings" },
    commands: fixedSince(THIRD)
  },
  {
    name: "the dev's acceptance after three Reviews with Findings",
    pr: unmarked([{ oid: CLEAN }, { oid: FIRST }, { oid: SECOND }, { oid: THIRD }]),
    marks: { [CLEAN]: "clean", [FIRST]: "findings", [SECOND]: "findings", [THIRD]: "findings", [HEAD]: "accepted" }
  },
  {
    name: "a head that only merged the base in after a clean Review",
    pr: unmarked([{ oid: CLEAN }, { oid: MERGE, parents: 2 }], { headParents: 2 }),
    marks: { [CLEAN]: "clean" },
    commands: { ...ownAt(CLEAN), ...ownAt(HEAD) }
  },
  { name: "a head under pr.review off", pr: unmarked([]), marks: {}, config: { pr: { review: "off" } } },
  {
    name: "a success under off before the head",
    pr: unmarked([{ oid: CLEAN }]),
    marks: { [CLEAN]: "off" },
    commands: fixedSince(CLEAN)
  }
]

describe("dw-sdlc pr ship under footprint local", () => {
  it("decides as footprint github does on the same history, reading the marks from the local file", () => {
    for (const { name, pr, marks, commands = {}, config = FULL } of CASES) {
      const github = repo({ files: { [COMMITTED_FILE]: config } })
      const onGithub = run(["pr", "ship", ...TARGET, "--json", "--dry-run"], github, [posted(pr, marks)], commands)
      const local = localCheckout(marks, config)
      const onLocal = run(["pr", "ship", ...TARGET, "--json", "--dry-run"], local, [pr], commands)
      assert.equal(onLocal.status, onGithub.status, `${name}: ${onGithub.stderr}${onLocal.stderr}`)
      assert.deepEqual(decision(onLocal.stdout), decision(onGithub.stdout), name)
      assert.deepEqual(posts(onLocal.calls), [], name)
    }
  })

  it("ignores a dw-sdlc/review status GitHub holds: only the local file says what a Review read", () => {
    const local = localCheckout(undefined)
    const ran = run(["pr", "ship", ...TARGET, "--json"], local, [posted(unmarked([]), { [HEAD]: "clean" })])
    assert.equal(ran.status, 10, ran.stderr)
    assert.equal(decision(ran.stdout).action, "review")
  })

  it("records a carried head as clean in the local file and posts no status", () => {
    const pr = unmarked([{ oid: CLEAN }, { oid: MERGE, parents: 2 }], { headParents: 2 })
    const local = localCheckout({ [CLEAN]: "clean" })
    const ran = run(["pr", "ship", ...TARGET, "--json"], local, [pr, pr], { ...ownAt(CLEAN), ...ownAt(HEAD) })
    assert.equal(ran.status, 30, ran.stderr)
    const answer = JSON.parse(ran.stdout) as Record<string, unknown>
    assert.equal(answer.action, "ready-to-merge")
    assert.deepEqual(answer.performed, [
      {
        action: "mark-reviewed",
        command: `dw-sdlc pr reviewed 40 -R ${REPOSITORY} --head ${HEAD}`,
        exit: 0,
        ok: true
      }
    ])
    assert.deepEqual(marksIn(local), { [CLEAN]: "clean", [HEAD]: "clean" })
    assert.deepEqual(posts(ran.calls), [])
  })

  it("records a head under pr.review off as off, and hands the dev that command under --dry-run", () => {
    const local = localCheckout(undefined, { pr: { review: "off" } })
    const command = `dw-sdlc pr reviewed 40 -R ${REPOSITORY} --head ${HEAD} --off`
    const dry = run(["pr", "ship", ...TARGET, "--json", "--dry-run"], local, [unmarked([])])
    assert.equal(dry.status, 30, dry.stderr)
    assert.equal((JSON.parse(dry.stdout) as Record<string, unknown>).command, command)
    assert.equal(marksIn(local), undefined, "--dry-run records nothing")
    const ran = run(["pr", "ship", ...TARGET, "--json"], local, [unmarked([]), unmarked([])])
    assert.equal(ran.status, 30, ran.stderr)
    assert.deepEqual((JSON.parse(ran.stdout) as Record<string, unknown>).performed, [
      { action: "mark-reviewed", command, exit: 0, ok: true }
    ])
    assert.deepEqual(marksIn(local), { [HEAD]: "off" })
    assert.deepEqual(posts(ran.calls), [])
  })

  it("stops when the local file is not a map of heads to marks, naming it", () => {
    const local = repo({
      files: { [COMMITTED_FILE]: FULL, [LOCAL_FILE]: { footprint: "local" }, [REVIEWS]: { [HEAD]: "great" } }
    })
    const ran = run(["pr", "ship", ...TARGET, "--json"], local, [unmarked([])])
    assert.equal(ran.status, 2)
    assert.match(ran.stderr, /reviews\/40\.json/)
  })
})

describe("dw-sdlc pr reviewed under footprint local", () => {
  const MARKED: [string[], Mark][] = [
    [[], "clean"],
    [["--findings"], "findings"],
    [["--accept"], "accepted"],
    [["--off"], "off"]
  ]

  it("records the mark on the head in the local file, beside the marks already there, and posts no status", () => {
    for (const [flags, mark] of MARKED) {
      const local = localCheckout({ [CLEAN]: "clean" })
      const ran = run(["pr", "reviewed", ...TARGET, "--head", HEAD, ...flags, "--json"], local, [unmarked([])])
      assert.equal(ran.status, 0, `${flags.join(" ")}: ${ran.stderr}`)
      assert.deepEqual(JSON.parse(ran.stdout), { head: HEAD, mark, file: join(local, REVIEWS) })
      assert.deepEqual(marksIn(local), { [CLEAN]: "clean", [HEAD]: mark })
      assert.deepEqual(posts(ran.calls), [])
    }
  })

  it("says what it recorded in one line", () => {
    const local = localCheckout(undefined)
    const ran = run(["pr", "reviewed", ...TARGET, "--head", HEAD], local, [unmarked([])])
    assert.equal(ran.status, 0, ran.stderr)
    assert.equal(ran.stdout, `recorded clean on ${HEAD} in ${join(local, REVIEWS)}\n`)
  })

  it("records nothing when a push moved the head", () => {
    const local = localCheckout(undefined)
    const ran = run(["pr", "reviewed", ...TARGET, "--head", CLEAN], local, [unmarked([])])
    assert.equal(ran.status, 2)
    assert.equal(marksIn(local), undefined)
  })

  it("refuses --off under footprint github, where the Ship script posts off itself", () => {
    const github = repo({ files: { [COMMITTED_FILE]: FULL } })
    const ran = run(["pr", "reviewed", ...TARGET, "--head", HEAD, "--off"], github, [unmarked([])])
    assert.equal(ran.status, 2)
    assert.match(ran.stderr, /--off/)
    assert.deepEqual(ran.calls, [])
  })
})
