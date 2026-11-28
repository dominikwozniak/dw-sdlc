// `dw-sdlc pr ship` checks the local checkout before it hands the agent a fix: behind the head it puts
// `git pull --rebase` first in next, on another branch or with commits the pull request lacks it parks
// wrong-checkout, and under -R from elsewhere it checks nothing.

import assert from "node:assert/strict"
import { join } from "node:path"
import { describe, it } from "node:test"

import { COMMITTED_FILE } from "../../src/agentic-config.ts"
import { commit, git, repo, runBin, scratch, writeJson } from "../harness.ts"
import { type Context, fakeGh, GREEN, HEAD, type Pr, RUN, type Response, served } from "../pr-harness.ts"

const REPOSITORY = "byarcadia-app/foundation"
const URL = `https://github.com/${REPOSITORY}/pull/40`
const FOUND: Response = { stdout: JSON.stringify({ url: URL }) }
const PULL = { by: "agent", run: "git pull --rebase" }
const FIX = {
  by: "agent",
  do: "read each failing check's log under details.checks, fix the cause, then git push"
}

const FAILING: Context = { kind: "run", name: "Check", state: "FAILURE", link: RUN, startedAt: "2026-10-31T11:01:00Z" }
const PASSING: Context = { ...FAILING, state: "SUCCESS" }

/** A clone of a bare remote on main, then branch `feat/example` pushed with one commit. */
function checkout(): string {
  const remote = scratch("remote")
  git(remote, "init", "-q", "--bare", "-b", "main")
  const root = join(scratch("clone"), "checkout")
  git(remote, "clone", "-q", remote, root)
  git(root, "symbolic-ref", "HEAD", "refs/heads/main")
  writeJson(join(root, COMMITTED_FILE), { pr: { merge: "ask" } })
  git(root, "add", COMMITTED_FILE)
  commit(root, "-m", "init")
  git(root, "push", "-q", "-u", "origin", "main")
  git(root, "switch", "-q", "-c", "feat/example")
  commit(root, "--allow-empty", "-m", "change")
  git(root, "push", "-q", "-u", "origin", "feat/example")
  return root
}

function head(root: string): string {
  return git(root, "rev-parse", "HEAD").trim()
}

/** `pr ship --json` from `cwd` for a pull request of `pr`, CI failing unless `pr` says otherwise. */
function ship(cwd: string, pr: Pr, args: string[] = []) {
  const gh = fakeGh({ commands: { "pr view": FOUND }, graphql: [served(pr)] })
  const run = runBin(["pr", "ship", ...args, "--json"], cwd, gh.env)
  assert.notEqual(run.stdout, "", `no document; exit ${run.status}: ${run.stderr}`)
  return { run, document: JSON.parse(run.stdout) as Record<string, unknown>, calls: gh.calls() }
}

const failing = (root: string): Pr => ({ ...GREEN, head: head(root), checks: [FAILING] })

