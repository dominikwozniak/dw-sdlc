// `dw-sdlc sweep` and herdr's terminals, on throwaway clones with the fake `hc` first on PATH: the `hc` calls
// made, what is left, the output and the exit code. Never on this repository or the real `hc`.

import assert from "node:assert/strict"
import { existsSync, mkdirSync, rmSync } from "node:fs"
import { dirname, join } from "node:path"
import { describe, it } from "node:test"

import { buildLandedRepo } from "../../../../plugins/sdlc/test/landed-scenarios.ts"
import { git, lines, runBin, scratch, write } from "../harness.ts"
import { fakeHerdr, type Listed, listing, type Reply, terminal } from "../hc-harness.ts"

type Item = { kind: string; name: string; reason: string; command?: string | null }
type Document = { dryRun: boolean; terminalsRead: boolean; base: string; removed: Item[]; kept: Item[] }

/** The sweeping session's terminal. */
const SELF = "t1"

function clone(): string {
  const dir = scratch("sweep-terminals")
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

function branches(root: string): string[] {
  return lines(git(root, "for-each-ref", "--format=%(refname:short)", "refs/heads"))
}

/** A Worker of the sweeping session in `cwd`, its status the word given, `unknown` when it never reported. */
function worker(address: string, cwd: string, status?: string, state: Listed["state"] = "live"): Listed {
  return { address, name: `worker-${address}`, parent: SELF, cwd, state, ...(status === undefined ? {} : { status }) }
}

type Herdr = { terminals: Listed[]; kill?: Reply | Reply[]; rm?: Reply; ls?: Reply[]; get?: Reply }

/** An `hc get` that reports a live terminal with no foreground folder, so the launch folder stands. */
const GOT: Reply = { stdout: JSON.stringify({ address: "t0", state: "live" }) }

/** Spawns the Sweep with the fake `hc` listing the terminals, the live ones answering the second `hc ls`. */
function sweep(root: string, args: string[], { terminals, kill = {}, rm = {}, ls, get = GOT }: Herdr) {
  const live = terminals.filter(({ state }) => state !== "finished")
  const herdr = fakeHerdr({ hc: { "ls --json": ls ?? [listing(...terminals), listing(...live)], get, kill, rm } }, SELF)
  const run = runBin(["sweep", ...args], root, herdr.env)
  const hc = herdr.hcCalls().filter(([verb]) => verb === "kill" || verb === "rm")
  return { run, hc, herdr }
}

function documentOf(stdout: string): Document {
  return JSON.parse(stdout) as Document
}

/** The own terminal of the sweeping session, in the main checkout. */
function self(root: string): Listed {
  return { address: SELF, name: "lead", cwd: root, status: "working" }
}

describe("a Worker done in a worktree that goes", () => {
  it("is stopped and then removed, and the worktree and its branch go", () => {
    const root = clone()
    const tree = addTree(root, join(scratch("done"), "tree"), "topic")
    const { run, hc } = sweep(root, ["--json"], { terminals: [self(root), worker("t5", tree, "done")] })
    assert.equal(run.status, 0, run.stderr)
    assert.deepEqual(hc, [
      ["kill", "t5"],
      ["rm", "t5"]
    ])
    const { removed, terminalsRead } = documentOf(run.stdout)
    assert.equal(terminalsRead, true)
    assert.deepEqual(
      removed.map(({ kind, name }) => [kind, name]),
      [
        ["terminal", "t5"],
        ["worktree", tree],
        ["branch", "topic"]
      ]
    )
    assert.deepEqual(trees(root), [root])
    assert.deepEqual(branches(root), ["main"])
  })

  it("is the same for an idle Worker or one in error, and each of two Workers in the worktree", () => {
    const root = clone()
    const tree = addTree(root, join(scratch("two"), "tree"), "topic")
    const { hc } = sweep(root, [], { terminals: [self(root), worker("t5", tree, "idle"), worker("t6", tree, "error")] })
    assert.deepEqual(hc, [
      ["kill", "t5"],
      ["rm", "t5"],
      ["kill", "t6"],
      ["rm", "t6"]
    ])
    assert.deepEqual(trees(root), [root])
  })

  it("is read by the folder it works in, which hc get reports beside the launch folder", () => {
    const root = clone()
    const tree = addTree(root, join(scratch("foreground"), "tree"), "topic")
    const herdr = fakeHerdr(
      {
        hc: {
          "ls --json": [
            listing(self(root), worker("t5", root, "done")),
            listing(self(root), worker("t5", root, "done"))
          ],
          get: GOT,
          "get t5": terminal("t5", { status: "done", foreground: tree }),
          kill: {},
          rm: {}
        }
      },
      SELF
    )
    runBin(["sweep"], root, herdr.env)
    assert.deepEqual(
      herdr.hcCalls().filter(([verb]) => verb === "kill" || verb === "rm"),
      [
        ["kill", "t5"],
        ["rm", "t5"]
      ]
    )
    assert.deepEqual(trees(root), [root])
  })
})

describe("a Worker that is not done", () => {
  for (const status of ["working", "blocked", undefined]) {
    it(`is kept with its worktree and branch when it is ${status ?? "unknown"}, with no call that stops it`, () => {
      const root = clone()
      const tree = addTree(root, join(scratch("busy"), "tree"), "topic")
      const { run, hc } = sweep(root, ["--json"], { terminals: [self(root), worker("t5", tree, status)] })
      assert.deepEqual(hc, [])
      const { removed, kept } = documentOf(run.stdout)
      assert.deepEqual(removed, [])
      assert.match(kept.find(({ kind }) => kind === "worktree")?.reason ?? "", /Worker worker-t5 \(t5\) is /)
      assert.match(kept.find(({ kind }) => kind === "terminal")?.reason ?? "", /Worker worker-t5 is /)
      assert.deepEqual(trees(root), [root, tree])
      assert.ok(branches(root).includes("topic"))
      assert.equal(run.status, 1)
    })
  }

  it("is kept when its folder is gone too", () => {
    const root = clone()
    const gone = join(scratch("busy-gone"), "tree")
    const { run, hc } = sweep(root, ["--json"], { terminals: [self(root), worker("t5", gone, "working")] })
    assert.deepEqual(hc, [])
    assert.equal(documentOf(run.stdout).kept.find(({ kind }) => kind === "terminal")?.name, "t5")
    assert.equal(run.status, 1)
  })
})

describe("a Worker done beside a worktree that stays", () => {
  it("is kept and not stopped when the worktree holds a modified file", () => {
    const root = clone()
    const tree = addTree(root, join(scratch("dirty"), "tree"), "dirty")
    write(join(tree, "README.md"), "changed\n")
    const { run, hc } = sweep(root, ["--json"], { terminals: [self(root), worker("t5", tree, "done")] })
    assert.deepEqual(hc, [])
    const { removed, kept } = documentOf(run.stdout)
    assert.deepEqual(removed, [])
    assert.match(kept.find(({ kind }) => kind === "worktree")?.reason ?? "", /README\.md/)
    assert.match(kept.find(({ kind }) => kind === "terminal")?.reason ?? "", /its worktree stays/)
    assert.deepEqual(trees(root), [root, tree])
    assert.equal(run.status, 1)
  })

  it("is kept when another session's terminal is in the worktree too", () => {
    const root = clone()
    const tree = addTree(root, join(scratch("shared"), "tree"), "topic")
    const other: Listed = { address: "t9", name: "dev", cwd: tree, status: "done" }
    const { hc } = sweep(root, [], { terminals: [self(root), worker("t5", tree, "done"), other] })
    assert.deepEqual(hc, [])
    assert.deepEqual(trees(root), [root, tree])
  })
})

describe("a Worker whose worktree is already gone", () => {
  it("is stopped and removed under the same status rule when git has pruned the worktree", () => {
    const root = clone()
    const gone = join(scratch("pruned"), "tree")
    const { run, hc } = sweep(root, ["--json"], { terminals: [self(root), worker("t5", gone, "done")] })
    assert.deepEqual(hc, [
      ["kill", "t5"],
      ["rm", "t5"]
    ])
    assert.deepEqual(
      documentOf(run.stdout).removed.map(({ kind, name }) => [kind, name]),
      [["terminal", "t5"]]
    )
  })

  it("is stopped and removed when git still lists the worktree, whose folder is gone", () => {
    const root = clone()
    const tree = addTree(root, join(scratch("listed"), "tree"), "topic")
    rmSync(tree, { recursive: true })
    const { run, hc } = sweep(root, ["--json"], { terminals: [self(root), worker("t5", tree, "idle")] })
    assert.deepEqual(hc, [
      ["kill", "t5"],
      ["rm", "t5"]
    ])
    assert.ok(
      documentOf(run.stdout).kept.some(({ kind, reason }) => kind === "worktree" && /folder is gone/.test(reason))
    )
  })
})

describe("a Worker in a folder that is gone inside a worktree that stays", () => {
  it("is kept and not stopped, since its worktree is not gone", () => {
    const root = clone()
    const tree = addTree(root, join(scratch("subfolder"), "tree"), "dirty")
    write(join(tree, "README.md"), "changed\n")
    const { run, hc } = sweep(root, [], { terminals: [self(root), worker("t5", join(tree, "deleted"), "done")] })
    assert.deepEqual(hc, [])
    assert.equal(run.status, 1)
    assert.deepEqual(trees(root), [root, tree])
  })
})

describe("a finished Worker of the sweeping session", () => {
  it("is removed and not stopped", () => {
    const root = clone()
    const tree = addTree(root, join(scratch("finished"), "tree"), "topic")
    const { run, hc } = sweep(root, ["--json"], {
      terminals: [self(root), worker("t5", tree, undefined, "finished")]
    })
    assert.deepEqual(hc, [["rm", "t5"]])
    assert.equal(documentOf(run.stdout).removed[0]?.name, "t5")
    assert.deepEqual(trees(root), [root])
  })

  it("is removed whatever its worktree says", () => {
    const root = clone()
    const tree = addTree(root, join(scratch("finished-dirty"), "tree"), "dirty")
    write(join(tree, "new.txt"), "x\n")
    const { hc } = sweep(root, [], { terminals: [self(root), worker("t5", tree, undefined, "finished")] })
    assert.deepEqual(hc, [["rm", "t5"]])
    assert.deepEqual(trees(root), [root, tree])
  })
})

describe("a terminal of the sweeping session or of another", () => {
  it("is never stopped when another session's terminal is done in a worktree, which stays named by the terminal's address and place", () => {
    const root = clone()
    const tree = addTree(root, join(scratch("other"), "tree"), "topic")
    const other: Listed = { address: "t9", name: "dev", cwd: tree, status: "done", where: "repo / dev-tab" }
    const { run, hc } = sweep(root, ["--json"], { terminals: [self(root), other] })
    assert.deepEqual(hc, [])
    const { removed, kept } = documentOf(run.stdout)
    assert.deepEqual(removed, [])
    const item = kept.find(({ kind }) => kind === "worktree")
    assert.equal(item?.name, tree)
    assert.match(item?.reason ?? "", /another session's terminal t9 is in it, at repo \/ dev-tab/)
    assert.equal(item?.command, "hc kill t9")
    const listed = kept.find(({ kind }) => kind === "terminal")
    assert.equal(listed?.name, "t9")
    assert.match(listed?.reason ?? "", /at repo \/ dev-tab/)
    assert.equal(listed?.command, "hc kill t9")
    assert.deepEqual(trees(root), [root, tree])
    assert.equal(run.status, 1)
  })

  it("names the folder as the place when herdr shows none", () => {
    const root = clone()
    const tree = addTree(root, join(scratch("other-folder"), "tree"), "topic")
    const { run } = sweep(root, ["--json"], { terminals: [self(root), { address: "t9", cwd: tree, status: "idle" }] })
    const item = documentOf(run.stdout).kept.find(({ kind }) => kind === "worktree")
    assert.ok(item?.reason.endsWith(`at ${tree}`), item?.reason)
  })

  it("never stops the terminal of the session that runs the Sweep, in a worktree or not", () => {
    const root = clone()
    const tree = addTree(root, join(scratch("own"), "tree"), "topic")
    const { run, hc } = sweep(root, ["--json"], { terminals: [{ ...self(root), cwd: tree, status: "done" }] })
    assert.deepEqual(hc, [])
    assert.match(
      documentOf(run.stdout).kept.find(({ kind }) => kind === "worktree")?.reason ?? "",
      /this Sweep runs in/
    )
    assert.deepEqual(trees(root), [root, tree])
  })

  it("leaves a terminal in the main checkout alone", () => {
    const root = clone()
    const tree = addTree(root, join(scratch("main"), "tree"), "topic")
    const { hc } = sweep(root, [], { terminals: [self(root), { address: "t9", cwd: root, status: "done" }] })
    assert.deepEqual(hc, [])
    assert.deepEqual(trees(root), [root])
    assert.equal(existsSync(tree), false)
  })
})

describe("outside herdr", () => {
  it("reads no terminal, makes no hc call and says so", () => {
    const root = clone()
    const tree = addTree(root, join(scratch("outside"), "tree"), "topic")
    const herdr = fakeHerdr({ hc: {} }, SELF)
    const run = runBin(["sweep"], root, { PATH: herdr.env.PATH })
    assert.deepEqual(herdr.hcCalls(), [])
    assert.equal(lines(run.stdout).at(-1), "terminals not read — outside herdr, $HC_TERMINAL_ID is not set")
    assert.deepEqual(trees(root), [root])
    assert.equal(existsSync(tree), false)
    assert.equal(run.status, 0)
  })

  it("says so in the document", () => {
    const root = clone()
    const herdr = fakeHerdr({ hc: {} }, SELF)
    const run = runBin(["sweep", "--json"], root, { PATH: herdr.env.PATH })
    assert.equal(documentOf(run.stdout).terminalsRead, false)
  })
})

describe("an hc that fails in herdr", () => {
  for (const [name, ls] of [
    ["the first listing", [{ exit: 1, stderr: "hc: core is down\n" }]],
    ["the listing of every terminal", [listing(), { exit: 1, stderr: "hc: core is down\n" }]],
    ["a reply that is no list", [{ stdout: '{"terminals": 3}' }]]
  ] as const) {
    it(`ends the Sweep with exit 2 and removes nothing: ${name}`, () => {
      const root = clone()
      const tree = addTree(root, join(scratch("failing"), "tree"), "topic")
      const { run, hc } = sweep(root, [], { terminals: [], ls: [...ls] })
      assert.equal(run.status, 2)
      assert.match(run.stderr, /^dw-sdlc sweep: /)
      assert.deepEqual(hc, [])
      assert.deepEqual(trees(root), [root, tree])
      assert.deepEqual(branches(root).toSorted(), ["main", "topic"])
    })
  }

  it("ends the Sweep with exit 2 when hc get cannot say where a terminal works", () => {
    const root = clone()
    const tree = addTree(root, join(scratch("get-fails"), "tree"), "topic")
    const { run, hc } = sweep(root, [], {
      terminals: [self(root), worker("t5", tree, "done")],
      get: { exit: 1, stderr: "hc: core is down\n" }
    })
    assert.equal(run.status, 2)
    assert.match(run.stderr, /hc get t\d failed: hc: core is down/)
    assert.deepEqual(hc, [])
    assert.deepEqual(trees(root), [root, tree])
  })

  it("goes on without a terminal that is gone since the listing", () => {
    const root = clone()
    const tree = addTree(root, join(scratch("get-gone"), "tree"), "topic")
    const { run, hc } = sweep(root, [], {
      terminals: [self(root), worker("t5", tree, "done")],
      get: { exit: 3, stderr: "hc: not found\n" }
    })
    assert.equal(run.status, 0, run.stderr)
    assert.deepEqual(hc, [])
    assert.deepEqual(trees(root), [root])
    assert.equal(existsSync(tree), false)
  })

  it("ends the Sweep with exit 2 when hc is not on PATH", () => {
    const root = clone()
    const tree = addTree(root, join(scratch("no-hc"), "tree"), "topic")
    const run = runBin(["sweep"], root, { PATH: "/usr/bin:/bin", HC_TERMINAL_ID: SELF })
    assert.equal(run.status, 2)
    assert.match(run.stderr, /hc is not on PATH/)
    assert.deepEqual(trees(root), [root, tree])
  })
})

describe("a stop that fails", () => {
  it("keeps the Worker's worktree and branch, names hc's words and goes on", () => {
    const root = clone()
    const tree = addTree(root, join(scratch("kill-fails"), "tree"), "topic")
    const fine = addTree(root, join(scratch("kill-fine"), "tree"), "fine")
    const { run, hc } = sweep(root, ["--json"], {
      terminals: [self(root), worker("t5", tree, "done"), worker("t6", fine, "done")],
      kill: [{ exit: 1, stderr: "hc: cannot kill\n" }, {}]
    })
    assert.deepEqual(hc, [
      ["kill", "t5"],
      ["kill", "t6"],
      ["rm", "t6"]
    ])
    const { removed, kept } = documentOf(run.stdout)
    assert.deepEqual(
      removed.map(({ kind, name }) => [kind, name]),
      [
        ["terminal", "t6"],
        ["worktree", fine],
        ["branch", "fine"]
      ]
    )
    const stuck = kept.find(({ kind }) => kind === "terminal")
    assert.equal(stuck?.name, "t5")
    assert.match(stuck?.reason ?? "", /hc kill t5 failed: hc: cannot kill/)
    assert.equal(stuck?.command, "hc kill t5; hc rm t5")
    assert.match(kept.find(({ kind }) => kind === "worktree")?.reason ?? "", /terminal t5 stays/)
    assert.deepEqual(trees(root), [root, tree])
    assert.ok(branches(root).includes("topic"))
    assert.equal(run.status, 1)
  })

  it("takes a terminal that finished in between for stopped", () => {
    const root = clone()
    const tree = addTree(root, join(scratch("kill-late"), "tree"), "topic")
    const { run, hc } = sweep(root, [], {
      terminals: [self(root), worker("t5", tree, "done")],
      kill: { exit: 11, stderr: "hc: finished\n" }
    })
    assert.deepEqual(hc, [
      ["kill", "t5"],
      ["rm", "t5"]
    ])
    assert.equal(run.status, 0)
    assert.deepEqual(trees(root), [root])
  })
})

describe("--dry-run", () => {
  it("stops and removes nothing, and --json lists the terminals", () => {
    const root = clone()
    const tree = addTree(root, join(scratch("dry"), "tree"), "topic")
    const busy = addTree(root, join(scratch("dry-busy"), "tree"), "busy")
    const terminals = [
      self(root),
      worker("t5", tree, "done"),
      worker("t6", busy, "working"),
      worker("t7", join(tree, "gone"), "done", "finished")
    ]
    const dry = sweep(root, ["--dry-run", "--json"], { terminals })
    assert.deepEqual(dry.hc, [])
    const first = documentOf(dry.run.stdout)
    assert.equal(first.dryRun, true)
    assert.deepEqual(
      first.removed.filter(({ kind }) => kind === "terminal").map(({ name }) => name),
      ["t7", "t5"]
    )
    assert.deepEqual(
      first.kept.filter(({ kind }) => kind === "terminal").map(({ name }) => name),
      ["t6"]
    )
    assert.deepEqual(trees(root).toSorted(), [root, tree, busy].toSorted())
    const real = sweep(root, ["--json"], { terminals })
    assert.deepEqual({ ...first, dryRun: false }, documentOf(real.run.stdout))
    assert.deepEqual(real.hc, [
      ["rm", "t7"],
      ["kill", "t5"],
      ["rm", "t5"]
    ])
  })

  it("says it would remove a terminal in a line", () => {
    const root = clone()
    const tree = addTree(root, join(scratch("dry-line"), "tree"), "topic")
    const { run } = sweep(root, ["--dry-run"], { terminals: [self(root), worker("t5", tree, "done")] })
    assert.match(
      lines(run.stdout)[0] ?? "",
      /^would remove terminal t5 — Worker worker-t5 is done: stopped, then removed/
    )
  })
})
