// `dw-sdlc pr reviewed` spawned with a fake gh first on PATH: the status it posts on the head it was
// given, the refusal when the head moved, its exit code and every gh call it made.

import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { lines, repo, runBin, scratch } from "../harness.ts"
import { fakeGh, GREEN, HEAD, type Scenario, served } from "../pr-harness.ts"

const URL = "https://github.com/byarcadia-app/foundation/pull/40"
const MOVED = "0123456789abcdef0123456789abcdef01234567"
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
/** The call the fake keys as `api repos/…`: the endpoint right after `api`. */
const ENDPOINT = `repos/byarcadia-app/foundation/statuses/${HEAD}`
const POST = [
  "api",
  ENDPOINT,
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
  "description=a clean review of this head"
]

/** `dw-sdlc pr reviewed <args>` against a fake gh playing `scenario`, from a repository with no pull request. */
function reviewed(args: string[], scenario: Scenario) {
  const gh = fakeGh(scenario)
  const run = runBin(["pr", "reviewed", ...args], repo(), gh.env)
  return { ...run, calls: gh.calls() }
}

describe("dw-sdlc pr reviewed", () => {
  it("posts dw-sdlc/review in state success on the head it was given, the pull request as target", () => {
    const run = reviewed([...TARGET, "--head", HEAD], { graphql: [served(GREEN)] })
    assert.equal(run.status, 0, run.stderr)
    assert.equal(run.stdout, `posted dw-sdlc/review success on ${HEAD}\n`)
    assert.deepEqual(run.calls, [AUTH, READ, POST])
  })

  it("prints the head, the context and the state with --json", () => {
    const run = reviewed([...TARGET, "--head", HEAD, "--json"], { graphql: [served(GREEN)] })
    assert.equal(run.status, 0, run.stderr)
    assert.deepEqual(JSON.parse(run.stdout), { head: HEAD, context: "dw-sdlc/review", state: "success" })
    assert.deepEqual(run.calls, [AUTH, READ, POST])
  })

  it("resolves the repository through gh pr view when -R is omitted", () => {
    const view = { stdout: `${JSON.stringify({ url: URL })}\n` }
    const run = reviewed(["40", "--head", HEAD], { commands: { "pr view": view }, graphql: [served(GREEN)] })
    assert.equal(run.status, 0, run.stderr)
    assert.deepEqual(run.calls, [AUTH, ["pr", "view", "40", "--json", "url"], READ, POST])
  })

  it("posts nothing and exits 2 naming both shas when a push moved the head since the review", () => {
    const run = reviewed([...TARGET, "--head", HEAD], { graphql: [served({ ...GREEN, head: MOVED })] })
    assert.equal(run.status, 2)
    assert.deepEqual(lines(run.stderr), [
      `dw-sdlc pr reviewed: byarcadia-app/foundation#40: the head is ${MOVED}, not ${HEAD}: a push landed since the review — review the new head, then call again with its sha`
    ])
    assert.equal(run.stdout, "")
    assert.deepEqual(run.calls, [AUTH, READ])
  })

  it("prints its usage with --help", () => {
    const run = reviewed(["--help"], {})
    assert.equal(run.status, 0, run.stderr)
    assert.ok(
      run.stdout.startsWith("Usage: dw-sdlc pr reviewed <n> [-R owner/name] --head <sha> [--json]\n"),
      run.stdout
    )
    assert.deepEqual(run.calls, [])
  })
})

describe("dw-sdlc pr reviewed when it cannot run", () => {
  it("exits 2 with the usage on a missing or bad argument, before any gh call", () => {
    const cases: [string[], string][] = [
      [TARGET, "dw-sdlc pr reviewed: name the head the review read: --head <sha>"],
      [["--head", HEAD], "dw-sdlc pr reviewed: name the pull request: dw-sdlc pr reviewed <n> --head <sha>"],
      [[...TARGET, "--head", "e36732e"], 'dw-sdlc pr reviewed: --head takes the full 40-character sha, not "e36732e"'],
      [["forty", "--head", HEAD], 'dw-sdlc pr reviewed: "forty" is not a pull request number'],
      [["40", "41", "--head", HEAD], "dw-sdlc pr reviewed: name one pull request, not 2"],
      [["40", "-R", "foundation", "--head", HEAD], 'dw-sdlc pr reviewed: -R takes owner/name, not "foundation"'],
      [[...TARGET, "--head", HEAD, "--state", "failure"], "dw-sdlc pr reviewed: Unknown option '--state'"]
    ]
    for (const [args, problem] of cases) {
      const run = reviewed(args, {})
      assert.equal(run.status, 2, args.join(" "))
      const [first = "", ...rest] = lines(run.stderr)
      assert.ok(first.startsWith(problem), `${args.join(" ")}: ${first}`)
      assert.ok(
        rest.some((line) => line.startsWith("Usage: dw-sdlc pr reviewed")),
        run.stderr
      )
      assert.deepEqual(run.calls, [], args.join(" "))
    }
  })

  it("exits 2 with a remedy when gh is not on PATH", () => {
    const run = runBin(["pr", "reviewed", ...TARGET, "--head", HEAD], repo(), { PATH: scratch("no-gh") })
    assert.equal(run.status, 2)
    assert.deepEqual(lines(run.stderr), [
      "dw-sdlc pr reviewed: gh is not on PATH — install the GitHub CLI from https://cli.github.com"
    ])
  })

  it("exits 2 with a remedy when GitHub has no such pull request, and posts nothing", () => {
    const stderr = "gh: Could not resolve to a PullRequest with the number of 40.\n"
    const run = reviewed([...TARGET, "--head", HEAD], { graphql: [{ exit: 1, stderr }] })
    assert.equal(run.status, 2)
    assert.deepEqual(lines(run.stderr), [
      "dw-sdlc pr reviewed: byarcadia-app/foundation#40: Could not resolve to a PullRequest with the number of 40. — check the number, or name the repository with -R owner/name"
    ])
    assert.deepEqual(run.calls, [AUTH, READ])
  })

  it("names itself in the remedy when gh pr view resolves no repository", () => {
    const stderr = "could not determine the repository\n"
    const run = reviewed(["40", "--head", HEAD], { commands: { "pr view": { exit: 1, stderr } } })
    assert.equal(run.status, 2)
    assert.deepEqual(lines(run.stderr), [
      "dw-sdlc pr reviewed: gh pr view found no pull request: could not determine the repository — name it: dw-sdlc pr reviewed <n> -R owner/name"
    ])
    assert.deepEqual(run.calls, [AUTH, ["pr", "view", "40", "--json", "url"]])
  })

  it("exits 2 with a remedy when GitHub refuses the status", () => {
    const refused = { exit: 1, stdout: '{"message":"Not Found"}', stderr: "gh: Not Found (HTTP 404)\n" }
    const run = reviewed([...TARGET, "--head", HEAD], {
      graphql: [served(GREEN)],
      commands: { [`api ${ENDPOINT}`]: refused }
    })
    assert.equal(run.status, 2)
    assert.deepEqual(lines(run.stderr), [
      "dw-sdlc pr reviewed: byarcadia-app/foundation#40: posting dw-sdlc/review failed: Not Found (HTTP 404) — check that gh's token may write commit statuses to byarcadia-app/foundation, then call again"
    ])
    assert.equal(run.stdout, "")
    assert.deepEqual(run.calls, [AUTH, READ, POST])
  })
})