describe("dw-sdlc pr ship checks the checkout before it hands the agent a fix", () => {
  it("leaves next as the row gives it on the pull request's branch at its head", () => {
    const root = checkout()
    const { run, document } = ship(root, failing(root))
    assert.equal(run.status, 10, run.stderr)
    assert.equal(document.action, "fix-ci")
    assert.deepEqual(document.next, [FIX])
  })

  it("puts git pull --rebase first in next on the pull request's branch behind its head", () => {
    const root = checkout()
    const behind = head(root)
    const pr: Pr = { ...failing(root), head: HEAD, history: [{ oid: behind }] }
    const { run, document } = ship(root, pr)
    assert.equal(run.status, 10, run.stderr)
    assert.equal(document.action, "fix-ci")
    assert.deepEqual(document.next, [PULL, FIX])
  })

  it("puts it first before a conflict's own steps, and leaves each blocker's next alone", () => {
    const root = checkout()
    const pr: Pr = { ...failing(root), head: HEAD, history: [{ oid: head(root) }], mergeable: "CONFLICTING" }
    const { document } = ship(root, pr)
    assert.equal(document.action, "fix-conflicts")
    const next = document.next as unknown[]
    assert.deepEqual(next[0], PULL)
    assert.equal(next.length, 3)
    const [blocker] = document.blockers as { action: string; next: unknown[] }[]
    assert.equal(blocker?.action, "fix-ci")
    assert.deepEqual(blocker?.next, [
      { by: "agent", do: "read each failing check's log under details.checks, fix the cause, in the same push" }
    ])
  })

  it("parks wrong-checkout on another branch, with the dev's git switch as its one step", () => {
    const root = checkout()
    const pr = failing(root)
    git(root, "switch", "-q", "main")
    const { run, document } = ship(root, pr)
    assert.equal(run.status, 30, run.stderr)
    assert.equal(document.status, "park")
    assert.equal(document.action, "wrong-checkout")
    assert.equal(document.actor, "dev")
    assert.deepEqual(document.next, [{ by: "dev", run: "git switch feat/example" }])
    assert.equal(
      document.reason,
      `the checkout is on main, not on feat/example at ${pr.head.slice(0, 7)}, the branch of the pull request`
    )
    assert.deepEqual(document.blockers, [])
  })

  it("parks wrong-checkout on a detached HEAD", () => {
    const root = checkout()
    const pr = failing(root)
    git(root, "switch", "-q", "--detach")
    const { run, document } = ship(root, pr)
    assert.equal(run.status, 30, run.stderr)
    assert.equal(document.action, "wrong-checkout")
    assert.match(String(document.reason), /^the checkout is on a detached HEAD, not on feat\/example/)
  })

  it("parks wrong-checkout on the pull request's branch with a commit the pull request lacks", () => {
    const root = checkout()
    const pr = failing(root)
    commit(root, "--allow-empty", "-m", "not pushed")
    const { run, document } = ship(root, pr)
    assert.equal(run.status, 30, run.stderr)
    assert.equal(document.action, "wrong-checkout")
    assert.deepEqual(document.next, [{ by: "dev", run: "git switch feat/example" }])
    assert.equal(
      document.reason,
      `the checkout is on feat/example at ${head(root).slice(0, 7)}, which the pull request lacks, not on feat/example at ${pr.head.slice(0, 7)}, the branch of the pull request`
    )
  })

  it("takes a branch pushed under the pull request's branch name for its branch", () => {
    const root = checkout()
    git(root, "switch", "-q", "-c", "local-name")
    git(root, "push", "-q", "-u", "origin", "local-name:feat/example")
    const { run, document } = ship(root, failing(root))
    assert.equal(run.status, 10, run.stderr)
    assert.deepEqual(document.next, [FIX])
  })

  it("checks nothing under -R from a directory outside the repository", () => {
    const root = checkout()
    const pr = failing(root)
    git(root, "switch", "-q", "main")
    const outside = scratch("outside")
    const { run, document, calls } = ship(outside, pr, ["40", "-R", REPOSITORY])
    assert.equal(run.status, 10, run.stderr)
    assert.equal(document.action, "fix-ci")
    assert.deepEqual(document.next, [FIX])
    assert.deepEqual(
      calls.map(([command]) => command),
      ["auth", "api"]
    )
  })

  it("checks nothing under -R from another checkout of the repository", () => {
    const root = checkout()
    const pr = failing(root)
    git(root, "switch", "-q", "main")
    const { run, document } = ship(root, pr, ["40", "-R", REPOSITORY])
    assert.equal(run.status, 10, run.stderr)
    assert.deepEqual(document.next, [FIX])
  })

  it("checks nothing outside a repository when the call names no repository to read from", () => {
    const outside = repo({ git: false })
    const { run, document } = ship(outside, { ...GREEN, checks: [FAILING] }, ["40"])
    assert.equal(run.status, 10, run.stderr)
    assert.deepEqual(document.next, [FIX])
  })

  it("leaves an answer that hands the agent nothing to the pull request alone", () => {
    const root = checkout()
    git(root, "switch", "-q", "main")
    const pr: Pr = { ...GREEN, head: head(root), checks: [PASSING] }
    const { run, document } = ship(root, pr)
    assert.equal(run.status, 30, run.stderr)
    assert.equal(document.action, "ready-to-merge")
  })

  it("names wrong-checkout in --help", () => {
    const run = runBin(["pr", "ship", "--help"], repo(), {})
    assert.equal(run.status, 0, run.stderr)
    assert.match(run.stdout, /wrong-checkout/)
    assert.match(run.stdout, /git pull --rebase/)
  })
})
