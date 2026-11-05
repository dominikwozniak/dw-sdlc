// `dw-sdlc recap` spawned with a fake gh first on PATH, on a throwaway clone of a bare repository: each
// fact, each reason of the close verdict, the exit code and the gh calls it made, none of them a write.

import assert from "node:assert/strict"
import { join } from "node:path"
import { describe, it } from "node:test"

import { COMMITTED_FILE } from "../../src/agentic-config.ts"
import { commit, git, initRepo, runBin, scratch, write, writeJson } from "../harness.ts"
import { fakeGh, GREEN, type Pr, type Response, type Scenario, served } from "../pr-harness.ts"

const AUTH = ["auth", "status", "--active", "--hostname", "github.com"]
const VIEW = ["pr", "view", "--json", "url"]
const DEFAULT = ["repo", "view", "--json", "defaultBranchRef"]
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
const URL = "https://github.com/byarcadia-app/foundation/pull/40"

const NO_PR: Response = { exit: 1, stderr: 'no pull requests found for branch "feat"\n' }
const FOUND: Response = { stdout: JSON.stringify({ url: URL }) }
const MAIN: Response = { stdout: JSON.stringify({ defaultBranchRef: { name: "main" } }) }

type Reason = { id: string; blocks: boolean; text: string }
type Document = {
  branch: string | null
  head: string | null
  uncommitted: number
  upstream: string | null
  unpushed: number
  pullRequest: { url: string; state: string; status: string; action: string; actor: string; reason: string } | null
  worktree: { linked: boolean; path: string }
  close: { verdict: "yes" | "no"; line: string; reasons: Reason[] }
}

/** A clone of a bare repository, on main at one pushed commit. */
function clone(): string {
  const remote = scratch("remote")
  git(remote, "init", "-q", "--bare", "-b", "main")
  const root = join(scratch("clone"), "checkout")
  git(remote, "clone", "-q", remote, root)
  git(root, "symbolic-ref", "HEAD", "refs/heads/main")
  commit(root, "--allow-empty", "-m", "init")
  git(root, "push", "-q", "-u", "origin", "main")
  return root
}

function head(root: string): string {
  return git(root, "rev-parse", "HEAD").trim()
}

/** A new branch `feat`, `commits` commits on top of where the checkout stands. */
function branch(root: string, commits: number): void {
  git(root, "switch", "-q", "-c", "feat")
  for (let index = 0; index < commits; index += 1) {
    commit(root, "--allow-empty", "-m", `change ${index}`)
  }
}

function recap(root: string, scenario: Scenario, ...flags: string[]) {
  const fake = fakeGh(scenario)
  const run = runBin(["recap", ...flags], root, fake.env)
  return { ...run, calls: fake.calls() }
}

function document(root: string, scenario: Scenario): ReturnType<typeof recap> & { doc: Document } {
  const run = recap(root, scenario, "--json")
  assert.notEqual(run.status, 2, run.stderr)
  return { ...run, doc: JSON.parse(run.stdout) as Document }
}

function refuses(root: string, scenario: Scenario, flags: string[], message: RegExp): void {
  const { status, stdout, stderr } = recap(root, scenario, ...flags)
  assert.equal(status, 2, stderr)
  assert.equal(stdout, "")
  assert.match(stderr, message)
}

function ids({ close }: Document): string[] {
  return close.reasons.map((reason) => reason.id)
}

function blocking({ close }: Document): string[] {
  return close.reasons.filter((reason) => reason.blocks).map((reason) => reason.id)
}

const noPr: Scenario = { commands: { "pr view": NO_PR, "repo view": MAIN } }

function withPr(pr: Pr): Scenario {
  return { commands: { "pr view": FOUND }, graphql: [served(pr)] }
}

