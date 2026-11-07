// `dw-sdlc worker ls` spawned with a fake hc first on PATH: the calling Lead's Workers, whatever state
// herdr holds them in, as lines or as JSON.

import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { repo, runBin } from "../harness.ts"
import { fakeHerdr, listing, type Listed, type Table, terminal } from "../hc-harness.ts"

const LEAD = "t1"
/** A Worker of another Lead. */
const THEIRS: Listed = { address: "t9", name: "worker-14-theirs", parent: "t0", status: "working", cwd: "/work/repo" }
const WORKERS: Listed[] = [
  { address: "t4", name: "worker-9-demo", parent: LEAD, status: "working", cwd: "/work/repo" },
  { address: "t5", name: "worker-10-other", parent: LEAD, status: "blocked", cwd: "/work/repo" },
  { address: "t6", name: "worker-11-done", parent: LEAD, status: "done", cwd: "/work/repo" },
  { address: "t7", name: "worker-12-gone", parent: LEAD, state: "finished", cwd: "/work/repo" },
  { address: "t8", name: "worker-13-quiet", parent: LEAD, cwd: "/work/repo" },
  THEIRS
]

const TREE = "/work/repo/.claude/worktrees"
/** What `hc get` answers for each live Worker: the folder its session works in, or none it can tell. */
const GOT: Table = {
  "get t4": terminal("t4", { foreground: `${TREE}/worker-9-demo` }),
  "get t5": terminal("t5", { foreground: `${TREE}/worker-10-other` }),
  "get t6": terminal("t6"),
  "get t8": { exit: 1, stderr: "hc: no terminal t8\n" }
}

function ls(args: string[], terminals: Listed[] = WORKERS, env: NodeJS.ProcessEnv = {}) {
  const herdr = fakeHerdr({ hc: { ls: listing(...terminals), ...GOT } }, LEAD)
  const run = runBin(["worker", "ls", ...args], repo(), { ...herdr.env, ...env })
  return { ...run, hc: herdr.hcCalls() }
}

describe("dw-sdlc worker ls", () => {
  it("lists the calling Lead's Workers, finished ones included, and no one else's", () => {
    const run = ls([])
    assert.equal(run.status, 0, run.stderr)
    assert.deepEqual(run.hc, [
      ["ls", "--json", "--all", "--label", "role=worker"],
      ...["t4", "t5", "t6", "t8"].map((address) => ["get", address, "--json"])
    ])
    assert.equal(
      run.stdout,
      [
        "NAME             ADDRESS  STATE     STATUS    FOLDER",
        `worker-9-demo    t4       live      working   ${TREE}/worker-9-demo`,
        `worker-10-other  t5       live      blocked   ${TREE}/worker-10-other`,
        "worker-11-done   t6       live      done      /work/repo",
        "worker-12-gone   t7       finished  finished  /work/repo",
        "worker-13-quiet  t8       live      unknown   /work/repo",
        ""
      ].join("\n")
    )
  })

  it("prints the same as JSON on request: the folder a live Worker works in, else the one it was launched in", () => {
    const run = ls(["--json"])
    assert.equal(run.status, 0, run.stderr)
    assert.deepEqual(JSON.parse(run.stdout), [
      { name: "worker-9-demo", address: "t4", state: "live", status: "working", folder: `${TREE}/worker-9-demo` },
      { name: "worker-10-other", address: "t5", state: "live", status: "blocked", folder: `${TREE}/worker-10-other` },
      { name: "worker-11-done", address: "t6", state: "live", status: "done", folder: "/work/repo" },
      { name: "worker-12-gone", address: "t7", state: "finished", status: "finished", folder: "/work/repo" },
      { name: "worker-13-quiet", address: "t8", state: "live", status: "unknown", folder: "/work/repo" }
    ])
  })

  it("says so when the Lead has no Workers", () => {
    const text = ls([], [THEIRS])
    assert.equal(text.status, 0, text.stderr)
    assert.equal(text.stdout, "no Workers\n")
    assert.deepEqual(JSON.parse(ls(["--json"], []).stdout), [])
  })

  it("refuses outside herdr and when hc fails", () => {
    const outside = ls([], WORKERS, { HC_TERMINAL_ID: "" })
    assert.equal(outside.status, 2)
    assert.match(outside.stderr, /outside herdr/)
    assert.deepEqual(outside.hc, [])

    const herdr = fakeHerdr({ hc: { ls: { exit: 1, stderr: "hc: the core is not running\n" } } }, LEAD)
    const failed = runBin(["worker", "ls"], repo(), herdr.env)
    assert.equal(failed.status, 2)
    assert.match(failed.stderr, /hc ls failed: hc: the core is not running/)
  })
})
