// `dw-sdlc pr ship` under `pr.review: auto`, the default: the Review depth routed from the changes the
// Review would read, the whole diff since the base or the changes since the last reviewed commit.

import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { COMMITTED_FILE } from "../../src/agentic-config.ts"
import { lines, repo, runBin } from "../harness.ts"
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
const REVIEWED = "5ae684e1c0ffee0ddba11c0de5ca1ab1e0ddba11"
const PUSHED = "ebf4833f00dfacade0ddba11c0de5ca1ab1e0ddb"

const PASSING = { kind: "run", name: "Check", state: "SUCCESS", link: RUN, startedAt: "2026-10-31T11:01:00Z" } as const
/** Green and the viewer's own, its head not reviewed, no earlier commit reviewed. */
const UNREVIEWED: Pr = { ...GREEN, checks: [PASSING] }
/** The same after a push, an earlier commit reviewed. */
const PUSHED_ON: Pr = {
  ...UNREVIEWED,
  history: [
    { oid: REVIEWED, review: "SUCCESS" },
    { oid: PUSHED, review: null }
  ]
}

/** A file as GitHub's compare lists it, with the lines it adds and removes. */
type File = {
  filename: string
  status: string
  additions: number
  deletions: number
  patch?: string
  previous_filename?: string
}

function file(filename: string, additions: number, deletions = 0): File {
  return { filename, status: "modified", additions, deletions, patch: "@@ -1 +1 @@\n-a\n+b" }
}

/** A file the compare shows no patch for: a binary one, or a diff too large to show. */
function unpatched(filename: string, additions: number, deletions = 0): File {
  return { filename, status: "modified", additions, deletions }
}

/** The compare from `from` to `to`, the call that reads the changes a Review would read. */
function compare(from: string, to = HEAD): string[] {
  return ["api", `repos/byarcadia-app/foundation/compare/${from}...${to}?per_page=1`]
}

/** What the compare from `from` to `to` answers: `files` its changed files, none of `from` lacking. */
function compared(from: string, files: File[], to = HEAD): Record<string, Response> {
  return { [compare(from, to).join(" ")]: { stdout: JSON.stringify({ status: "ahead", behind_by: 0, files }) } }
}

/** The post that marks HEAD reviewed, `why` its description. */
function marked(why: string): string[] {
  const fields = { state: "success", context: "dw-sdlc/review", target_url: URL, description: why }
  const flags = Object.entries(fields).flatMap(([key, value]) => ["-f", `${key}=${value}`])
  return ["api", `repos/byarcadia-app/foundation/statuses/${HEAD}`, "--method", "POST", "--silent", ...flags]
}

/** The command line of `args`, each word with a space single-quoted, as the script prints it. */
function commandOf(args: string[]): string {
  return ["gh", ...args.map((arg) => (arg.includes(" ") ? `'${arg}'` : arg))].join(" ")
}

/** The files of a test's checkout: a relative path and its text, an object written as JSON. */
type Files = Record<string, string | object>

/** `dw-sdlc pr ship` on `graphql`, gh answering `commands` beside the read. */
function ship(args: string[], graphql: Pr[], commands: Record<string, Response> = {}, files: Files = {}) {
  const gh = fakeGh({ graphql: graphql.map(served), commands })
  const run = runBin(["pr", "ship", ...TARGET, ...args], repo({ files }), gh.env)
  return { ...run, calls: gh.calls() }
}

function documentOf(stdout: string, keys: string[]): Record<string, unknown> {
  const document = JSON.parse(stdout) as Record<string, unknown>
  return Object.fromEntries(keys.map((key) => [key, document[key]]))
}

const LOCKFILES = [file("pnpm-lock.yaml", 900, 300), file("apps/mobile/Gemfile.lock", 4, 4)]
const many = Array.from({ length: 300 }, (_, index) => file(`src/f${index}.ts`, 1))

