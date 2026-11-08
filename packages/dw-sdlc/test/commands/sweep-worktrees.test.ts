// `dw-sdlc sweep` on linked worktrees, spawned on throwaway clones of a bare origin: the worktrees and the
// branches left after the run, the lines or the document and the exit code. Never on this repository: its
// worktrees are other sessions' work.

import assert from "node:assert/strict"
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { describe, it } from "node:test"

import { buildLandedRepo } from "../../../../plugins/sdlc/test/landed-scenarios.ts"
import { commit, git, lines, runBin, runCommand, scratch, write, writeJson } from "../harness.ts"

type Item = { kind: string; name: string; reason: string; command?: string | null }
type Document = { dryRun: boolean; base: string; removed: Item[]; kept: Item[] }

function clone(): string {
  const dir = scratch("sweep-trees")
  return buildLandedRepo(join(dir, "clone"), join(dir, "origin.git"), [])
}

function documentOf(stdout: string): Document {
  return JSON.parse(stdout) as Document
}

function branches(root: string): string[] {
  return lines(git(root, "for-each-ref", "--format=%(refname:short)", "refs/heads"))
}

/** A linked worktree of `root` at `path` on a new branch from main's tip. */
function addTree(root: string, path: string, branch: string): string {
  mkdirSync(dirname(path), { recursive: true })
  git(root, "worktree", "add", "-q", "-b", branch, path, "main")
  return path
}

/** The worktree paths `root` lists, the main checkout first. */
function trees(root: string): string[] {
  return lines(git(root, "worktree", "list", "--porcelain"))
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length))
}

function namesOf(items: Item[], kind: string): string[] {
  return items.filter((item) => item.kind === kind).map(({ name }) => name)
}

describe("a worktree whose whole set passes", () => {
  it("goes with its branch in one run, wherever the worktree lies", () => {
    const root = clone()
    const inside = addTree(root, join(root, ".claude/worktrees/inside"), "in-claude")
    const beside = addTree(root, `${root}-beside`, "beside")
    const away = addTree(root, join(scratch("elsewhere"), "away"), "away")
    const run = runBin(["sweep", "--json"], root)
    const { removed, kept } = documentOf(run.stdout)
    assert.deepEqual(namesOf(removed, "worktree").toSorted(), [inside, beside, away].toSorted())
    assert.deepEqual(namesOf(removed, "branch").toSorted(), ["away", "beside", "in-claude"])
    assert.deepEqual(trees(root), [root])
    assert.deepEqual(branches(root), ["main"])
    assert.deepEqual(kept, [{ kind: "branch", name: "main", reason: "the default branch", command: null }])
    assert.equal(run.status, 0)
  })

  it("removes a worktree before the branch it had checked out", () => {
    const root = clone()
    const tree = addTree(root, join(scratch("order"), "tree"), "topic")
    git(root, "branch", "plain")
    const { removed } = documentOf(runBin(["sweep", "--json"], root).stdout)
    assert.deepEqual(
      removed.map(({ kind, name }) => [kind, name]),
      [
        ["worktree", tree],
        ["branch", "topic"],
        ["branch", "plain"]
      ]
    )
  })

  it("goes when only ignored files are in it", () => {
    const root = clone()
    writeFileSync(join(root, ".git/info/exclude"), "node_modules/\n")
    const tree = addTree(root, join(scratch("ignored"), "tree"), "deps")
    write(join(tree, "node_modules/pkg/index.js"), "x\n")
    const run = runBin(["sweep"], root)
    assert.equal(run.status, 0, run.stderr)
    assert.equal(existsSync(tree), false)
    assert.deepEqual(branches(root), ["main"])
  })

  it("is named in a line, and a dry run removes nothing and answers the same items", () => {
    const root = clone()
    const tree = addTree(root, join(scratch("dry"), "tree"), "topic")
    const dry = runBin(["sweep", "--dry-run"], root)
    assert.deepEqual(lines(dry.stdout), [
      `would remove worktree ${tree} — clean, its HEAD is Landed on origin/main`,
      "would remove branch topic — Landed on origin/main",
      "kept branch main — the default branch",
      "terminals not read — outside herdr, $HC_TERMINAL_ID is not set"
    ])
    assert.equal(dry.status, 0)
    assert.deepEqual(trees(root), [root, tree])
    const first = documentOf(runBin(["sweep", "--dry-run", "--json"], root).stdout)
    const real = documentOf(runBin(["sweep", "--json"], root).stdout)
    assert.equal(first.dryRun, true)
    assert.deepEqual({ ...first, dryRun: false }, real)
    assert.deepEqual(trees(root), [root])
  })
})

