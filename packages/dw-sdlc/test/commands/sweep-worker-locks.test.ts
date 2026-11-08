// `dw-sdlc sweep` on a worktree that a Worker's own Claude Code session has locked, as a real done Worker's
// worktree is: the lock names the program `hc get` reports in the Worker's terminal. The fake `hc` ends that
// process on `kill`. Never on this repository or the real `hc`.

import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { after, describe, it } from "node:test"

import { buildLandedRepo } from "../../../../plugins/sdlc/test/landed-scenarios.ts"
import { git, lines, runBin, scratch } from "../harness.ts"
import { fakeHerdr, type Listed, listing, type Reply, terminal } from "../hc-harness.ts"

type Item = { kind: string; name: string; reason: string; command?: string | null }
type Document = { removed: Item[]; kept: Item[] }

const SELF = "t1"
const started: number[] = []

after(() => {
  for (const pid of started) {
    try {
      process.kill(pid, "SIGKILL")
    } catch {
      // Ended by the fake hc already.
    }
  }
})

/** A process that outlives this call, as a Worker's Claude Code session does, with its pid and `ps` start time in UTC. */
function program(): { pid: number; start: string } {
  const run = spawnSync("sh", ["-c", "sleep 300 >/dev/null 2>&1 & echo $!"], { encoding: "utf8" })
  const pid = Number(run.stdout.trim())
  assert.ok(Number.isInteger(pid) && pid > 0, run.stdout)
  started.push(pid)
  const ps = spawnSync("ps", ["-o", "lstart=", "-p", String(pid)], {
    encoding: "utf8",
    env: { LC_ALL: "C", TZ: "UTC" }
  })
  return { pid, start: ps.stdout.trim().replace(/\s+/g, " ") }
}

function clone(): string {
  const dir = scratch("sweep-worker-locks")
  return buildLandedRepo(join(dir, "clone"), join(dir, "origin.git"), [])
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

function lockTree(root: string, tree: string, pid: number, start: string): string {
  const reason = `claude session worker-1 (pid ${pid} start ${start})`
  git(root, "worktree", "lock", "--reason", reason, tree)
  return reason
}

type Setup = { status?: string; killsProgram?: boolean; workerPid: number }

/** Spawns the Sweep with Worker `t5` in `tree`, its program `workerPid`, and the fake `hc kill` ending `program`. */
function sweep(root: string, tree: string, args: string[], { status = "done", killsProgram, workerPid }: Setup) {
  const lead: Listed = { address: SELF, name: "lead", cwd: root, status: "working" }
  const worker: Listed = { address: "t5", name: "worker-t5", parent: SELF, cwd: tree, status }
  const kill: Reply = killsProgram === true ? { kill: workerPid } : {}
  const herdr = fakeHerdr(
    {
      hc: {
        "ls --json": [listing(lead, worker), listing(lead, worker)],
        "get t5": terminal("t5", { status, foreground: tree, pid: workerPid }),
        get: { stdout: JSON.stringify({ address: SELF, state: "live" }) },
        kill,
        rm: {}
      }
    },
    SELF
  )
  const run = runBin(["sweep", ...args], root, herdr.env)
  const hc = herdr.hcCalls().filter(([verb]) => verb === "kill" || verb === "rm")
  return { run, hc }
}

function documentOf(stdout: string): Document {
  return JSON.parse(stdout) as Document
}

describe("a done Worker whose own live Claude Code lock holds its worktree", () => {
  it("is stopped, then the lock that is stale now is lifted, then the worktree and its branch go", () => {
    const root = clone()
    const tree = addTree(root, join(scratch("held"), "tree"), "topic")
    const { pid, start } = program()
    lockTree(root, tree, pid, start)
    const { run, hc } = sweep(root, tree, ["--json"], { killsProgram: true, workerPid: pid })
    assert.equal(run.status, 0, run.stderr)
    assert.deepEqual(hc, [
      ["kill", "t5"],
      ["rm", "t5"]
    ])
    const { removed } = documentOf(run.stdout)
    assert.deepEqual(
      removed.map(({ kind, name }) => [kind, name]),
      [
        ["terminal", "t5"],
        ["lock", tree],
        ["worktree", tree],
        ["branch", "topic"]
      ]
    )
    assert.match(removed[1]?.reason ?? "", /pid \d+ is gone/)
    assert.deepEqual(trees(root), [root])
    assert.deepEqual(lines(git(root, "for-each-ref", "--format=%(refname:short)", "refs/heads")), ["main"])
  })

  it("is only planned in a dry run, which stops and lifts nothing", () => {
    const root = clone()
    const tree = addTree(root, join(scratch("held-dry"), "tree"), "topic")
    const { pid, start } = program()
    const reason = lockTree(root, tree, pid, start)
    const { run, hc } = sweep(root, tree, ["--dry-run", "--json"], { killsProgram: true, workerPid: pid })
    assert.deepEqual(hc, [])
    assert.deepEqual(
      documentOf(run.stdout).removed.map(({ kind }) => kind),
      ["terminal", "lock", "worktree", "branch"]
    )
    assert.deepEqual(trees(root), [root, tree])
    assert.match(
      git(root, "worktree", "list", "--porcelain"),
      new RegExp(`locked ${reason.replaceAll(/[()]/g, "\\$&")}`)
    )
  })

  it("keeps the worktree, saying so, when the lock names a program that is still running after the stop", () => {
    const root = clone()
    const tree = addTree(root, join(scratch("held-alive"), "tree"), "topic")
    const { pid, start } = program()
    lockTree(root, tree, pid, start)
    const { run, hc } = sweep(root, tree, ["--json"], { workerPid: pid })
    assert.deepEqual(hc, [
      ["kill", "t5"],
      ["rm", "t5"]
    ])
    const { removed, kept } = documentOf(run.stdout)
    assert.deepEqual(
      removed.map(({ kind }) => kind),
      ["terminal"]
    )
    assert.match(
      kept.find(({ kind }) => kind === "worktree")?.reason ?? "",
      /its Worker's terminal was stopped, but locked by a live Claude Code session/
    )
    assert.deepEqual(trees(root), [root, tree])
    assert.ok(lines(git(root, "for-each-ref", "--format=%(refname:short)", "refs/heads")).includes("topic"))
    assert.equal(run.status, 1)
  })
})

describe("a live Claude Code lock that is not the Worker's program", () => {
  it("keeps the worktree and stops nothing when the lock names another live process", () => {
    const root = clone()
    const tree = addTree(root, join(scratch("other-lock"), "tree"), "topic")
    const mine = program()
    const theirs = program()
    lockTree(root, tree, theirs.pid, theirs.start)
    const { run, hc } = sweep(root, tree, ["--json"], { killsProgram: true, workerPid: mine.pid })
    assert.deepEqual(hc, [])
    const { removed, kept } = documentOf(run.stdout)
    assert.deepEqual(removed, [])
    assert.match(kept.find(({ kind }) => kind === "worktree")?.reason ?? "", /locked by a live Claude Code session/)
    assert.deepEqual(trees(root), [root, tree])
    assert.equal(run.status, 1)
  })

  it("keeps the worktree of a Worker that is still working, though the lock names its program", () => {
    const root = clone()
    const tree = addTree(root, join(scratch("busy-lock"), "tree"), "topic")
    const { pid, start } = program()
    lockTree(root, tree, pid, start)
    const { run, hc } = sweep(root, tree, ["--json"], { status: "working", workerPid: pid })
    assert.deepEqual(hc, [])
    assert.deepEqual(documentOf(run.stdout).removed, [])
    assert.deepEqual(trees(root), [root, tree])
  })
})