describe("dw-sdlc pr ship under pr.review auto", () => {
  it("routes the depth from the whole diff since the base by each rule, auto and the full command named", () => {
    const full = { depth: "full", source: "auto", reviewCommand: "/code-review" }
    const light = { depth: "light", source: "auto", reviewCommand: "/code-review" }
    const cases: [string, File[], object][] = [
      ["a workflow file", [file(".github/workflows/quality-gate.yaml", 1)], full],
      [
        "a workflow file renamed away",
        [{ ...file("ci/old.yaml", 0), status: "renamed", previous_filename: ".github/workflows/old.yaml" }],
        full
      ],
      ["101 changed lines", [file("src/a.ts", 60, 41)], full],
      ["100 changed lines, lockfiles uncounted", [file("src/a.ts", 60, 40), ...LOCKFILES], light],
      ["a lockfile and one line of code", [...LOCKFILES, file("package.json", 1, 1)], light],
      ["no changed file", [], light],
      ["300 files, more than the compare can size", many, full],
      ["a file the compare shows no patch for, as a binary one", [unpatched("assets/icon.png", 0)], full],
      ["a lockfile too large for a patch", [unpatched("pnpm-lock.yaml", 9000, 9000), file("src/a.ts", 1)], light]
    ]
    for (const [name, files, details] of cases) {
      const run = ship(["--json"], [UNREVIEWED], compared(BASE_OID, files))
      assert.equal(run.status, 10, `${name}: ${run.stderr}`)
      assert.deepEqual(
        documentOf(run.stdout, ["action", "actor", "details", "performed"]),
        { action: "review", actor: "agent", details, performed: [] },
        name
      )
      assert.deepEqual(run.calls, [AUTH, READ, compare(BASE_OID)], name)
    }
  })

  it("posts the status itself over lockfiles alone, described as such, then answers what the next read gives", () => {
    const run = ship(["--json"], [UNREVIEWED, GREEN], compared(BASE_OID, LOCKFILES))
    assert.equal(run.status, 30, run.stderr)
    assert.deepEqual(documentOf(run.stdout, ["action", "performed"]), {
      action: "ready-to-merge",
      performed: [{ action: "mark-reviewed", command: commandOf(marked("off: lockfiles only")), exit: 0, ok: true }]
    })
    assert.deepEqual(run.calls, [AUTH, READ, compare(BASE_OID), marked("off: lockfiles only"), READ])
  })

  it("parks the status over lockfiles alone for the dev with its command under --dry-run, posting nothing", () => {
    const run = ship(["--json", "--dry-run"], [UNREVIEWED], compared(BASE_OID, LOCKFILES))
    assert.equal(run.status, 30, run.stderr)
    const command = commandOf(marked("off: lockfiles only"))
    assert.deepEqual(documentOf(run.stdout, ["status", "action", "actor", "details", "command", "performed"]), {
      status: "park",
      action: "mark-reviewed",
      actor: "dev",
      details: { depth: "off", source: "auto", reviewCommand: "/code-review" },
      command,
      performed: [{ action: "mark-reviewed", command, ok: null }]
    })
    assert.deepEqual(run.calls, [AUTH, READ, compare(BASE_OID)])
  })

  it("routes on the changes since the last reviewed commit after a push, named in details.since", () => {
    const run = ship(["--json"], [PUSHED_ON], compared(REVIEWED, [file("src/retry.ts", 3)]))
    assert.equal(run.status, 10, run.stderr)
    assert.deepEqual(documentOf(run.stdout, ["action", "details"]), {
      action: "review",
      details: { depth: "light", source: "auto", reviewCommand: "/code-review", since: REVIEWED }
    })
    assert.deepEqual(run.calls, [AUTH, READ, compare(REVIEWED)])
  })

  it("routes a small fix light from the read mark a Review left on a large pull request", () => {
    const history: Commit[] = [
      { oid: REVIEWED, review: "FAILURE", described: "read, findings open" },
      { oid: PUSHED, review: null }
    ]
    const run = ship(["--json"], [{ ...UNREVIEWED, history }], {
      ...compared(BASE_OID, [file("src/a.ts", 1954, 229)]),
      ...compared(REVIEWED, [file("src/a.ts", 4, 1)])
    })
    assert.equal(run.status, 10, run.stderr)
    assert.deepEqual(documentOf(run.stdout, ["action", "details"]), {
      action: "review",
      details: { depth: "light", source: "auto", reviewCommand: "/code-review", since: REVIEWED }
    })
    assert.deepEqual(run.calls, [AUTH, READ, compare(REVIEWED)])
  })

  it("routes on the whole diff since the base over a rewritten history that holds no reviewed commit", () => {
    const rebased: Pr = { ...UNREVIEWED, history: [{ oid: PUSHED, review: null }] }
    const run = ship(["--json"], [rebased], compared(BASE_OID, [file("src/a.ts", 101)]))
    assert.equal(run.status, 10, run.stderr)
    assert.deepEqual(documentOf(run.stdout, ["action", "details"]), {
      action: "review",
      details: { depth: "full", source: "auto", reviewCommand: "/code-review" }
    })
    assert.deepEqual(run.calls, [AUTH, READ, compare(BASE_OID)])
  })

  it("reads no compare when the dev's --review or a fixed pr.review sets the depth", () => {
    const cases: [string[], Files, object][] = [
      [["--review", "light"], {}, { depth: "light", source: "flag" }],
      [["--review", "full"], {}, { depth: "full", source: "flag", reviewCommand: "/code-review" }],
      [[], { [COMMITTED_FILE]: { pr: { review: "light" } } }, { depth: "light", source: "config" }]
    ]
    for (const [args, files, details] of cases) {
      const run = ship(["--json", ...args], [PUSHED_ON], {}, files)
      assert.equal(run.status, 10, run.stderr)
      assert.deepEqual(
        documentOf(run.stdout, ["action", "details"]),
        { action: "review", details: { ...details, since: REVIEWED } },
        JSON.stringify(args)
      )
      assert.deepEqual(run.calls, [AUTH, READ], JSON.stringify(args))
    }
  })

  it("carries the status over a head that only merged the base in, reading no compare to route", () => {
    const history: Commit[] = [
      { oid: REVIEWED, review: "SUCCESS" },
      { oid: PUSHED, review: null, parents: 2 }
    ]
    const own = [file("src/retry.ts", 3)]
    const run = ship(["--json", "--dry-run"], [{ ...UNREVIEWED, history, headParents: 2 }], {
      ...compared(BASE_OID, own, REVIEWED),
      ...compared(BASE_OID, own)
    })
    assert.equal(run.status, 30, run.stderr)
    assert.deepEqual(documentOf(run.stdout, ["action", "details", "command"]), {
      action: "mark-reviewed",
      details: { since: REVIEWED },
      command: commandOf(marked(`carried from ${REVIEWED.slice(0, 7)}`))
    })
    assert.deepEqual(run.calls, [AUTH, READ, compare(BASE_OID, REVIEWED), compare(BASE_OID)])
  })

  it("reads no compare for another author's pull request, which parks for the dev", () => {
    const run = ship(["--json"], [{ ...UNREVIEWED, viewerDidAuthor: false }])
    assert.equal(run.status, 30, run.stderr)
    assert.deepEqual(documentOf(run.stdout, ["action"]), { action: "ready-to-merge" })
    assert.deepEqual(run.calls, [AUTH, READ])
  })

  it("exits 2 when gh refuses the compare, or its reply does not parse", () => {
    const cases: [string, Response, string][] = [
      [
        "refused",
        { exit: 1, stderr: "gh: Not Found (HTTP 404)\n" },
        "dw-sdlc pr ship: byarcadia-app/foundation#40: the compare of 8ba44d6...e36732e: Not Found (HTTP 404) — check gh auth status and the network, then call again"
      ],
      [
        "unparsed",
        { stdout: JSON.stringify({ files: [{ filename: "src/a.ts", status: "modified", patch: "@@ -1 +1 @@\n+b" }] }) },
        "dw-sdlc pr ship: the reply does not parse: files[0].additions is missing, not an integer — gh answered a shape dw-sdlc does not read; report it with the output of gh --version"
      ]
    ]
    for (const [name, response, line] of cases) {
      const run = ship(["--json"], [UNREVIEWED], { [compare(BASE_OID).join(" ")]: response })
      assert.equal(run.status, 2, name)
      assert.equal(run.stdout, "", name)
      assert.deepEqual(lines(run.stderr), [line], name)
    }
  })
})
