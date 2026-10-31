// `dw-sdlc pr ship` spawned with a fake gh first on PATH: for each pull request on the wire, the
// document or the line it answers, its exit code and the gh calls it made.

import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { lines, repo, runBin, scratch } from "../harness.ts"
import {
  fakeGh,
  GREEN,
  HEAD,
  type Pr,
  pullRequestOf,
  reply,
  type Response,
  RUN,
  type Scenario,
  served
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

/** As GitHub reports a merged pull request: mergeability no longer computed. */
const MERGED: Pr = {
  ...GREEN,
  state: "MERGED",
  mergeable: "UNKNOWN",
  mergeStateStatus: "UNKNOWN",
  mergeCommit: MERGE_COMMIT
}

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
    { id: "PRRT_open", path: "src/a.ts", line: 42, author: "dominikwozniak", body: "Memoise the offerings." },
    { id: "PRRT_ghost", path: "src/b.ts", line: null, author: null, body: "A file-level note." },
    { id: "PRRT_resolved", path: "src/c.ts", line: 1, author: "dominikwozniak", body: "Done.", resolved: true },
    { id: "PRRT_outdated", path: "src/d.ts", line: 2, author: "dominikwozniak", body: "Moved.", outdated: true }
  ]
}

/** `dw-sdlc pr ship <args>` against a fake gh playing `scenario`, from a repository with no pull request. */
function ship(args: string[], scenario: Scenario, env: NodeJS.ProcessEnv = {}) {
  const gh = fakeGh(scenario)
  const run = runBin(["pr", "ship", ...args], repo(), { ...gh.env, ...env })
  return { ...run, calls: gh.calls() }
}

function json(pr: Pr, ...flags: string[]) {
  const run = ship([...TARGET, "--json", ...flags], { graphql: [served(pr)] })
  assert.notEqual(run.stdout, "", `no document; exit ${run.status}: ${run.stderr}`)
  return { ...run, document: JSON.parse(run.stdout) as unknown }
}

describe("dw-sdlc pr ship", () => {
  it("answers done for a merged pull request, with the merge commit and the branch deletion for the dev", () => {
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

  it("parks any other open pull request as undecided, the dev's to read, rather than pretend", () => {
    const run = json(GREEN)
    assert.equal(run.status, 30, run.stderr)
    assert.deepEqual(run.document, {
      pr: URL,
      head: HEAD,
      base: "main",
      status: "park",
      action: "undecided",
      actor: "dev",
      reason: "no row of the decision matches this pull request",
      blockers: [],
      performed: []
    })
    assert.deepEqual(run.calls, [AUTH, READ])
  })

  it("adds the state as read under facts with --verbose: buckets as gh pr checks sorts them, open threads only", () => {
    const run = json(MIXED, "--verbose")
    assert.equal(run.status, 20, run.stderr)
    assert.ok(typeof run.document === "object" && run.document !== null && "facts" in run.document, run.stdout)
    assert.deepEqual(run.document.facts, {
      url: URL,
      repo: "byarcadia-app/foundation",
      state: "OPEN",
      draft: true,
      mergeable: "UNKNOWN",
      mergeStateStatus: "BLOCKED",
      reviewDecision: "REVIEW_REQUIRED",
      viewerDidAuthor: false,
      head: HEAD,
      headCommittedAt: "2026-10-31T11:00:00Z",
      branch: "feat/example",
      base: "main",
      mergeCommit: null,
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
        { id: "PRRT_open", path: "src/a.ts", line: 42, author: "dominikwozniak", body: "Memoise the offerings." },
        { id: "PRRT_ghost", path: "src/b.ts", line: null, author: "ghost", body: "A file-level note." }
      ]
    })
    const bare = json({ ...GREEN, checks: [] }, "--verbose").document
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
    assert.ok(run.stdout.startsWith("Usage: dw-sdlc pr ship [<n>] [-R owner/name] [--json] [--verbose]\n"), run.stdout)
    assert.deepEqual(run.calls, [])
  })

  it("prints one line without --json: the status, the action unless it repeats it, the reason and the command", () => {
    const cases: [Pr, number, string][] = [
      [MERGED, 0, "done: merged as b04365a — git push origin --delete feat/example"],
      [{ ...GREEN, state: "CLOSED" }, 30, "park stop: closed without merging"],
      [{ ...GREEN, mergeable: "UNKNOWN" }, 20, "wait: mergeability-unknown, recheck in 15 s"],
      [GREEN, 30, "park undecided: no row of the decision matches this pull request"]
    ]
    for (const [pr, status, line] of cases) {
      const run = ship(TARGET, { graphql: [served(pr)] })
      assert.deepEqual([run.status, run.stdout], [status, `${line}\n`], run.stderr)
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
