// `dw-sdlc pr ship` with no number on a branch pushed under another name: gh resolves no pull request for
// the branch itself, so the script asks by the name its upstream gives, and takes that pull request only
// when its commits hold the local head.

import assert from "node:assert/strict"
import { join } from "node:path"
import { describe, it } from "node:test"

import { COMMITTED_FILE } from "../../src/agentic-config.ts"
import { commit, git, lines, runBin, scratch, writeJson } from "../harness.ts"
import { fakeGh, GREEN, type Pr, type Response, type Scenario, served } from "../pr-harness.ts"

const URL = "https://github.com/byarcadia-app/foundation/pull/40"
const AUTH = ["auth", "status", "--active", "--hostname", "github.com"]
const VIEW = ["pr", "view", "--json", "url"]
const VIEW_RENAMED = ["pr", "view", "fix/feat", "--json", "url"]
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
const NO_PR: Response = { exit: 1, stderr: 'no pull requests found for branch "feat"\n' }
const FOUND: Response = { stdout: JSON.stringify({ url: URL }) }
const NAME_IT = "name it: dw-sdlc pr ship <n> -R owner/name"

/** The compare of the base with `oid`, the call that judges a branch behind its base. */
function compare(oid: string): string[] {
  return ["api", `repos/byarcadia-app/foundation/compare/${GREEN.baseOid}...${oid}?per_page=1`]
}

/** A clone of a bare remote, on main at one pushed commit, its config asking for full Reviews. */
function clone(): string {
  const remote = scratch("remote")
  git(remote, "init", "-q", "--bare", "-b", "main")
  const root = join(scratch("clone"), "checkout")
  git(remote, "clone", "-q", remote, root)
  git(root, "symbolic-ref", "HEAD", "refs/heads/main")
  writeJson(join(root, COMMITTED_FILE), { pr: { review: "full" } })
  git(root, "add", COMMITTED_FILE)
  commit(root, "-m", "init")
  git(root, "push", "-q", "-u", "origin", "main")
  return root
}

/** A branch `feat` with one commit, pushed as `fix/feat` and tracking it there. */
function pushedRenamed(): string {
  const root = clone()
  git(root, "switch", "-q", "-c", "feat")
  commit(root, "--allow-empty", "-m", "change")
  git(root, "push", "-q", "-u", "origin", "feat:fix/feat")
  return root
}

function head(root: string): string {
  return git(root, "rev-parse", "HEAD").trim()
}

/** `dw-sdlc pr ship <args>` from `root` against a fake gh playing `scenario`, every compare answered behind by none. */
function ship(root: string, args: string[], scenario: Scenario, pr: Pr) {
  const behind = { stdout: JSON.stringify({ status: "ahead", ahead_by: 1, behind_by: 0 }) }
  const gh = fakeGh({ ...scenario, commands: { [compare(pr.head).join(" ")]: behind, ...scenario.commands } })
  const run = runBin(["pr", "ship", ...args], root, gh.env)
  return { ...run, calls: gh.calls() }
}

/** `pr` found only under the upstream's name, as gh answers for a branch pushed under another name. */
function renamed(pr: Pr): Scenario {
  return { commands: { "pr view": NO_PR, [VIEW_RENAMED.join(" ")]: FOUND }, graphql: [served(pr)] }
}

