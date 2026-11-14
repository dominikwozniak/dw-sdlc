// The herdr module at its interface, called in this process with the fake `hc` first on PATH: each reply
// parsed once into a typed value, a read that fails stopping the command with hc's words, an action
// answering hc's refusal.

import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { CannotRun } from "../src/cannot-run.ts"
import {
  listTerminals,
  readTerminal,
  removeTerminal,
  sendTo,
  startTerminal,
  stopTerminal,
  workingFolders
} from "../src/worker/herdr.ts"
import { scratch } from "./harness.ts"
import { fakeHerdr, inHerdr, listing, type Table, terminal } from "./hc-harness.ts"

/** `body` against a fake `hc` answering from `table`, with every call it made. */
function withHc<T>(table: Table, body: () => T): { value: T; calls: string[][] } {
  const herdr = fakeHerdr({ hc: table })
  return { value: inHerdr(herdr, body), calls: herdr.hcCalls() }
}

/** A CannotRun with `message`, and `remedy` when given. */
function cannotRun(message: string, remedy?: string): (error: unknown) => boolean {
  return (error) => {
    assert.ok(error instanceof CannotRun, String(error))
    assert.equal(error.message, message)
    if (remedy !== undefined) {
      assert.equal(error.remedy, remedy)
    }
    return true
  }
}

describe("listTerminals", () => {
  it("parses each terminal hc ls lists: a name falls back to the address, a status shows once it reports", () => {
    const { value, calls } = withHc(
      {
        ls: listing(
          { address: "t4", name: "worker-4", parent: "t1", status: "working", where: "repo / tab 2" },
          { address: "t5", state: "finished", cwd: "/work/other" }
        )
      },
      () => listTerminals({ all: true, label: "role=worker" })
    )
    assert.deepEqual(calls, [["ls", "--json", "--all", "--label", "role=worker"]])
    assert.deepEqual(value, [
      {
        address: "t4",
        name: "worker-4",
        parent: "t1",
        state: "live",
        status: "working",
        folder: "/work/repo",
        place: "repo / tab 2"
      },
      {
        address: "t5",
        name: "t5",
        parent: undefined,
        state: "finished",
        status: undefined,
        folder: "/work/other",
        place: undefined
      }
    ])
  })

  it("stops the command with hc's words, or names the shape it cannot read", () => {
    const failing = { exit: 1, stderr: "hc: the core is not running\n" }
    assert.throws(
      () => withHc({ ls: failing }, () => listTerminals()),
      cannotRun("hc ls failed: hc: the core is not running")
    )
    const shapes: [string, string][] = [
      ["not json", "hc ls answered something that is no JSON object"],
      ['{"terminals": 3}', "hc ls answered no list of terminals"],
      [
        '{"terminals": [{"address": "t4", "state": "live"}]}',
        "hc ls answered a terminal without an address, state or folder"
      ]
    ]
    for (const [stdout, message] of shapes) {
      assert.throws(() => withHc({ ls: { stdout } }, () => listTerminals()), cannotRun(message, "check hc --version"))
    }
  })

  it("stops the command when hc is not on PATH", () => {
    const before = process.env
    process.env = { ...before, PATH: scratch("no-hc") }
    try {
      assert.throws(() => listTerminals(), cannotRun("hc is not on PATH"))
    } finally {
      process.env = before
    }
  })
})

describe("readTerminal", () => {
  it("reads the state, status, space, first message and foreground program hc get reports", () => {
    const got = terminal("t7", {
      status: "idle",
      labels: { "herdr.space": "sp1" },
      firstMessage: { sent: false, reason: "the agent was not ready" },
      foreground: "/work/repo/.claude/worktrees/w",
      pid: 4242
    })
    const { value, calls } = withHc({ get: got }, () => readTerminal("t7"))
    assert.deepEqual(calls, [["get", "t7", "--json"]])
    assert.deepEqual(value, {
      state: "live",
      status: "idle",
      space: "sp1",
      firstMessage: { sent: false, reason: "the agent was not ready" },
      folder: "/work/repo/.claude/worktrees/w",
      pid: 4242
    })
    const bare = withHc({ get: terminal("t7", { status: null }) }, () => readTerminal("t7")).value
    assert.deepEqual(bare, {
      state: "live",
      status: undefined,
      space: undefined,
      firstMessage: undefined,
      folder: undefined,
      pid: undefined
    })
  })

  it("answers a terminal herdr no longer has as gone, and stops the command on any other failure", () => {
    const gone = withHc({ get: { exit: 3, stderr: "hc: no terminal t8\n" } }, () => readTerminal("t8")).value
    assert.deepEqual(gone, { gone: "hc get t8 failed: hc: no terminal t8" })
    assert.throws(
      () => withHc({ get: { exit: 1, stderr: "hc: the core went away\n" } }, () => readTerminal("t8")),
      cannotRun("hc get t8 failed: hc: the core went away")
    )
  })

  it("keeps the launch folder of a Worker whose working folder hc get cannot tell", () => {
    const workers = ["t4", "t5", "t6"].map((address) => ({
      name: address,
      address,
      state: "live",
      status: "working",
      folder: "/work/repo"
    }))
    const { value } = withHc(
      {
        "get t4": terminal("t4", { foreground: "/work/repo/.claude/worktrees/t4" }),
        "get t5": { exit: 1, stderr: "hc: no terminal t5\n" },
        "get t6": { stdout: "not json" }
      },
      () => workingFolders(workers)
    )
    assert.deepEqual(
      value.map(({ folder }) => folder),
      ["/work/repo/.claude/worktrees/t4", "/work/repo", "/work/repo"]
    )
  })
})

describe("the actions", () => {
  it("starts a terminal with its labels in order and answers the address hc gives it", () => {
    const start = {
      name: "w9",
      labels: { role: "worker", "herdr.space": "sp1" },
      cwd: "/work/repo",
      argv: ["claude", "hi"]
    }
    const { value, calls } = withHc({ run: { stdout: '{"address": "t9"}' } }, () => startTerminal(start))
    assert.equal(value, "t9")
    const named = ["--name", "w9", "--label", "role=worker", "--label", "herdr.space=sp1"]
    const rest = ["--outlive-parent", "--cwd", "/work/repo", "--", "claude", "hi"]
    assert.deepEqual(calls, [["run", "--bg", "--json", ...named, ...rest]])
    assert.throws(
      () => withHc({ run: { stdout: "{}" } }, () => startTerminal(start)),
      cannotRun("hc run answered no address for the terminal it started")
    )
  })

  it("takes a terminal that finished before its stop as stopped, and one already gone as removed", () => {
    const answers = withHc(
      {
        kill: [{ exit: 11 }, { exit: 1, stderr: "hc: cannot kill\n" }],
        rm: [{ exit: 3 }, { exit: 1, stderr: "hc: busy\n" }]
      },
      () => [stopTerminal("t5"), stopTerminal("t5"), removeTerminal("t5"), removeTerminal("t5")]
    ).value
    assert.deepEqual(answers, [undefined, "hc kill t5 failed: hc: cannot kill", undefined, "hc rm t5 failed: hc: busy"])
  })

  it("sends a message, answers blocked while the target sits on a dialog, and names any other refusal", () => {
    const answers = withHc(
      { send: [{}, { exit: 9, stderr: "hc: t2 is blocked\n" }, { exit: 1, stderr: "hc: no terminal t2\n" }] },
      () => [sendTo("t2", "hi"), sendTo("t2", "hi"), sendTo("t2", "hi")]
    ).value
    assert.deepEqual(answers, ["sent", "blocked", { refused: "hc send failed: hc: no terminal t2" }])
  })
})
