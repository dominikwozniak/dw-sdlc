// `dw-sdlc sweep` on worktrees locked by a Claude Code session, spawned on throwaway clones of a bare
// origin. A live lock names the test's own process and its real start time, a stale one the pid of a child
// that has exited, a reused one a live pid with another start time. Never on this repository.

import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { describe, it } from "node:test"

import { buildLandedRepo } from "../../../../plugins/sdlc/test/landed-scenarios.ts"
import { git, lines, runBin, scratch, write } from "../harness.ts"

type Item = { kind: string; name: string; reason: string; command?: string | null }
type Document = { dryRun: boolean; base: string; removed: Item[]; kept: Item[] }

function clone(): string {
  const dir = scratch("sweep-locks")
  return buildLandedRepo(join(dir, "clone"), join(dir, "origin.git"), [])
}

function documentOf(stdout: string): Document {
  return JSON.parse(stdout) as Document
}

function addTree(root: string, path: string, branch: string): string {
  mkdirSync(dirname(path), { recursive: true })
  git(root, "worktree", "add", "-q", "-b", branch, path, "main")
  return path
}

function trees(root: string): string[] {
  return lines(git(root, "worktree", "list", "--porcelain"))
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length))
}

/** The reason of the lock on the worktree at `path`, or undefined when it is not locked. */
function lockOf(root: string, path: string): string | undefined {
  const rows = lines(git(root, "worktree", "list", "--porcelain"))
  const at = rows.indexOf(`worktree ${path}`)
  const row = rows.slice(at + 1).find((line) => line.startsWith("locked") || line === "")
  return row === undefined || row === "" ? undefined : row.slice("locked".length).trim()
}

/** The start time of process `pid` as ps writes it, in the time zone `zone` names: Claude Code writes UTC. */
function startOf(pid: number, zone: "UTC" | "local"): string {
  const env = zone === "UTC" ? { LC_ALL: "C", TZ: "UTC" } : { LC_ALL: "C" }
  const result = spawnSync("ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8", env })
  return result.stdout.trim().replace(/\s+/g, " ")
}

/** The pid of a child that has already exited. */
function exitedPid(): number {
  const child = spawnSync(process.execPath, ["-e", ""])
  assert.ok(child.pid !== undefined)
  return child.pid
}

/** A folder holding a `git` that refuses `worktree remove`, and `worktree lock` too when asked, and runs the real one for the rest. */
function gitRefusingRemoval(alsoLock = false): string {
  const real = spawnSync("which", ["git"], { encoding: "utf8" }).stdout.trim()
  const dir = scratch("git-shim")
  const shim = join(dir, "git")
  writeFileSync(
    shim,
    `#!/bin/sh\ncase " $* " in *" worktree remove "*${alsoLock ? '|*" worktree lock "*' : ""}) echo "fatal: refused" >&2; exit 128;; esac\nexec ${real} "$@"\n`
  )
  chmodSync(shim, 0o755)
  return dir
}

function claudeLock(pid: number, start: string): string {
  return `claude session worker-1 (pid ${pid} start ${start})`
}

function lock(root: string, tree: string, reason: string): void {
  git(root, "worktree", "lock", "--reason", reason, tree)
}

describe("a worktree locked by a Claude Code session whose process is gone", () => {
  it("is unlocked and removed with its branch when no process runs under the pid", () => {
    const root = clone()
    const tree = addTree(root, join(scratch("exited"), "tree"), "topic")
    const reason = claudeLock(exitedPid(), "Sat Nov  7 20:44:18 2026")
    lock(root, tree, reason)
    const run = runBin(["sweep", "--json"], root)
    const { removed, kept } = documentOf(run.stdout)
    assert.deepEqual(
      removed.map(({ kind, name }) => [kind, name]),
      [
        ["lock", tree],
        ["worktree", tree],
        ["branch", "topic"]
      ]
    )
    assert.match(removed[0]?.reason ?? "", /pid \d+ is gone/)
    assert.deepEqual(trees(root), [root])
    assert.deepEqual(kept, [{ kind: "branch", name: "main", reason: "the default branch", command: null }])
    assert.equal(run.status, 0)
  })

  it("is unlocked and removed when a live pid started at another time", () => {
    const root = clone()
    const tree = addTree(root, join(scratch("reused"), "tree"), "topic")
    lock(root, tree, claudeLock(process.pid, "Thu Jan  1 00:00:00 2015"))
    const run = runBin(["sweep", "--json"], root)
    const { removed } = documentOf(run.stdout)
    assert.match(removed.find(({ kind }) => kind === "lock")?.reason ?? "", /another process/)
    assert.equal(existsSync(tree), false)
    assert.deepEqual(trees(root), [root])
    assert.equal(run.status, 0)
  })

  it("is named in a line, and a dry run lifts nothing", () => {
    const root = clone()
    const tree = addTree(root, join(scratch("dry"), "tree"), "topic")
    const reason = claudeLock(exitedPid(), "Sat Nov  7 20:44:18 2026")
    lock(root, tree, reason)
    const dry = runBin(["sweep", "--dry-run"], root)
    const rows = lines(dry.stdout)
    assert.match(rows[0] ?? "", new RegExp(`^would lift lock ${tree.replaceAll(".", "\\.")} — `))
    assert.match(rows[1] ?? "", /^would remove worktree /)
    assert.equal(lockOf(root, tree), reason)
    assert.deepEqual(trees(root), [root, tree])
    assert.equal(dry.status, 0)
  })
})

