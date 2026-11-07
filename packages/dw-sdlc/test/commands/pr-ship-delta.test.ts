// `dw-sdlc pr ship` after a push to a reviewed pull request: the last reviewed commit named as the
// point the Review reads from, its status carried over a head that only merged the base in.

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
const EARLIER = "ad212a6aa5e5c0ffee0ddba11c0de5ca1ab1e0dd"
const PUSHED = "ebf4833f00dfacade0ddba11c0de5ca1ab1e0ddb"

/** Green and the viewer's own, its head not reviewed, an earlier commit reviewed. */
const PUSHED_ON: Pr = {
  ...GREEN,
  checks: [{ kind: "run", name: "Check", state: "SUCCESS", link: RUN, startedAt: "2026-10-31T11:01:00Z" }],
  history: [
    { oid: EARLIER, review: "SUCCESS" },
    { oid: REVIEWED, review: "SUCCESS" },
    { oid: PUSHED, review: null }
  ]
}

/** The same, every commit after the reviewed one a merge of the base in, as update-branch makes. */
const MERGED_IN: Pr = {
  ...PUSHED_ON,
  history: [
    { oid: EARLIER, review: "SUCCESS" },
    { oid: REVIEWED, review: "SUCCESS" },
    { oid: PUSHED, review: null, parents: 2 }
  ],
  headParents: 2
}

/** A file as GitHub's compare lists it. */
type File = { filename: string; status: string; patch?: string; previous_filename?: string }

/** The compare of the base with `commit`, the call that reads the pull request's own changes at it. */
function compare(commit: string): string[] {
  return ["api", `repos/byarcadia-app/foundation/compare/${BASE_OID}...${commit}?per_page=1`]
}

/** What the compare of the base with `commit` answers: `files` its changed files, none of the base lacking. */
function compared(commit: string, files: File[]): Record<string, Response> {
  return { [compare(commit).join(" ")]: { stdout: JSON.stringify({ status: "ahead", behind_by: 0, files }) } }
}

const PAYWALL = "packages/payments/src/paywall.tsx"
/** The change as the Review read it. */
const READ_THEN: File = {
  filename: PAYWALL,
  status: "modified",
  patch:
    "@@ -10,3 +10,4 @@ export function Paywall() {\n   const offerings = useOfferings()\n+  const memo = useMemo(() => offerings, [offerings])\n   return (\n     <View>"
}
/** The same change after the base moved the file's lines and its context. */
const SHIFTED: File = {
  ...READ_THEN,
  patch:
    "@@ -14,3 +14,4 @@ export function Paywall(props: Props) {\n   const offerings = useOfferings(props.locale)\n+  const memo = useMemo(() => offerings, [offerings])\n   return (\n     <SafeView>"
}
const ADDED: File = { filename: "src/retry.ts", status: "added", patch: "@@ -0,0 +1 @@\n+export const RETRIES = 3" }

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

const CARRIED = `carried from ${REVIEWED.slice(0, 7)}`
/** The files of a test's checkout: a relative path and its text, an object written as JSON. */
type Files = Record<string, string | object>
/** pr.review full: no compare beyond the two a carry reads; `pr-ship-route` reads auto. */
const FULL: Files = { [COMMITTED_FILE]: { pr: { review: "full" } } }

/** `dw-sdlc pr ship` on `graphql`; the compare that judges the head behind finds it lacks none of its base. */
function ship(args: string[], graphql: Pr[], commands: Record<string, Response> = {}, files: Files = FULL) {
  const gh = fakeGh({ graphql: graphql.map(served), commands: { ...compared(HEAD, []), ...commands } })
  const run = runBin(["pr", "ship", ...TARGET, ...args], repo({ files }), gh.env)
  return { ...run, calls: gh.calls() }
}

function documentOf(stdout: string, keys: string[]): Record<string, unknown> {
  const document = JSON.parse(stdout) as Record<string, unknown>
  return Object.fromEntries(keys.map((key) => [key, document[key]]))
}

