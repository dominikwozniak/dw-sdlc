// `dw-sdlc recap` spawned with a fake gh first on PATH, on a throwaway clone of a bare repository: each
// fact, each reason of the close verdict, the exit code and the gh calls it made, none of them a write. In
// herdr a fake hc joins it, for the Lead's live Workers.

import assert from "node:assert/strict"
import { readFileSync, utimesSync } from "node:fs"
import { delimiter, join } from "node:path"
import { describe, it } from "node:test"

import { COMMITTED_FILE } from "../../src/agentic-config.ts"
import { commit, git, initRepo, runBin, scratch, write, writeJson } from "../harness.ts"
import { fakeHerdr, listing, type Listed, type Reply, terminal } from "../hc-harness.ts"
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
  paused: string | null
  askedGh: boolean
  pullRequest: { url: string; state: string; status: string; action: string; actor: string; reason: string } | null
  worktree: { linked: boolean; path: string }
  workers: { name: string; address: string; state: string; status: string; folder: string }[] | null
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

/** An identity for what git refuses without one: CI has none of its own. */
const IDENTITY = ["-c", "user.email=t@example.com", "-c", "user.name=t"]

/** Stops a rebase after its last pick, on a clean tree and a detached HEAD. */
function pauseRebase(root: string): void {
  assert.throws(() => git(root, ...IDENTITY, "rebase", "-x", "false", "HEAD~1"))
}

function recap(root: string, scenario: Scenario, ...flags: string[]) {
  const fake = fakeGh(scenario)
  const run = runBin(["recap", ...flags], root, fake.env)
  return { ...run, calls: fake.calls() }
}

const LEAD = "t1"
const LIVE_WORKERS = ["ls", "--json", "--label", "role=worker"]
const WORKING: Listed = { address: "t4", name: "worker-9-demo", parent: LEAD, status: "working", cwd: "/work/repo" }
const BLOCKED: Listed = { address: "t5", name: "worker-10-other", parent: LEAD, status: "blocked", cwd: "/work/repo" }
/** A Worker of another Lead, and one of this Lead's whose terminal has ended. */
const THEIRS: Listed = { address: "t9", name: "worker-14-theirs", parent: "t0", status: "working" }
const ENDED: Listed = { address: "t7", name: "worker-12-gone", parent: LEAD, state: "finished" }
const WORKTREE = "/work/repo/.claude/worktrees/worker-9-demo"

/** Both fakes first on PATH, the calling terminal the Lead `t1` unless `env` says otherwise. */
function withHerdr(scenario: Scenario, ls: Reply, env: NodeJS.ProcessEnv = {}) {
  const gh = fakeGh(scenario)
  // herdr tells the folder t4 works in; it tells none for t5, which keeps the folder it was launched in.
  const herdr = fakeHerdr({ hc: { ls, "get t4": terminal("t4", { foreground: WORKTREE }) } }, LEAD)
  // Each fake's PATH is its own directory, then the machine's: only the two directories may come first.
  const path = [herdr.env.PATH?.split(delimiter)[0], gh.env.PATH].join(delimiter)
  return { env: { ...gh.env, ...herdr.env, PATH: path, ...env }, calls: gh.calls, hc: herdr.hcCalls }
}