describe("a lock that stays", () => {
  for (const zone of ["UTC", "local"] as const) {
    it(`keeps a worktree locked by the live process the lock names, its start time in ${zone}, named by its pid`, () => {
      const root = clone()
      const tree = addTree(root, join(scratch("live"), "tree"), "topic")
      const reason = claudeLock(process.pid, startOf(process.pid, zone))
      lock(root, tree, reason)
      const run = runBin(["sweep", "--json"], root)
      const { removed, kept } = documentOf(run.stdout)
      assert.deepEqual(removed, [])
      const item = kept.find(({ kind }) => kind === "worktree")
      assert.equal(item?.name, tree)
      assert.match(item?.reason ?? "", new RegExp(`pid ${process.pid} is running`))
      assert.equal(lockOf(root, tree), reason)
      assert.deepEqual(trees(root), [root, tree])
      assert.equal(run.status, 1)
    })
  }

  it("lifts nothing for a stale lock on a dirty worktree", () => {
    const root = clone()
    const tree = addTree(root, join(scratch("dirty"), "tree"), "topic")
    const reason = claudeLock(exitedPid(), "Sat Nov  7 20:44:18 2026")
    lock(root, tree, reason)
    write(join(tree, "new.txt"), "new\n")
    const run = runBin(["sweep", "--json"], root)
    const { removed, kept } = documentOf(run.stdout)
    assert.deepEqual(removed, [])
    const item = kept.find(({ kind }) => kind === "worktree")
    assert.match(item?.reason ?? "", /new\.txt/)
    assert.equal(item?.command, `git worktree remove --force --force ${tree}`)
    assert.equal(lockOf(root, tree), reason)
    assert.deepEqual(trees(root), [root, tree])
    assert.equal(run.status, 1)
  })

  it("keeps a lock with another reason, with git worktree unlock as the dev's command", () => {
    const root = clone()
    const tree = addTree(root, join(scratch("other"), "tree"), "topic")
    lock(root, tree, "on a USB stick")
    const run = runBin(["sweep", "--json"], root)
    const { removed, kept } = documentOf(run.stdout)
    assert.deepEqual(removed, [])
    const item = kept.find(({ kind }) => kind === "worktree")
    assert.match(item?.reason ?? "", /on a USB stick/)
    assert.equal(item?.command, `git worktree unlock ${tree}`)
    assert.equal(lockOf(root, tree), "on a USB stick")
    assert.equal(run.status, 1)
  })

  it("keeps a lock that only looks like Claude Code's, its pid not a number", () => {
    const root = clone()
    const tree = addTree(root, join(scratch("looks"), "tree"), "topic")
    lock(root, tree, "claude session x (pid 12abc start Sat Nov  7 20:44:18 2026)")
    const run = runBin(["sweep", "--json"], root)
    const item = documentOf(run.stdout).kept.find(({ kind }) => kind === "worktree")
    assert.equal(item?.command, `git worktree unlock ${tree}`)
    assert.deepEqual(trees(root), [root, tree])
  })

  it("keeps a stale lock whose worktree git refuses to remove, locked again with its reason", () => {
    const root = clone()
    const tree = addTree(root, join(scratch("refused"), "tree"), "topic")
    const reason = claudeLock(exitedPid(), "Sat Nov  7 20:44:18 2026")
    lock(root, tree, reason)
    const run = runBin(["sweep", "--json"], root, { PATH: `${gitRefusingRemoval()}:${process.env.PATH}` })
    const { removed, kept } = documentOf(run.stdout)
    assert.deepEqual(removed, [])
    const item = kept.find(({ kind }) => kind === "worktree")
    assert.equal(item?.name, tree)
    assert.match(item?.reason ?? "", /refused/)
    assert.equal(lockOf(root, tree), reason)
    assert.deepEqual(trees(root), [root, tree])
    assert.equal(run.status, 1)
  })

  it("says so when the lock of a worktree git refused cannot be put back", () => {
    const root = clone()
    const tree = addTree(root, join(scratch("lost"), "tree"), "topic")
    lock(root, tree, claudeLock(exitedPid(), "Sat Nov  7 20:44:18 2026"))
    const run = runBin(["sweep", "--json"], root, { PATH: `${gitRefusingRemoval(true)}:${process.env.PATH}` })
    const item = documentOf(run.stdout).kept.find(({ kind }) => kind === "worktree")
    assert.match(item?.reason ?? "", /its lock could not be put back/)
    assert.equal(run.status, 1)
  })

  it("keeps a worktree whose folder is gone and whose lock is stale, naming the unlock and the prune", () => {
    const root = clone()
    const tree = addTree(root, join(scratch("gone"), "tree"), "topic")
    lock(root, tree, claudeLock(exitedPid(), "Sat Nov  7 20:44:18 2026"))
    rmSync(tree, { recursive: true })
    const run = runBin(["sweep", "--json"], root)
    const item = documentOf(run.stdout).kept.find(({ kind }) => kind === "worktree")
    assert.equal(item?.reason, "its folder is gone")
    assert.equal(item?.command, `git worktree unlock ${tree} && git worktree prune`)
    assert.ok(lockOf(root, tree) !== undefined)
  })
})
