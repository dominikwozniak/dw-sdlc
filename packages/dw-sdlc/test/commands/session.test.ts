// `dw-sdlc session name` and `session ls` spawned with a fake hc and herdr-app first on PATH: the exact label
// and tab calls on the calling terminal and no other, every live session with its role, and the refusals
// outside herdr and on a bad name or role.

import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { repo, runBin } from "../harness.ts"
import { fakeHerdr, layout, type Listed, listing, type Scenario } from "../hc-harness.ts"

const CALLER = "t1"

function name(args: string[], scene: Scenario, env: NodeJS.ProcessEnv = {}) {
  const herdr = fakeHerdr(scene, CALLER)
  const run = runBin(["session", "name", ...args], repo(), { ...herdr.env, ...env })
  return { ...run, hc: herdr.hcCalls(), app: herdr.appCalls() }
}

const NAMED: Scenario = {
  hc: { label: { stdout: "{}" } },
  "herdr-app": { ls: layout({ tb2: [CALLER, "t9"] }), "do tab.rename": { stdout: "{}" } }
}

describe("dw-sdlc session name", () => {
  it("labels the calling terminal and renames its tab, touching no other", () => {
    const run = name(["lead-489-helper", "--role", "lead"], NAMED)
    assert.equal(run.status, 0, run.stderr)
    assert.deepEqual(run.hc, [["label", CALLER, "role=lead", "name=lead-489-helper"]])
    assert.deepEqual(run.app, [["ls"], ["do", "tab.rename", "--id", "tb2", "--name", "lead-489-helper"]])
    assert.equal(run.stdout, `named ${CALLER} lead-489-helper (role=lead)\n`)
    assert.equal(run.stderr, "")
  })

  it("names a Worker the dev started by hand", () => {
    const run = name(["worker-12-fix", "--role", "worker"], NAMED)
    assert.equal(run.status, 0, run.stderr)
    assert.deepEqual(run.hc, [["label", CALLER, "role=worker", "name=worker-12-fix"]])
  })

  it("keeps the label and says so when the tab cannot be renamed", () => {
    const run = name(["lead-x", "--role", "lead"], {
      hc: { label: { stdout: "{}" } },
      "herdr-app": { ls: layout({ tb2: [CALLER] }), "do tab.rename": { exit: 1, stdout: '{"error":"no such tab"}' } }
    })
    assert.equal(run.status, 0, run.stderr)
    assert.match(run.stderr, /could not rename the tab of t1: no such tab/)
  })

  it("stops when hc refuses the label, before it touches the tab", () => {
    const run = name(["lead-x", "--role", "lead"], {
      hc: { label: { exit: 1, stderr: "hc: no terminal t1\n" } },
      "herdr-app": {}
    })
    assert.equal(run.status, 2)
    assert.match(run.stderr, /hc label t1 failed/)
    assert.deepEqual(run.app, [])
  })

  it("refuses outside herdr, and a bad name or role, before any call", () => {
    const outside = name(["lead-x", "--role", "lead"], {}, { HC_TERMINAL_ID: "" })
    assert.equal(outside.status, 2)
    assert.match(outside.stderr, /outside herdr/)
    for (const args of [["--role", "lead"], ["Bad Name", "--role", "lead"], ["lead-x"], ["lead-x", "--role", "boss"]]) {
      const run = name(args, NAMED)
      assert.equal(run.status, 2, args.join(" "))
      assert.deepEqual(run.hc, [], args.join(" "))
    }
  })
})

const LEAD: Listed = {
  address: "t1",
  name: "lead-9-demo",
  cwd: "/work/repo",
  status: "done",
  where: "repo / lead-9-demo"
}
const WORKER: Listed = {
  address: "t4",
  name: "worker-9-a",
  parent: "t1",
  cwd: "/work/repo/.claude/worktrees/a",
  status: "working"
}
const PLAIN: Listed = { address: "t5", cwd: "/work/other", where: "other / 2" }

/** `session ls` with the calls in order answered: the Leads, the Workers, then every live terminal. */
function ls(args: string[] = []) {
  const herdr = fakeHerdr({ hc: { ls: [listing(LEAD), listing(WORKER), listing(LEAD, WORKER, PLAIN)] } }, CALLER)
  return { ...runBin(["session", "ls", ...args], repo(), herdr.env), hc: herdr.hcCalls() }
}

describe("dw-sdlc session ls", () => {
  it("lists every live session with its role, name, status and folder", () => {
    const run = ls()
    assert.equal(run.status, 0, run.stderr)
    assert.deepEqual(run.hc, [
      ["ls", "--json", "--label", "role=lead"],
      ["ls", "--json", "--label", "role=worker"],
      ["ls", "--json"]
    ])
    assert.equal(
      run.stdout,
      [
        "ROLE    NAME         ADDRESS  STATUS   FOLDER",
        "lead    lead-9-demo  t1       done     /work/repo",
        "worker  worker-9-a   t4       working  /work/repo/.claude/worktrees/a",
        "-       2            t5       unknown  /work/other",
        ""
      ].join("\n")
    )
  })

  it("prints the same as JSON on request", () => {
    const run = ls(["--json"])
    assert.equal(run.status, 0, run.stderr)
    assert.deepEqual(JSON.parse(run.stdout)[1], {
      role: "worker",
      name: "worker-9-a",
      address: "t4",
      status: "working",
      folder: "/work/repo/.claude/worktrees/a"
    })
  })
})

describe("the session commands' usage", () => {
  it("lists them in the bin's usage and prints each one's options outside herdr", () => {
    const usage = runBin(["--help"], repo(), { HC_TERMINAL_ID: "" })
    assert.match(usage.stdout, /^ {2}session name {6}name this session as a Lead or a Worker in herdr$/m)
    assert.match(usage.stdout, /^ {2}session ls {8}list every live herdr session with its role and name$/m)
    for (const command of ["name", "ls"]) {
      const run = runBin(["session", command, "--help"], repo(), { HC_TERMINAL_ID: "" })
      assert.equal(run.status, 0, `${command}: ${run.stderr}`)
      assert.match(run.stdout, new RegExp(`^Usage: dw-sdlc session ${command}`))
    }
  })
})