describe("dw-sdlc recap", () => {
  it("clean and pushed on the default branch, no pull request: it can close", () => {
    const root = clone()
    const { status, doc, calls } = document(root, noPr)
    assert.equal(status, 0)
    assert.deepEqual(doc, {
      branch: "main",
      head: head(root),
      uncommitted: 0,
      upstream: "origin/main",
      unpushed: 0,
      pullRequest: null,
      worktree: { linked: false, path: root },
      close: {
        verdict: "yes",
        line: "Close the session: yes, because nothing is uncommitted, unpushed or open",
        reasons: [{ id: "clean", blocks: false, text: "nothing is uncommitted, unpushed or open" }]
      }
    })
    assert.deepEqual(calls, [AUTH, VIEW, DEFAULT])
  })

  it("uncommitted changes, tracked and untracked, block it and each counts", () => {
    const root = clone()
    write(join(root, "tracked.txt"), "one\n")
    git(root, "add", "tracked.txt")
    commit(root, "-m", "add a file")
    git(root, "push", "-q")
    write(join(root, "tracked.txt"), "two\n")
    write(join(root, "new.txt"), "new\n")
    const { status, doc } = document(root, noPr)
    assert.equal(status, 1)
    assert.equal(doc.uncommitted, 2)
    assert.deepEqual(doc.close.reasons, [{ id: "uncommitted", blocks: true, text: "2 uncommitted changes" }])
    assert.equal(doc.close.line, "Close the session: no, because 2 uncommitted changes")
  })

  it("unpushed commits block it and name the upstream; the default branch needs no pull request", () => {
    const root = clone()
    commit(root, "--allow-empty", "-m", "one more")
    const { status, doc } = document(root, noPr)
    assert.equal(status, 1)
    assert.equal(doc.upstream, "origin/main")
    assert.equal(doc.unpushed, 1)
    assert.deepEqual(doc.close.reasons, [{ id: "unpushed", blocks: true, text: "1 commit not pushed to origin/main" }])
  })

  it("a branch with no upstream and commits of its own: both reasons, in one line", () => {
    const root = clone()
    branch(root, 2)
    const { status, doc } = document(root, noPr)
    assert.equal(status, 1)
    assert.equal(doc.branch, "feat")
    assert.equal(doc.upstream, null)
    assert.equal(doc.unpushed, 2)
    assert.equal(doc.pullRequest, null)
    assert.deepEqual(ids(doc), ["no-upstream", "no-pull-request"])
    assert.equal(
      doc.close.line,
      "Close the session: no, because 2 commits on a branch with no upstream; 2 commits on top of main in no pull request"
    )
  })

  it("a branch with no upstream and nothing of its own has nothing to lose: it can close", () => {
    const root = clone()
    branch(root, 0)
    const { status, doc } = document(root, noPr)
    assert.equal(status, 0)
    assert.equal(doc.upstream, null)
    assert.equal(doc.unpushed, 0)
    assert.deepEqual(ids(doc), ["clean"])
  })

  it("a pushed branch with no pull request blocks it", () => {
    const root = clone()
    branch(root, 1)
    git(root, "push", "-q", "-u", "origin", "feat")
    const { status, doc, calls } = document(root, noPr)
    assert.equal(status, 1)
    assert.equal(doc.upstream, "origin/feat")
    assert.equal(doc.unpushed, 0)
    assert.deepEqual(doc.close.reasons, [
      { id: "no-pull-request", blocks: true, text: "1 commit on top of main in no pull request" }
    ])
    assert.deepEqual(calls, [AUTH, VIEW, DEFAULT])
  })

  it("an open pull request blocks it, whatever its Action, and carries that Action's words", () => {
    const root = clone()
    branch(root, 1)
    git(root, "push", "-q", "-u", "origin", "feat")
    const pr = { ...GREEN, head: head(root), branch: "feat" }
    const { status, doc, calls } = document(root, withPr(pr))
    assert.equal(status, 1)
    assert.equal(doc.pullRequest?.url, URL)
    assert.equal(doc.pullRequest?.state, "OPEN")
    assert.equal(doc.pullRequest?.status, "park")
    assert.equal(doc.pullRequest?.action, "ready-to-merge")
    assert.equal(doc.pullRequest?.actor, "dev")
    assert.deepEqual(doc.close.reasons, [
      {
        id: "open-pull-request",
        blocks: true,
        text: "pull request #40 is open: park ready-to-merge: pr.merge is ask: the merge is the dev's"
      }
    ])
    assert.deepEqual(calls, [AUTH, VIEW, READ], "it reads the pull request and writes nothing")
  })

  it("reads a script's Action without performing it: a merge under pr.merge auto, a branch behind, a draft", () => {
    const root = clone()
    writeJson(join(root, COMMITTED_FILE), { pr: { merge: "auto" } })
    git(root, "add", COMMITTED_FILE)
    commit(root, "-m", "merge on green")
    git(root, "push", "-q")
    branch(root, 1)
    git(root, "push", "-q", "-u", "origin", "feat")
    const green = { ...GREEN, head: head(root), branch: "feat" }
    const cases: [Pr, string][] = [
      [green, "merge"],
      [{ ...green, mergeStateStatus: "BEHIND" }, "update-branch"],
      [{ ...green, draft: true }, "mark-ready"]
    ]
    for (const [pr, action] of cases) {
      const { status, doc, calls } = document(root, withPr(pr))
      assert.equal(status, 1)
      assert.equal(doc.pullRequest?.status, "act")
      assert.equal(doc.pullRequest?.action, action)
      assert.equal(doc.pullRequest?.actor, "script")
      assert.deepEqual(calls, [AUTH, VIEW, READ], `${action} is read, never performed`)
    }
  })

  it("a merged pull request holding the head: it can close, with the upstream gone after the branch's deletion", () => {
    const root = clone()
    branch(root, 2)
    git(root, "push", "-q", "-u", "origin", "feat")
    const sha = head(root)
    git(root, "push", "-q", "origin", "--delete", "feat")
    const merged: Pr = {
      ...GREEN,
      head: sha,
      branch: "feat",
      state: "MERGED",
      mergeable: "UNKNOWN",
      mergeStateStatus: "UNKNOWN",
      mergeCommit: "b04365ad73c61edcf175d9c5632740eb13fd2e4d"
    }
    const { status, doc } = document(root, withPr(merged))
    assert.equal(status, 0)
    assert.equal(doc.upstream, null)
    assert.equal(doc.unpushed, 0, "a commit the pull request holds is on GitHub")
    assert.equal(doc.pullRequest?.status, "done")
    assert.deepEqual(doc.close.reasons, [
      { id: "clean", blocks: false, text: "nothing is uncommitted, unpushed or open" },
      { id: "merged", blocks: false, text: "pull request #40 merged as b04365a" }
    ])
  })

  it("a merged pull request whose head moved on GitHub still holds a local head behind it", () => {
    const root = clone()
    branch(root, 1)
    const local = head(root)
    const merged: Pr = {
      ...GREEN,
      head: "9".repeat(40),
      history: [{ oid: local }],
      branch: "feat",
      state: "MERGED",
      mergeable: "UNKNOWN",
      mergeStateStatus: "UNKNOWN",
      mergeCommit: null
    }
    const { status, doc } = document(root, withPr(merged))
    assert.equal(status, 0)
    assert.equal(doc.unpushed, 0)
  })

  it("commits after a merged pull request's head block it: no pull request holds them", () => {
    const root = clone()
    branch(root, 1)
    git(root, "push", "-q", "-u", "origin", "feat")
    const merged: Pr = {
      ...GREEN,
      head: head(root),
      branch: "feat",
      state: "MERGED",
      mergeable: "UNKNOWN",
      mergeStateStatus: "UNKNOWN",
      mergeCommit: null
    }
    commit(root, "--allow-empty", "-m", "after the merge")
    const { status, doc, calls } = document(root, withPr(merged))
    assert.equal(status, 1)
    assert.deepEqual(blocking(doc), ["unpushed", "no-pull-request"])
    assert.ok(!calls.some((call) => call[0] === "repo"), "the pull request's base names the branch to count from")
  })

  it("a pull request closed without merging is the dev's call: it can close, and says so", () => {
    const root = clone()
    branch(root, 1)
    git(root, "push", "-q", "-u", "origin", "feat")
    const closed: Pr = { ...GREEN, head: head(root), branch: "feat", state: "CLOSED" }
    const { status, doc } = document(root, withPr(closed))
    assert.equal(status, 0)
    assert.equal(doc.pullRequest?.action, "stop")
    assert.deepEqual(ids(doc), ["clean", "closed"])
    assert.match(doc.close.line, /pull request #40 closed without merging/)
  })

  it("a linked worktree is a fact and no block: the session cannot remove the directory it runs in", () => {
    const root = clone()
    const linked = join(scratch("linked"), "tree")
    git(root, "worktree", "add", "-q", "-b", "feat", linked)
    const { status, doc } = document(linked, noPr)
    assert.equal(status, 0)
    assert.deepEqual(doc.worktree, { linked: true, path: linked })
    assert.deepEqual(doc.close.reasons, [
      { id: "clean", blocks: false, text: "nothing is uncommitted, unpushed or open" },
      { id: "worktree", blocks: false, text: `the worktree at ${linked} is left to remove` }
    ])
  })

  it("a detached HEAD: no branch and no gh call; only commits on no remote block it", () => {
    const root = clone()
    git(root, "switch", "-q", "--detach")
    const atRemote = document(root, noPr)
    assert.equal(atRemote.status, 0)
    assert.equal(atRemote.doc.branch, null)
    assert.deepEqual(atRemote.calls, [])
    commit(root, "--allow-empty", "-m", "on no branch")
    const ahead = document(root, noPr)
    assert.equal(ahead.status, 1)
    assert.deepEqual(ahead.doc.close.reasons, [
      { id: "no-upstream", blocks: true, text: "1 commit on a detached HEAD, on no remote" }
    ])
  })

  it("a repository with no remote asks gh nothing; its commits block it", () => {
    const root = initRepo(scratch("local"), { branch: "main" })
    const empty = document(root, noPr)
    assert.equal(empty.status, 0, "a repository with no commit has nothing to lose")
    assert.equal(empty.doc.branch, "main")
    assert.equal(empty.doc.head, null)
    commit(root, "--allow-empty", "-m", "init")
    const { status, doc, calls } = document(root, noPr)
    assert.equal(status, 1)
    assert.deepEqual(ids(doc), ["no-upstream"])
    assert.deepEqual(calls, [])
  })

  it("reads the whole repository from a subdirectory", () => {
    const root = clone()
    write(join(root, "dir", "new.txt"), "new\n")
    write(join(root, "other.txt"), "other\n")
    const { status, doc } = document(join(root, "dir"), noPr)
    assert.equal(status, 1)
    assert.equal(doc.uncommitted, 2)
    assert.equal(doc.worktree.path, root)
  })

  it("prints one line a fact and the close line without --json", () => {
    const root = clone()
    branch(root, 1)
    const { status, stdout } = recap(root, noPr)
    assert.equal(status, 1)
    assert.equal(
      stdout,
      [
        "branch: feat",
        "uncommitted: 0",
        "upstream: none, 1 unpushed",
        "pull request: none",
        "worktree: main checkout",
        "Close the session: no, because 1 commit on a branch with no upstream; 1 commit on top of main in no pull request",
        ""
      ].join("\n")
    )
  })

  it("names the pull request's Action and a linked worktree in its lines", () => {
    const root = clone()
    const linked = join(scratch("linked"), "tree")
    git(root, "worktree", "add", "-q", "-b", "feat", linked)
    commit(linked, "--allow-empty", "-m", "change")
    git(linked, "push", "-q", "-u", "origin", "feat")
    const pr = { ...GREEN, head: head(linked), branch: "feat", draft: true }
    const { stdout } = recap(linked, withPr(pr))
    const rows = stdout.split("\n")
    assert.equal(rows[2], "upstream: origin/feat, 0 unpushed")
    assert.equal(rows[3], `pull request: ${URL} act mark-ready: still a draft`)
    assert.equal(rows[4], `worktree: linked at ${linked}`)
  })

  describe("cannot run", () => {
    it("outside a repository", () => {
      refuses(scratch("outside"), noPr, [], /^dw-sdlc recap: no git repository holds .* — run it from a checkout\n$/)
    })

    it("when gh is not signed in", () => {
      const scenario = { commands: { "auth status": { exit: 1, stderr: "X Failed to log in\n" } } }
      refuses(clone(), scenario, [], /gh auth status failed: Failed to log in/)
    })

    it("when gh pr view fails for any reason but no pull request", () => {
      const scenario = { commands: { "pr view": { exit: 1, stderr: "could not connect to api.github.com\n" } } }
      refuses(clone(), scenario, [], /gh pr view failed: could not connect to api\.github\.com/)
    })

    it("when the read of the pull request fails", () => {
      const scenario = { commands: { "pr view": FOUND }, graphql: [{ exit: 1, stderr: "gh: Bad credentials\n" }] }
      refuses(clone(), scenario, [], /byarcadia-app\/foundation#40: Bad credentials/)
    })

    it("when the default branch cannot be read", () => {
      const root = clone()
      branch(root, 1)
      const scenario = { commands: { "pr view": NO_PR, "repo view": { exit: 1, stderr: "HTTP 500\n" } } }
      refuses(root, scenario, [], /gh repo view failed: HTTP 500/)
    })

    it("on an unknown flag or an argument", () => {
      const root = clone()
      refuses(root, noPr, ["--nope"], /Usage: dw-sdlc recap/)
      refuses(root, noPr, ["40"], /takes no argument/)
    })
  })

  it("--help prints the exit codes and calls nothing", () => {
    const root = clone()
    const { status, stdout, calls } = recap(root, noPr, "--help")
    assert.equal(status, 0)
    assert.match(stdout, /Exit 0 the session can be closed, 1 it cannot, 2 when it cannot run\./)
    assert.deepEqual(calls, [])
  })
})