describe("a worktree that stays", () => {
  it("keeps a modified or untracked file's worktree and its branch, the files listed and the forced removal named", () => {
    const root = clone()
    const tree = addTree(root, join(scratch("dirty"), "tree"), "dirty")
    write(join(tree, "README.md"), "changed\n")
    write(join(tree, "new.txt"), "new\n")
    const run = runBin(["sweep", "--json"], root)
    const { removed, kept } = documentOf(run.stdout)
    assert.deepEqual(removed, [])
    const item = kept.find(({ kind }) => kind === "worktree")
    assert.equal(item?.name, tree)
    assert.match(item?.reason ?? "", /README\.md/)
    assert.match(item?.reason ?? "", /new\.txt/)
    assert.equal(item?.command, `git worktree remove --force ${tree}`)
    const held = kept.find(({ name }) => name === "dirty")
    assert.equal(held?.reason, `checked out in the worktree at ${tree}`)
    assert.deepEqual(trees(root), [root, tree])
    assert.equal(run.status, 1)
  })

  it("keeps a worktree with a paused rebase", () => {
    const root = clone()
    const tree = addTree(root, join(scratch("rebase"), "tree"), "topic")
    write(join(tree, "README.md"), "topic\n")
    git(tree, "add", "README.md")
    commit(tree, "-m", "topic edit")
    write(join(root, "README.md"), "main\n")
    git(root, "add", "README.md")
    commit(root, "-m", "main edit")
    const rebase = runCommand(
      "git",
      ["-C", tree, "-c", "user.email=t@example.com", "-c", "user.name=t", "rebase", "main"],
      tree
    )
    assert.notEqual(rebase.status, 0)
    const run = runBin(["sweep", "--json"], root)
    const item = documentOf(run.stdout).kept.find(({ kind }) => kind === "worktree")
    assert.equal(item?.name, tree)
    assert.match(item?.reason ?? "", /rebase/)
    assert.deepEqual(trees(root), [root, tree])
    assert.equal(run.status, 1)
  })

  it("keeps a worktree at a commit that is not Landed, and removes a detached one at a Landed commit", () => {
    const root = clone()
    const landed = join(scratch("detached"), "landed")
    const unlanded = join(scratch("detached"), "unlanded")
    git(root, "worktree", "add", "-q", "--detach", landed, "main")
    git(root, "worktree", "add", "-q", "--detach", unlanded, "main")
    write(join(unlanded, "work.txt"), "only here\n")
    git(unlanded, "add", "work.txt")
    commit(unlanded, "-m", "only here")
    const run = runBin(["sweep", "--json"], root)
    const { removed, kept } = documentOf(run.stdout)
    assert.deepEqual(namesOf(removed, "worktree"), [landed])
    const item = kept.find(({ kind }) => kind === "worktree")
    assert.equal(item?.name, unlanded)
    assert.match(item?.reason ?? "", /on no commit of origin\/main/)
    assert.deepEqual(trees(root), [root, unlanded])
    assert.equal(run.status, 1)
  })

  it("keeps a locked worktree with the lock's reason", () => {
    const root = clone()
    const tree = addTree(root, join(scratch("locked"), "tree"), "topic")
    git(root, "worktree", "lock", "--reason", "held by a backup job", tree)
    const run = runBin(["sweep", "--json"], root)
    const { removed, kept } = documentOf(run.stdout)
    assert.deepEqual(removed, [])
    const item = kept.find(({ kind }) => kind === "worktree")
    assert.match(item?.reason ?? "", /held by a backup job/)
    assert.equal(item?.command, `git worktree unlock ${tree}`)
    assert.deepEqual(trees(root), [root, tree])
    assert.equal(run.status, 1)
  })

  it("names the lock's reason of a locked worktree whose folder is gone", () => {
    const root = clone()
    const tree = addTree(root, join(scratch("gone"), "tree"), "topic")
    git(root, "worktree", "lock", "--reason", "held by a backup job", tree)
    rmSync(tree, { recursive: true })
    const { kept } = documentOf(runBin(["sweep", "--json"], root).stdout)
    const item = kept.find(({ kind }) => kind === "worktree")
    assert.match(item?.reason ?? "", /held by a backup job/)
    assert.equal(item?.command, `git worktree unlock ${tree}`)
  })

  it("keeps a worktree git refuses to remove with git's words, its branch with it, and goes on", () => {
    const root = clone()
    const refused = addTree(root, join(scratch("refused"), "tree"), "refused")
    const fine = addTree(root, join(scratch("fine"), "tree"), "fine")
    chmodSync(dirname(refused), 0o555)
    try {
      const run = runBin(["sweep", "--json"], root)
      const { removed, kept } = documentOf(run.stdout)
      assert.deepEqual(namesOf(removed, "worktree"), [fine])
      assert.deepEqual(namesOf(removed, "branch"), ["fine"])
      const item = kept.find(({ kind }) => kind === "worktree")
      assert.equal(item?.name, refused)
      assert.match(item?.reason ?? "", /failed to delete|Permission denied/)
      assert.equal(item?.command, `git worktree remove --force ${refused}`)
      assert.equal(kept.find(({ name }) => name === "refused")?.reason, `checked out in the worktree at ${refused}`)
      assert.ok(branches(root).includes("refused"))
      assert.equal(run.status, 1)
    } finally {
      chmodSync(dirname(refused), 0o755)
    }
  })
})

describe("the exit code", () => {
  it("is 0 when a worktree goes and only the default branch stays", () => {
    const root = clone()
    addTree(root, join(scratch("zero"), "tree"), "topic")
    const run = runBin(["sweep"], root)
    assert.equal(run.status, 0)
    assert.match(run.stdout, /^kept branch main — the default branch$/m)
  })

  it("is 0 when the worktree of a protected branch goes and the branch stays, still listed", () => {
    const root = clone()
    writeJson(join(root, ".ai/agentic.config.json"), { version: 1, guardrails: { protectedBranches: ["release"] } })
    const tree = addTree(root, join(scratch("protected"), "tree"), "release")
    const run = runBin(["sweep", "--json"], root)
    const { removed, kept } = documentOf(run.stdout)
    assert.deepEqual(namesOf(removed, "worktree"), [tree])
    assert.deepEqual(Object.fromEntries(kept.map(({ name, reason }) => [name, reason])), {
      main: "the default branch",
      release: "a protected branch"
    })
    assert.deepEqual(branches(root).toSorted(), ["main", "release"])
    assert.equal(run.status, 0)
  })
})
