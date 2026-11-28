// `dw-sdlc pr ship` at done finishes the Landed branch: in the main checkout one agent step switches to
// the base, pulls and deletes the local branch as far as the state allows; the remote branch is the dev's
// while its head ref stands; a linked worktree gets the dev's /sdlc-sweep. Under -R it checks nothing.

import assert from "node:assert/strict"
import { join } from "node:path"
import { describe, it } from "node:test"

import { COMMITTED_FILE } from "../../src/agentic-config.ts"
import { commit, git, repo, runBin, scratch, writeJson } from "../harness.ts"
import { fakeGh, GREEN, type Pr, served } from "../pr-harness.ts"

const REPOSITORY = "byarcadia-app/foundation"
const URL = `https://github.com/${REPOSITORY}/pull/40`
const FOUND = { stdout: JSON.stringify({ url: URL }) }
const MERGE_COMMIT = "b04365a7e8e1e3b6c1a3f0d1f8f1c4e5d6a7b8c9"
const SWITCH_PULL_DELETE = "git switch main && git pull --rebase && git branch -D feat/example"
const DELETE_REMOTE = { by: "dev", run: "git push origin --delete feat/example" }
const SWEEP = { by: "dev", run: "/sdlc-sweep" }

/** A clone of a bare remote on main, then branch `feat/example` pushed with one commit, checked out. */
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

const head = (root: string): string => git(root, "rev-parse", "HEAD").trim()

/** A merged pull request whose head is the checkout's; `more` states what a test changes. */
const merged = (root: string, more: Partial<Pr> = {}): Pr => ({
  ...GREEN,
  state: "MERGED",
  mergeable: "UNKNOWN",
  mergeStateStatus: "UNKNOWN",
  mergeCommit: MERGE_COMMIT,
  head: head(root),
  ...more
})

function ship(cwd: string, pr: Pr, args: string[] = []) {
  const gh = fakeGh({ commands: { "pr view": FOUND }, graphql: [served(pr)] })
  const run = runBin(["pr", "ship", ...args, "--json"], cwd, gh.env)
  assert.notEqual(run.stdout, "", `no document; exit ${run.status}: ${run.stderr}`)
  return { run, document: JSON.parse(run.stdout) as Record<string, unknown>, calls: gh.calls() }
}

const agent = (run: string) => ({ by: "agent", run })

describe("dw-sdlc pr ship at done in the main checkout", () => {
  it("hands the agent the one step that switches, pulls and deletes, then the dev the remote delete", () => {
    const root = checkout()
    const { run, document } = ship(root, merged(root))
    assert.equal(run.status, 0, run.stderr)
    assert.equal(document.action, "done")
    assert.deepEqual(document.next, [agent(SWITCH_PULL_DELETE), DELETE_REMOTE])
  })

  it("leaves out the remote delete once the head ref is gone, and for a fork's pull request", () => {
    const root = checkout()
    assert.deepEqual(ship(root, merged(root, { headDeleted: true })).document.next, [agent(SWITCH_PULL_DELETE)])
    const fork = ship(root, merged(root, { fromFork: true })).document.next
    assert.deepEqual(fork, [agent("git switch main && git pull --rebase")])
  })

  it("leaves out git switch on another branch", () => {
    const root = checkout()
    const pr = merged(root)
    git(root, "switch", "-q", "main")
    const { document } = ship(root, pr)
    assert.deepEqual(document.next, [agent("git pull --rebase && git branch -D feat/example"), DELETE_REMOTE])
  })

  it("leaves out -D when the branch is not local", () => {
    const root = checkout()
    const pr = merged(root)
    git(root, "switch", "-q", "main")
    git(root, "branch", "-q", "-D", "feat/example")
    const { document } = ship(root, pr)
    assert.deepEqual(document.next, [agent("git pull --rebase"), DELETE_REMOTE])
  })

  it("leaves out -D when the local tip is not the merged head, and a do step says why", () => {
    const root = checkout()
    const pr = merged(root)
    commit(root, "--allow-empty", "-m", "not merged")
    const tip = head(root).slice(0, 7)
    const { run, document } = ship(root, pr)
    assert.equal(run.status, 0, run.stderr)
    assert.deepEqual(document.next, [
      agent("git switch main && git pull --rebase"),
      {
        by: "agent",
        do: `tell the dev feat/example stays: its tip ${tip} is not the merged head ${pr.head.slice(0, 7)}`
      },
      DELETE_REMOTE
    ])
  })

  it("switches off a detached HEAD, which the pull cannot run on", () => {
    const root = checkout()
    const pr = merged(root)
    git(root, "switch", "-q", "--detach")
    const { document } = ship(root, pr)
    assert.deepEqual(document.next, [agent(SWITCH_PULL_DELETE), DELETE_REMOTE])
  })

  it("quotes a branch name the shell would split", () => {
    const root = checkout()
    git(root, "branch", "-q", "-m", "feat/example", "fix/it's")
    const { document } = ship(root, merged(root, { branch: "fix/it's" }))
    assert.deepEqual(document.next, [
      agent("git switch main && git pull --rebase && git branch -D 'fix/it'\\''s'"),
      { by: "dev", run: "git push origin --delete 'fix/it'\\''s'" }
    ])
  })

  it("passes no --delete-branch to gh", () => {
    const root = checkout()
    const { calls } = ship(root, merged(root))
    assert.equal(JSON.stringify(calls).includes("--delete-branch"), false)
  })

  it("prints the steps in the plain line", () => {
    const root = checkout()
    const gh = fakeGh({ commands: { "pr view": FOUND }, graphql: [served(merged(root))] })
    const run = runBin(["pr", "ship"], root, gh.env)
    assert.equal(run.status, 0, run.stderr)
    assert.equal(
      run.stdout.trim(),
      `done: merged as b04365a — agent: ${SWITCH_PULL_DELETE} — dev: git push origin --delete feat/example`
    )
  })

  it("leaves the answer as the pull request gives it under -R", () => {
    const root = checkout()
    const { document } = ship(root, merged(root), ["40", "-R", REPOSITORY])
    assert.deepEqual(document.next, [DELETE_REMOTE])
  })
})

/** The pull request's branch checked out in a linked worktree; the main checkout is back on main. */
function linked(): string {
  const root = checkout()
  git(root, "switch", "-q", "main")
  const tree = join(scratch("tree"), "worker")
  git(root, "worktree", "add", "-q", tree, "feat/example")
  return tree
}

describe("dw-sdlc pr ship at done in a linked worktree", () => {
  it("hands the dev /sdlc-sweep as the one step, the remote delete included in it", () => {
    const tree = linked()
    const { run, document } = ship(tree, merged(tree))
    assert.equal(run.status, 0, run.stderr)
    assert.deepEqual(document.next, [SWEEP])
  })

  it("hands the dev /sdlc-sweep for a fork's pull request too", () => {
    const tree = linked()
    assert.deepEqual(ship(tree, merged(tree, { fromFork: true })).document.next, [SWEEP])
  })
})

describe("dw-sdlc pr ship --help", () => {
  it("describes done on a Landed branch", () => {
    const run = runBin(["pr", "ship", "--help"], repo(), {})
    assert.equal(run.status, 0, run.stderr)
    assert.match(run.stdout, /git switch <base> && git pull --rebase && git branch -D <branch>/)
    assert.match(run.stdout, /\/sdlc-sweep/)
  })
})