describe("dw-sdlc pr ship after a push to a reviewed pull request", () => {
  it("names the last reviewed commit in details.since after a commit of the branch's own, reading no compare", () => {
    const pushed: [string, Pr][] = [
      ["a commit, then the head", PUSHED_ON],
      ["a merge, then a commit as the head", { ...MERGED_IN, headParents: 1 }]
    ]
    for (const [name, pr] of pushed) {
      const run = ship(["--json"], [pr], { ...compared(REVIEWED, [READ_THEN]), ...compared(HEAD, [SHIFTED]) })
      assert.equal(run.status, 10, `${name}: ${run.stderr}`)
      assert.deepEqual(
        documentOf(run.stdout, ["action", "actor", "details", "performed"]),
        {
          action: "review",
          actor: "agent",
          details: { depth: "full", source: "config", reviewCommand: "/code-review", since: REVIEWED },
          performed: []
        },
        name
      )
      assert.deepEqual(run.calls, [AUTH, READ, compare(HEAD)], name)
    }
  })

  it("carries the status over a head that only merged the base in, then answers what the next read gives", () => {
    const after: Pr = { ...MERGED_IN, checks: GREEN.checks }
    const run = ship(["--json"], [MERGED_IN, after], {
      ...compared(REVIEWED, [READ_THEN]),
      ...compared(HEAD, [SHIFTED])
    })
    assert.equal(run.status, 30, run.stderr)
    assert.deepEqual(documentOf(run.stdout, ["action", "reason", "performed"]), {
      action: "ready-to-merge",
      reason: "pr.merge is ask: the merge is the dev's",
      performed: [{ action: "mark-reviewed", command: commandOf(marked(CARRIED)), exit: 0, ok: true }]
    })
    assert.deepEqual(run.calls, [AUTH, READ, compare(REVIEWED), compare(HEAD), marked(CARRIED), READ])
  })

  it("carries the status under pr.review off too, naming the Review it carries", () => {
    const after: Pr = { ...MERGED_IN, checks: GREEN.checks }
    const off = { [COMMITTED_FILE]: { pr: { review: "off" } } }
    const run = ship(
      ["--json"],
      [MERGED_IN, after],
      { ...compared(REVIEWED, [READ_THEN]), ...compared(HEAD, [SHIFTED]) },
      off
    )
    assert.equal(run.status, 30, run.stderr)
    assert.deepEqual(run.calls, [AUTH, READ, compare(REVIEWED), compare(HEAD), marked(CARRIED), READ])
  })

  it("parks the carried status for the dev with its command under --dry-run, posting nothing", () => {
    const run = ship(["--json", "--dry-run"], [MERGED_IN], {
      ...compared(REVIEWED, [READ_THEN]),
      ...compared(HEAD, [SHIFTED])
    })
    assert.equal(run.status, 30, run.stderr)
    const command = commandOf(marked(CARRIED))
    assert.deepEqual(
      documentOf(run.stdout, ["status", "action", "actor", "reason", "details", "command", "performed"]),
      {
        status: "park",
        action: "mark-reviewed",
        actor: "dev",
        reason: "the script would mark it reviewed; --dry-run performs nothing",
        details: { since: REVIEWED },
        command,
        performed: [{ action: "mark-reviewed", command, ok: null }]
      }
    )
    assert.deepEqual(run.calls, [AUTH, READ, compare(REVIEWED), compare(HEAD)])
  })

  it("names no since over a rewritten history that no longer holds a reviewed commit, reading no compare", () => {
    const rebased: Commit[] = [{ oid: EARLIER }, { oid: PUSHED, review: null }, { oid: REVIEWED, review: "PENDING" }]
    const run = ship(["--json"], [{ ...PUSHED_ON, history: rebased }])
    assert.equal(run.status, 10, run.stderr)
    assert.deepEqual(documentOf(run.stdout, ["action", "details"]), {
      action: "review",
      details: { depth: "full", source: "config", reviewCommand: "/code-review" }
    })
    assert.deepEqual(run.calls, [AUTH, READ, compare(HEAD)])
  })

  it("carries nothing when the own changes differ, or a compare cannot show them whole", () => {
    const binary: File = { filename: "assets/icon.png", status: "modified" }
    const reordered: File = {
      ...READ_THEN,
      patch: "@@ -10,3 +10,5 @@\n   const offerings = useOfferings()\n+  const b = 2\n+  const a = 1"
    }
    const then: File = {
      ...READ_THEN,
      patch: "@@ -10,3 +10,5 @@\n   const offerings = useOfferings()\n+  const a = 1\n+  const b = 2"
    }
    const many = Array.from({ length: 300 }, (_, index) => ({ ...ADDED, filename: `src/f${index}.ts` }))
    const cases: [string, File[], File[]][] = [
      ["a file added", [READ_THEN], [READ_THEN, ADDED]],
      ["a file dropped", [READ_THEN, ADDED], [READ_THEN]],
      ["lines reordered", [then], [reordered]],
      ["renamed", [READ_THEN], [{ ...READ_THEN, status: "renamed", previous_filename: "src/old.tsx" }]],
      ["a file without a patch", [binary], [binary]],
      ["300 files, GitHub's limit", many, many]
    ]
    for (const [name, before, now] of cases) {
      const run = ship(["--json"], [MERGED_IN], { ...compared(REVIEWED, before), ...compared(HEAD, now) })
      assert.equal(run.status, 10, `${name}: ${run.stderr}`)
      assert.deepEqual(
        documentOf(run.stdout, ["action", "details"]),
        {
          action: "review",
          details: { depth: "full", source: "config", reviewCommand: "/code-review", since: REVIEWED }
        },
        name
      )
    }
  })

  it("reads past a status the script posted under off, and takes a carried one as reviewed", () => {
    const cases: [string, Commit[], string][] = [
      [
        "off",
        [
          { oid: EARLIER, review: "SUCCESS" },
          { oid: REVIEWED, review: "SUCCESS", described: "off: --review off" }
        ],
        EARLIER
      ],
      [
        "carried",
        [
          { oid: EARLIER, review: "SUCCESS" },
          { oid: REVIEWED, review: "SUCCESS", described: "carried from ad212a6" }
        ],
        REVIEWED
      ]
    ]
    for (const [name, history, since] of cases) {
      const run = ship(["--json"], [{ ...PUSHED_ON, history }])
      assert.equal(run.status, 10, `${name}: ${run.stderr}`)
      assert.deepEqual(
        documentOf(run.stdout, ["action", "details"]),
        { action: "review", details: { depth: "full", source: "config", reviewCommand: "/code-review", since } },
        name
      )
    }
  })

  it("asks for a Review of the whole diff under the dev's --review full over a head that would carry", () => {
    const run = ship(["--json", "--review", "full"], [MERGED_IN], {
      ...compared(REVIEWED, [READ_THEN]),
      ...compared(HEAD, [SHIFTED])
    })
    assert.equal(run.status, 10, run.stderr)
    assert.deepEqual(documentOf(run.stdout, ["action", "details", "performed"]), {
      action: "review",
      details: { depth: "full", source: "flag", reviewCommand: "/code-review" },
      performed: []
    })
  })

  it("asks for a light Review of the whole diff under the dev's --review light over a head that would carry", () => {
    const run = ship(["--json", "--review", "light"], [MERGED_IN], {
      ...compared(REVIEWED, [READ_THEN]),
      ...compared(HEAD, [SHIFTED])
    })
    assert.equal(run.status, 10, run.stderr)
    assert.deepEqual(documentOf(run.stdout, ["action", "details", "performed"]), {
      action: "review",
      details: { depth: "light", source: "flag" },
      performed: []
    })
  })

  it("posts the status as the dev's off, not as a carry, under --review off over a head that would carry", () => {
    const after: Pr = { ...MERGED_IN, checks: GREEN.checks }
    const run = ship(["--json", "--review", "off"], [MERGED_IN, after], {
      ...compared(REVIEWED, [READ_THEN]),
      ...compared(HEAD, [SHIFTED])
    })
    assert.equal(run.status, 30, run.stderr)
    assert.deepEqual(documentOf(run.stdout, ["action", "performed"]), {
      action: "ready-to-merge",
      performed: [{ action: "mark-reviewed", command: commandOf(marked("off: --review off")), exit: 0, ok: true }]
    })
  })

  it("reads no compare for another author's pull request, which parks for the dev", () => {
    const run = ship(["--json"], [{ ...PUSHED_ON, viewerDidAuthor: false }])
    assert.equal(run.status, 30, run.stderr)
    assert.deepEqual(documentOf(run.stdout, ["action"]), { action: "ready-to-merge" })
    assert.deepEqual(run.calls, [AUTH, READ, compare(HEAD)])
  })

  it("exits 2 when gh refuses a compare, or its reply does not parse", () => {
    const refused = { exit: 1, stderr: "gh: No commit found for SHA: 5ae684e (HTTP 404)\n" }
    const cases: [string, Response, string][] = [
      [
        "refused",
        refused,
        `dw-sdlc pr ship: byarcadia-app/foundation#40: the compare with ${REVIEWED.slice(0, 7)}: No commit found for SHA: 5ae684e (HTTP 404) — check gh auth status and the network, then call again`
      ],
      [
        "unparsed",
        { stdout: JSON.stringify({ files: [{ status: "modified" }] }) },
        "dw-sdlc pr ship: the reply does not parse: files[0].filename is missing, not a string — gh answered a shape dw-sdlc does not read; report it with the output of gh --version"
      ]
    ]
    for (const [name, response, line] of cases) {
      const run = ship(["--json"], [MERGED_IN], {
        [compare(REVIEWED).join(" ")]: response,
        ...compared(HEAD, [READ_THEN])
      })
      assert.equal(run.status, 2, name)
      assert.equal(run.stdout, "", name)
      assert.deepEqual(lines(run.stderr), [line], name)
    }
  })
})