describe("dw-sdlc pr ship on a branch pushed under another name", () => {
  it("takes the pull request of its upstream's name when it holds the local head", () => {
    const root = pushedRenamed()
    const pr = { ...GREEN, head: head(root), branch: "fix/feat" }
    const run = ship(root, ["--json"], renamed(pr), pr)
    assert.equal(run.status, 30, run.stderr)
    const document = JSON.parse(run.stdout) as { pr: string; head: string; action: string }
    assert.equal(document.pr, URL)
    assert.equal(document.head, pr.head)
    assert.equal(document.action, "ready-to-merge")
    assert.deepEqual(run.calls, [AUTH, VIEW, VIEW_RENAMED, READ, compare(pr.head)])
  })

  it("takes none when that pull request lacks the local head, and performs nothing", () => {
    const root = pushedRenamed()
    const pushed = head(root)
    commit(root, "--allow-empty", "-m", "not pushed")
    const pr = { ...GREEN, head: pushed, branch: "fix/feat" }
    const run = ship(root, ["--merge"], renamed(pr), pr)
    assert.equal(run.status, 2)
    assert.equal(run.stdout, "")
    const short = head(root).slice(0, 7)
    assert.deepEqual(lines(run.stderr), [
      `dw-sdlc pr ship: ${URL}, found by fix/feat, the name its upstream gives, lacks HEAD ${short} — push HEAD if it is this branch's pull request, else ${NAME_IT}`
    ])
    assert.deepEqual(run.calls, [AUTH, VIEW, VIEW_RENAMED, READ])
  })

  it("takes none of the branch it was started from, before its first push", () => {
    const root = clone()
    git(root, "switch", "-q", "-c", "fix/feat")
    commit(root, "--allow-empty", "-m", "on the parent")
    git(root, "push", "-q", "-u", "origin", "fix/feat")
    const parent = { ...GREEN, head: head(root), branch: "fix/feat" }
    git(root, "switch", "-q", "-c", "feat", "--track", "origin/fix/feat")
    commit(root, "--allow-empty", "-m", "on feat")
    const run = ship(root, [], renamed(parent), parent)
    assert.equal(run.status, 2)
    assert.match(run.stderr, /lacks HEAD/)
    assert.deepEqual(run.calls, [AUTH, VIEW, VIEW_RENAMED, READ])
  })

  it("exits 2 with a remedy when neither name has a pull request", () => {
    const root = pushedRenamed()
    const scenario: Scenario = { commands: { "pr view": NO_PR } }
    const run = ship(root, [], scenario, GREEN)
    assert.equal(run.status, 2)
    assert.deepEqual(lines(run.stderr), [
      `dw-sdlc pr ship: gh pr view found no pull request for feat, nor for fix/feat, the name its upstream gives — ${NAME_IT}`
    ])
    assert.deepEqual(run.calls, [AUTH, VIEW, VIEW_RENAMED])
  })

  it("keeps the pull request gh resolves for the branch itself, and asks nothing by the upstream's name", () => {
    const root = pushedRenamed()
    const pr = { ...GREEN, head: head(root), branch: "feat" }
    const scenario: Scenario = { commands: { "pr view": FOUND }, graphql: [served(pr)] }
    const run = ship(root, [], scenario, pr)
    assert.equal(run.status, 30, run.stderr)
    assert.deepEqual(run.calls, [AUTH, VIEW, READ, compare(pr.head)])
  })

  it("reads the pull request a number names, and asks nothing by the upstream's name", () => {
    const root = pushedRenamed()
    const pr = { ...GREEN, head: head(root) }
    const scenario: Scenario = { commands: { "pr view": FOUND }, graphql: [served(pr)] }
    const run = ship(root, ["40"], scenario, pr)
    assert.equal(run.status, 30, run.stderr)
    assert.deepEqual(run.calls, [AUTH, ["pr", "view", "40", "--json", "url"], READ, compare(pr.head)])
  })

  it("leaves a repository -R names to gh, and asks nothing by the upstream's name", () => {
    const root = pushedRenamed()
    const said = "argument required when using the --repo flag"
    const scenario: Scenario = { commands: { "pr view": { exit: 1, stderr: `${said}\n` } } }
    const run = ship(root, ["-R", "byarcadia-app/foundation"], scenario, GREEN)
    assert.equal(run.status, 2)
    assert.deepEqual(lines(run.stderr), [`dw-sdlc pr ship: gh pr view found no pull request: ${said} — ${NAME_IT}`])
    assert.deepEqual(run.calls, [AUTH, ["pr", "view", "-R", "byarcadia-app/foundation", "--json", "url"]])
  })
})