/** `recap` in herdr, whose `hc ls` answers `ls`; the hc calls it made come back too. */
function inHerdr(root: string, scenario: Scenario, ls: Reply, ...flags: string[]) {
  const fakes = withHerdr(scenario, ls)
  const run = runBin(["recap", ...flags], root, fakes.env)
  return { ...run, calls: fakes.calls(), hc: fakes.hc() }
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

/** The call for a branch `feat` pushed as `fix/feat`: gh resolves only the local name by itself. */
const VIEW_RENAMED = ["pr", "view", "fix/feat", "--json", "url"]

/** `pr` found only under the upstream's name, as gh answers for a branch pushed under another name. */
function renamed(pr: Pr): Scenario {
  return { commands: { "pr view": NO_PR, [VIEW_RENAMED.join(" ")]: FOUND }, graphql: [served(pr)] }
}

/** The document on main at a pushed commit, with a branch `other` to pick from, once `pause` has run: it must block. */
function pausedOn(pause: (root: string) => void): Document {
  const root = clone()
  git(root, "switch", "-q", "-c", "other")
  commit(root, "--allow-empty", "-m", "on other")
  git(root, "switch", "-q", "main")
  pause(root)
  const { status, doc } = document(root, noPr)
  assert.equal(status, 1, JSON.stringify(doc.close))
  assert.equal(doc.uncommitted, 0)
  return doc
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
      paused: null,
      askedGh: true,
      pullRequest: null,
      worktree: { linked: false, path: root },
      workers: null,
      close: {
        verdict: "yes",
        line: "Close the session: yes, because nothing is uncommitted, unpushed or open",
        reasons: [{ id: "clean", blocks: false, text: "nothing is uncommitted, unpushed or open" }]
      }
    })
    assert.deepEqual(calls, [AUTH, VIEW])
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

  it("counts from the base's own ref: a pushed branch named feat/main is not the base", () => {
    const root = clone()
    git(root, "switch", "-q", "-c", "feat/main")
    commit(root, "--allow-empty", "-m", "change")
    git(root, "push", "-q", "-u", "origin", "feat/main")
    const { status, doc } = document(root, noPr)
    assert.equal(status, 1)
    assert.deepEqual(ids(doc), ["no-pull-request"])
  })

  it("a branch the config protects needs no pull request, and asks gh for no default branch", () => {
    const root = clone()
    writeJson(join(root, COMMITTED_FILE), { guardrails: { protectedBranches: ["main", "develop"] } })
    git(root, "add", COMMITTED_FILE)
    commit(root, "-m", "protect develop")
    git(root, "push", "-q")
    git(root, "switch", "-q", "-c", "develop")
    commit(root, "--allow-empty", "-m", "on develop")
    git(root, "push", "-q", "-u", "origin", "develop")
    const { status, doc, calls } = document(root, noPr)
    assert.equal(status, 0, JSON.stringify(doc.close))
    assert.deepEqual(ids(doc), ["clean"])
    assert.deepEqual(calls, [AUTH, VIEW])
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

  it("a branch pushed under another name finds the merged pull request of its upstream, gone since: it can close", () => {
    const root = clone()
    branch(root, 4)
    git(root, "push", "-q", "-u", "origin", "feat:fix/feat")
    const sha = head(root)
    git(root, "push", "-q", "origin", "--delete", "fix/feat")
    const merged: Pr = {
      ...GREEN,
      head: sha,
      branch: "fix/feat",
      state: "MERGED",
      mergeable: "UNKNOWN",
      mergeStateStatus: "UNKNOWN",
      mergeCommit: "b04365ad73c61edcf175d9c5632740eb13fd2e4d"
    }
    const { status, doc, calls } = document(root, renamed(merged))
    assert.equal(status, 0, JSON.stringify(doc.close))
    assert.equal(doc.pullRequest?.state, "MERGED")
    assert.deepEqual(ids(doc), ["clean", "merged"])
    assert.deepEqual(calls, [AUTH, VIEW, VIEW_RENAMED, READ])
  })

  it("a branch pushed under another name finds the open pull request of its upstream, and its Action", () => {
    const root = clone()
    branch(root, 1)
    git(root, "push", "-q", "-u", "origin", "feat:fix/feat")
    const pr = { ...GREEN, head: head(root), branch: "fix/feat" }
    const { status, doc, calls } = document(root, renamed(pr))
    assert.equal(status, 1)
    assert.equal(doc.upstream, "origin/fix/feat")
    assert.equal(doc.pullRequest?.url, URL)
    assert.equal(doc.pullRequest?.action, "ready-to-merge")
    assert.deepEqual(doc.close.reasons, [
      {
        id: "open-pull-request",
        blocks: true,
        text: "pull request #40 is open: park ready-to-merge: pr.merge is ask: the merge is the dev's"
      }
    ])
    assert.deepEqual(calls, [AUTH, VIEW, VIEW_RENAMED, READ])
  })

  it("a branch whose upstream is a local branch of another name asks gh for its own name", () => {
    const root = clone()
    git(root, "branch", "backup")
    branch(root, 1)
    git(root, "branch", "--set-upstream-to=backup", "feat")
    const { calls } = document(root, noPr)
    assert.deepEqual(calls, [AUTH, VIEW, DEFAULT])
  })

  it("a branch with no commit asks gh nothing by its upstream's name: no pull request can hold it", () => {
    const root = clone()
    git(root, "switch", "-q", "--orphan", "feat")
    git(root, "config", "branch.feat.remote", "origin")
    git(root, "config", "branch.feat.merge", "refs/heads/fix/feat")
    const { doc, calls } = document(root, renamed({ ...GREEN, branch: "fix/feat" }))
    assert.equal(doc.head, null)
    assert.equal(doc.pullRequest, null)
    assert.deepEqual(calls, [AUTH, VIEW])
  })

  it("a branch tracking the default branch, pushed under its own name, keeps the pull request gh resolves", () => {
    const root = clone()
    git(root, "switch", "-q", "-c", "feat", "--track", "origin/main")
    commit(root, "--allow-empty", "-m", "change")
    git(root, "push", "-q", "origin", "feat")
    const pr = { ...GREEN, head: head(root), branch: "feat" }
    const scenario: Scenario = {
      commands: { "pr view": FOUND, "pr view main --json url": NO_PR },
      graphql: [served(pr)]
    }
    const { doc, calls } = document(root, scenario)
    assert.equal(doc.pullRequest?.url, URL)
    assert.deepEqual(calls, [AUTH, VIEW, READ])
  })

  it("a branch started from another's, not pushed yet, takes no pull request of the branch it tracks", () => {
    const root = clone()
    git(root, "switch", "-q", "-c", "other")
    commit(root, "--allow-empty", "-m", "on other")
    git(root, "push", "-q", "-u", "origin", "other")
    const theirs = { ...GREEN, head: head(root), branch: "other" }
    git(root, "switch", "-q", "-c", "feat", "--track", "origin/other")
    commit(root, "--allow-empty", "-m", "on feat")
    const scenario: Scenario = {
      commands: { "pr view": NO_PR, "pr view other --json url": FOUND, "repo view": MAIN },
      graphql: [served(theirs)]
    }
    const { status, doc, calls } = document(root, scenario)
    assert.equal(status, 1)
    assert.equal(doc.pullRequest, null)
    assert.deepEqual(blocking(doc), ["unpushed", "no-pull-request"])
    assert.deepEqual(calls, [AUTH, VIEW, ["pr", "view", "other", "--json", "url"], READ, DEFAULT])
  })

  it("a pull request closed without merging, its branch still on the remote, is the dev's call: it can close", () => {
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

  it("a closed pull request does not hold the head: commits on no remote block it, with the upstream gone", () => {
    const root = clone()
    branch(root, 2)
    git(root, "push", "-q", "-u", "origin", "feat")
    const closed: Pr = { ...GREEN, head: head(root), branch: "feat", state: "CLOSED" }
    git(root, "push", "-q", "origin", "--delete", "feat")
    const { status, doc } = document(root, withPr(closed))
    assert.equal(status, 1)
    assert.equal(doc.upstream, null)
    assert.equal(doc.unpushed, 2)
    assert.deepEqual(blocking(doc), ["no-upstream"])
    assert.deepEqual(ids(doc), ["no-upstream", "closed"])
    assert.equal(doc.close.line, "Close the session: no, because 2 commits on a branch with no upstream")
  })

  it("a closed pull request's branch deleted with no fetch since: the remote is asked, not the tracking ref", () => {
    const root = clone()
    branch(root, 1)
    git(root, "push", "-q", "-u", "origin", "feat")
    const closed: Pr = { ...GREEN, head: head(root), branch: "feat", state: "CLOSED" }
    const remote = git(root, "remote", "get-url", "origin").trim()
    git(remote, "branch", "-q", "-D", "feat")
    const { status, doc } = document(root, withPr(closed))
    assert.equal(status, 1, JSON.stringify(doc.close))
    assert.equal(doc.upstream, null)
    assert.equal(doc.unpushed, 1)
    assert.deepEqual(blocking(doc), ["no-upstream"])
    git(root, "push", "-q", "origin", "feat:keep")
    const kept = document(root, withPr(closed))
    assert.equal(kept.status, 0, "another remote branch holds the commit")
    assert.deepEqual(ids(kept.doc), ["clean", "closed"])
  })

  it("a closed pull request's branch deleted with no fetch since, on a branch with no upstream: the remote is asked too", () => {
    const root = clone()
    branch(root, 1)
    git(root, "push", "-q", "origin", "feat")
    const closed: Pr = { ...GREEN, head: head(root), branch: "feat", state: "CLOSED" }
    const remote = git(root, "remote", "get-url", "origin").trim()
    assert.equal(document(root, withPr(closed)).status, 0, "the branch stands on the remote, upstream or not")
    git(remote, "branch", "-q", "-D", "feat")
    const { status, doc } = document(root, withPr(closed))
    assert.equal(status, 1, JSON.stringify(doc.close))
    assert.equal(doc.unpushed, 1)
    assert.deepEqual(blocking(doc), ["no-upstream"])
  })

  it("a closed pull request's commits gone from the branch too, by a reset, and on no remote branch block it", () => {
    const root = clone()
    const base = head(root)
    branch(root, 2)
    git(root, "push", "-q", "-u", "origin", "feat")
    const closed: Pr = { ...GREEN, head: head(root), branch: "feat", state: "CLOSED" }
    git(root, "push", "-q", "origin", "--delete", "feat")
    git(root, "reset", "-q", "--hard", base)
    const { status, doc } = document(root, withPr(closed))
    assert.equal(status, 1, JSON.stringify(doc.close))
    assert.equal(doc.unpushed, 0)
    assert.deepEqual(blocking(doc), ["orphaned"])
    assert.equal(doc.close.line, "Close the session: no, because 2 commits of pull request #40 on no remote branch")
  })

  it("a closed pull request's commits gone from the branch stay closable while a remote branch holds them", () => {
    const root = clone()
    const base = head(root)
    branch(root, 1)
    git(root, "push", "-q", "-u", "origin", "feat")
    const closed: Pr = { ...GREEN, head: head(root), branch: "feat", state: "CLOSED" }
    git(root, "reset", "-q", "--hard", base)
    git(root, "branch", "--unset-upstream")
    const { status, doc } = document(root, withPr(closed))
    assert.equal(status, 0, JSON.stringify(doc.close))
    assert.deepEqual(ids(doc), ["clean", "closed"])
  })

  it("a closed pull request whose head this checkout never had was never this session's to lose", () => {
    const root = clone()
    branch(root, 0)
    const closed: Pr = { ...GREEN, head: "9".repeat(40), branch: "feat", state: "CLOSED" }
    const { status, doc } = document(root, withPr(closed))
    assert.equal(status, 0, JSON.stringify(doc.close))
    assert.deepEqual(ids(doc), ["clean", "closed"])
  })

  it("says gh was not asked rather than that there is no pull request, on a no as on a yes", () => {
    const root = clone()
    branch(root, 2)
    git(root, "push", "-q", "-u", "origin", "feat")
    pauseRebase(root)
    const { status, stdout, calls } = recap(root, noPr)
    assert.equal(status, 1)
    assert.deepEqual(calls, [])
    assert.ok(stdout.split("\n").includes("pull request: gh not asked"), stdout)
    assert.equal(document(root, noPr).doc.askedGh, false)
  })

  it("a remote out of reach holds nothing: a closed pull request answers by the remotes that do answer", () => {
    const root = clone()
    branch(root, 1)
    git(root, "push", "-q", "-u", "origin", "feat")
    git(root, "remote", "add", "backup", join(scratch("gone"), "nowhere"))
    const closed: Pr = { ...GREEN, head: head(root), branch: "feat", state: "CLOSED" }
    assert.equal(document(root, withPr(closed)).status, 0, "origin still holds the branch")
    git(git(root, "remote", "get-url", "origin").trim(), "branch", "-q", "-D", "feat")
    const { status, doc } = document(root, withPr(closed))
    assert.equal(status, 1, JSON.stringify(doc.close))
    assert.deepEqual(blocking(doc), ["no-upstream"])
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
    assert.deepEqual(
      atRemote.doc.close.reasons,
      [{ id: "clean", blocks: false, text: "nothing is uncommitted or unpushed; gh was not asked" }],
      "it never read a pull request, so it says nothing of one"
    )
    commit(root, "--allow-empty", "-m", "on no branch")
    const ahead = document(root, noPr)
    assert.equal(ahead.status, 1)
    assert.deepEqual(ahead.doc.close.reasons, [
      { id: "no-upstream", blocks: true, text: "1 commit on a detached HEAD, on no remote" }
    ])
  })

  it("a paused rebase blocks it, on a clean tree and at a pushed commit", () => {
    const root = clone()
    branch(root, 2)
    git(root, "push", "-q", "-u", "origin", "feat")
    pauseRebase(root)
    const { status, doc, calls } = document(root, noPr)
    assert.equal(status, 1)
    assert.equal(doc.branch, null)
    assert.equal(doc.uncommitted, 0)
    assert.equal(doc.unpushed, 0)
    assert.equal(doc.paused, "rebase")
    assert.deepEqual(doc.close.reasons, [{ id: "paused", blocks: true, text: "a rebase is paused" }])
    assert.equal(doc.close.line, "Close the session: no, because a rebase is paused")
    assert.deepEqual(calls, [])
    git(root, ...IDENTITY, "rebase", "--abort")
    assert.equal(document(root, withPr({ ...GREEN, head: head(root), branch: "feat" })).doc.paused, null)
  })

  it("a paused merge, cherry-pick or bisect blocks it, on a clean tree and at a pushed commit", () => {
    const merge = pausedOn((root) =>
      git(root, ...IDENTITY, "merge", "-q", "--no-commit", "--no-ff", "-s", "ours", "other")
    )
    assert.deepEqual(merge.close.reasons, [{ id: "paused", blocks: true, text: "a merge is paused" }])
    const pick = pausedOn((root) => {
      assert.throws(() => git(root, ...IDENTITY, "cherry-pick", "other"))
    })
    assert.equal(pick.paused, "cherry-pick")
    assert.equal(pausedOn((root) => git(root, ...IDENTITY, "bisect", "start")).paused, "bisect")
  })

  it("a paused rebase in a linked worktree, whose git directory lies elsewhere, blocks it", () => {
    const root = clone()
    const linked = join(scratch("linked"), "tree")
    git(root, "worktree", "add", "-q", "-b", "feat", linked)
    commit(linked, "--allow-empty", "-m", "one")
    commit(linked, "--allow-empty", "-m", "two")
    git(linked, "push", "-q", "-u", "origin", "feat")
    pauseRebase(linked)
    const { status, doc } = document(linked, noPr)
    assert.equal(status, 1)
    assert.deepEqual(blocking(doc), ["paused"])
  })

  it("reads each of git's records of a paused operation", () => {
    const cases = [
      ["rebase-apply", "rebase or am"],
      ["REVERT_HEAD", "revert"],
      ["sequencer", "cherry-pick or revert"]
    ]
    for (const [record = "", paused] of cases) {
      const doc = pausedOn((root) => write(join(root, ".git", record), ""))
      assert.equal(doc.paused, paused)
    }
  })

  it("a paused rebase on a detached HEAD answers no with the remote out of reach: nothing it knows needs it", () => {
    const root = clone()
    branch(root, 2)
    git(root, "push", "-q", "-u", "origin", "feat")
    pauseRebase(root)
    git(root, "remote", "set-url", "origin", join(scratch("gone"), "nowhere"))
    const { status, doc } = document(root, noPr)
    assert.equal(status, 1)
    assert.deepEqual(blocking(doc), ["paused"])
  })

  it("writes nothing to the checkout, not even the refresh of the index git status would do", () => {
    const root = clone()
    write(join(root, "tracked.txt"), "one\n")
    git(root, "add", "tracked.txt")
    commit(root, "-m", "add a file")
    git(root, "push", "-q")
    const index = join(root, ".git", "index")
    const before = readFileSync(index)
    utimesSync(join(root, "tracked.txt"), new Date(), new Date(Date.now() + 60_000))
    assert.equal(document(root, noPr).status, 0)
    assert.deepEqual(readFileSync(index), before)
  })

  it("an untracked file counts whatever status.showUntrackedFiles says", () => {
    const root = clone()
    git(root, "config", "status.showUntrackedFiles", "no")
    write(join(root, "new.txt"), "new\n")
    const { status, doc } = document(root, noPr)
    assert.equal(status, 1)
    assert.equal(doc.uncommitted, 1)
  })

  it("an upstream that is a local branch is no upstream: its commits reach no remote", () => {
    const root = clone()
    git(root, "branch", "backup")
    git(root, "branch", "--set-upstream-to=backup", "main")
    commit(root, "--allow-empty", "-m", "on main alone")
    git(root, "branch", "-f", "backup", "main")
    const { status, doc } = document(root, noPr)
    assert.equal(status, 1, JSON.stringify(doc.close))
    assert.equal(doc.upstream, null)
    assert.equal(doc.unpushed, 1)
    assert.deepEqual(blocking(doc), ["no-upstream"])
  })

  it("a detached HEAD at a commit whose branch the remote lost, with no fetch since, blocks it", () => {
    const root = clone()
    branch(root, 1)
    git(root, "push", "-q", "-u", "origin", "feat")
    git(root, "switch", "-q", "--detach")
    git(git(root, "remote", "get-url", "origin").trim(), "branch", "-q", "-D", "feat")
    const { status, doc, calls } = document(root, noPr)
    assert.equal(status, 1, JSON.stringify(doc.close))
    assert.deepEqual(doc.close.reasons, [
      { id: "no-upstream", blocks: true, text: "1 commit on a detached HEAD, on no remote" }
    ])
    assert.deepEqual(calls, [])
  })

  it("a closed pull request's branch moved off the head on the remote, with no fetch since, blocks it", () => {
    const root = clone()
    const base = head(root)
    branch(root, 1)
    git(root, "push", "-q", "-u", "origin", "feat")
    const closed: Pr = { ...GREEN, head: head(root), branch: "feat", state: "CLOSED" }
    git(git(root, "remote", "get-url", "origin").trim(), "update-ref", "refs/heads/feat", base)
    const { status, doc } = document(root, withPr(closed))
    assert.equal(status, 1, JSON.stringify(doc.close))
    assert.equal(doc.unpushed, 1)
    assert.deepEqual(blocking(doc), ["no-upstream"])
  })

  it("a closed pull request's commit reached only through origin/HEAD, a symref to the deleted branch, blocks it", () => {
    const root = clone()
    branch(root, 1)
    git(root, "push", "-q", "-u", "origin", "feat")
    const closed: Pr = { ...GREEN, head: head(root), branch: "feat", state: "CLOSED" }
    git(root, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/feat")
    git(git(root, "remote", "get-url", "origin").trim(), "branch", "-q", "-D", "feat")
    const { status, doc } = document(root, withPr(closed))
    assert.equal(status, 1, JSON.stringify(doc.close))
    assert.deepEqual(blocking(doc), ["no-upstream"])
  })

  it("a closed pull request stays closable when the base moved on the remote with no fetch since", () => {
    const root = clone()
    branch(root, 1)
    git(root, "push", "-q", "-u", "origin", "feat")
    const closed: Pr = { ...GREEN, head: head(root), branch: "feat", state: "CLOSED" }
    const other = join(scratch("other"), "checkout")
    git(root, "clone", "-q", git(root, "remote", "get-url", "origin").trim(), other)
    commit(other, "--allow-empty", "-m", "main moves on")
    git(other, "push", "-q", "origin", "HEAD:main")
    const { status, doc } = document(root, withPr(closed))
    assert.equal(status, 0, JSON.stringify(doc.close))
    assert.deepEqual(ids(doc), ["clean", "closed"])
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
        "workers: not in herdr",
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

  describe("in herdr", () => {
    it("a live Worker of this Lead blocks it, named with its status; no other Lead's and no ended one counts", () => {
      const run = inHerdr(clone(), noPr, listing(WORKING, BLOCKED, THEIRS, ENDED), "--json")
      assert.equal(run.status, 1, run.stderr)
      const doc = JSON.parse(run.stdout) as Document
      assert.deepEqual(doc.workers, [
        { name: "worker-9-demo", address: "t4", state: "live", status: "working", folder: WORKTREE },
        { name: "worker-10-other", address: "t5", state: "live", status: "blocked", folder: "/work/repo" }
      ])
      const text = "2 live Workers: worker-9-demo (working), worker-10-other (blocked)"
      assert.deepEqual(doc.close.reasons, [{ id: "workers", blocks: true, text }])
      assert.equal(doc.close.line, `Close the session: no, because ${text}`)
      assert.deepEqual(run.hc, [LIVE_WORKERS, ["get", "t4", "--json"], ["get", "t5", "--json"]])
    })

    it("a Worker whose turn ended is still live: herdr's done is no Recap", () => {
      const run = inHerdr(clone(), noPr, listing({ ...WORKING, status: "done" }), "--json")
      assert.equal(run.status, 1, run.stderr)
      const text = "1 live Worker: worker-9-demo (done)"
      assert.deepEqual((JSON.parse(run.stdout) as Document).close.reasons, [{ id: "workers", blocks: true, text }])
    })

    it("no live Worker of this Lead: an empty list, and the session can close", () => {
      const run = inHerdr(clone(), noPr, listing(THEIRS, ENDED), "--json")
      assert.equal(run.status, 0, run.stderr)
      const doc = JSON.parse(run.stdout) as Document
      assert.deepEqual(doc.workers, [])
      assert.deepEqual(ids(doc), ["clean"])
    })

    it("names the live Workers in its lines, or none", () => {
      const root = clone()
      const { status, stdout } = inHerdr(root, noPr, listing(WORKING))
      assert.equal(status, 1)
      const rows = stdout.split("\n")
      assert.equal(rows[5], "workers: 1 live: worker-9-demo (working)")
      assert.equal(rows[6], "Close the session: no, because 1 live Worker: worker-9-demo (working)")
      assert.equal(inHerdr(root, noPr, listing()).stdout.split("\n")[5], "workers: none live")
    })

    it("outside herdr asks hc nothing, even with hc on PATH", () => {
      const fakes = withHerdr(noPr, listing(WORKING), { HC_TERMINAL_ID: "" })
      const run = runBin(["recap", "--json"], clone(), fakes.env)
      assert.equal(run.status, 0, run.stderr)
      assert.equal((JSON.parse(run.stdout) as Document).workers, null)
      assert.deepEqual(fakes.hc(), [])
    })

    it("cannot run when hc fails, since a Worker it cannot see may be live", () => {
      const failed = inHerdr(clone(), noPr, { exit: 1, stderr: "hc: the core is not running\n" })
      assert.equal(failed.status, 2)
      assert.equal(failed.stdout, "")
      assert.match(failed.stderr, /^dw-sdlc recap: hc ls failed: hc: the core is not running/)
    })
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