/** The read mark `pr reviewed --findings` posts: a Review read the commit and left a Finding open. */
const MARK: Pick<Commit, "review" | "described"> = { review: "FAILURE", described: "read, findings open" }

describe("dw-sdlc pr ship after a Review that left a Finding open", () => {
  it("names the marked commit in details.since once a fix is pushed, over an earlier success", () => {
    const histories: [string, Commit[]][] = [
      ["a mark alone", [{ oid: EARLIER }, { oid: REVIEWED, ...MARK }]],
      [
        "a mark after a success",
        [
          { oid: EARLIER, review: "SUCCESS" },
          { oid: REVIEWED, ...MARK }
        ]
      ]
    ]
    for (const [name, history] of histories) {
      const run = ship(["--json"], [{ ...PUSHED_ON, history: [...history, { oid: PUSHED, review: null }] }])
      assert.equal(run.status, 10, `${name}: ${run.stderr}`)
      assert.deepEqual(
        documentOf(run.stdout, ["action", "details"]),
        {
          action: "review",
          details: { depth: "full", source: "config", reviewCommand: "/code-review", since: REVIEWED }
        },
        name
      )
      assert.deepEqual(run.calls, [AUTH, READ, compare(HEAD)], name)
    }
  })

  it("carries nothing over a head that only merged the base in after a mark, reading no compare to carry", () => {
    const history: Commit[] = [
      { oid: EARLIER, review: "SUCCESS" },
      { oid: REVIEWED, ...MARK },
      { oid: PUSHED, review: null, parents: 2 }
    ]
    const run = ship(["--json"], [{ ...MERGED_IN, history }], {
      ...compared(REVIEWED, [READ_THEN]),
      ...compared(HEAD, [SHIFTED])
    })
    assert.equal(run.status, 10, run.stderr)
    assert.deepEqual(documentOf(run.stdout, ["action", "details", "performed"]), {
      action: "review",
      details: { depth: "full", source: "config", reviewCommand: "/code-review", since: REVIEWED },
      performed: []
    })
    assert.deepEqual(run.calls, [AUTH, READ, compare(HEAD)])
  })

  it("names no since over a rewritten history that no longer holds a marked commit", () => {
    const rebased: Commit[] = [{ oid: EARLIER }, { oid: PUSHED, review: null }, { oid: REVIEWED, review: "PENDING" }]
    const run = ship(["--json"], [{ ...PUSHED_ON, history: rebased }])
    assert.equal(run.status, 10, run.stderr)
    assert.deepEqual(documentOf(run.stdout, ["action", "details"]), {
      action: "review",
      details: { depth: "full", source: "config", reviewCommand: "/code-review" }
    })
  })

  it("reads past a failure that is not the read mark", () => {
    const history: Commit[] = [
      { oid: EARLIER, review: "SUCCESS" },
      { oid: REVIEWED, review: "FAILURE", described: "a review found a bug" },
      { oid: PUSHED, review: null }
    ]
    const run = ship(["--json"], [{ ...PUSHED_ON, history }])
    assert.equal(run.status, 10, run.stderr)
    assert.deepEqual(documentOf(run.stdout, ["action", "details"]), {
      action: "review",
      details: { depth: "full", source: "config", reviewCommand: "/code-review", since: EARLIER }
    })
  })
})
