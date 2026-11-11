// `dw-sdlc lead start` spawned with a fake hc and herdr-app first on PATH: the exact `hc run` call built from
// the config, without what makes a session unsafe or isolated, the tab rename, the read-back of the first
// message, and the refusals outside herdr and in a linked worktree.

import assert from "node:assert/strict"
import { join } from "node:path"
import { describe, it } from "node:test"

import { LOCAL_FILE } from "../../src/agentic-config.ts"
import { commit, git, repo, runBin, scratch, write } from "../harness.ts"
import { fakeHerdr, layout, type Scenario, type Table, terminal } from "../hc-harness.ts"

const CALLER = "t1"
const SPACE = "sp73c299c33da8b7774dfa6d430511aee5"
const NAME = "lead-326-unreadable-payload"
const PROMPT = "/sdlc-delegate #326"

/** A caller in a herdr space, a free `hc run` that answers `t7`, and a Lead that took its first message. */
function scenario(got: Parameters<typeof terminal>[1] = {}): { hc: Table; "herdr-app": Table } {
  return {
    hc: {
      [`get ${CALLER}`]: terminal(CALLER, { labels: { "herdr.space": SPACE, "herdr.tab": "tb1" } }),
      run: terminal("t7", { name: NAME, parent: CALLER }),
      "get t7": terminal("t7", { name: NAME, parent: CALLER, ...got })
    },
    "herdr-app": { ls: layout({ tb9: ["t7"] }), "do tab.rename": { stdout: "{}" } }
  }
}

/** `dw-sdlc lead start <args>` from `root`, a repository holding `files` unless given. */
function start(args: string[], scene: Scenario, over: { files?: object; root?: string; env?: NodeJS.ProcessEnv } = {}) {
  const herdr = fakeHerdr(scene, CALLER)
  const root = over.root ?? repo({ files: { ...over.files } })
  const run = runBin(["lead", "start", ...args], root, { ...herdr.env, ...over.env })
  return { ...run, root, hc: herdr.hcCalls(), app: herdr.appCalls() }
}

const FLAGS = ["--name", NAME, "--prompt", PROMPT]

/** The `hc run` call a start makes, `command` the program before the first message. */
function runCall(root: string, command: string[] = ["claude"], space = true): string[] {
  return [
    "run",
    "--bg",
    "--json",
    "--name",
    NAME,
    "--label",
    "role=lead",
    ...(space ? ["--label", `herdr.space=${SPACE}`] : []),
    "--outlive-parent",
    "--cwd",
    root,
    "--",
    ...command,
    PROMPT
  ]
}

describe("dw-sdlc lead start", () => {
  it("starts the Lead in the caller's space, outliving it, in the main checkout, names its tab and reads the delivery back", () => {
    const run = start(FLAGS, scenario())
    assert.equal(run.status, 0, run.stderr)
    assert.deepEqual(run.hc, [["get", CALLER, "--json"], runCall(run.root), ["get", "t7", "--json"]])
    assert.deepEqual(run.app, [["ls"], ["do", "tab.rename", "--id", "tb9", "--name", NAME]])
    assert.equal(run.stdout, `started ${NAME} (t7) in ${run.root}\n`)
    assert.equal(run.stderr, "")
  })

  it("takes worker.command without --dangerously-skip-permissions and without any --worktree", () => {
    const command = "cswap run priv -- --dangerously-skip-permissions --worktree --model opus -w spare --worktree=x"
    const run = start(FLAGS, scenario(), { files: { [LOCAL_FILE]: { worker: { command } } } })
    assert.equal(run.status, 0, run.stderr)
    assert.deepEqual(run.hc[1], runCall(run.root, ["cswap", "run", "priv", "--", "--model", "opus"]))
  })

  it("prints what it started as JSON on request", () => {
    const run = start([...FLAGS, "--json"], scenario())
    assert.equal(run.status, 0, run.stderr)
    assert.deepEqual(JSON.parse(run.stdout), {
      name: NAME,
      address: "t7",
      command: "claude",
      cwd: run.root,
      delivered: true,
      tab: "renamed"
    })
  })

  it("leaves the label and the tab alone when the caller sits in no herdr space", () => {
    const scene = scenario()
    scene.hc[`get ${CALLER}`] = terminal(CALLER)
    const run = start(FLAGS, scene)
    assert.equal(run.status, 0, run.stderr)
    assert.deepEqual(run.hc[1], runCall(run.root, ["claude"], false))
    assert.deepEqual(run.app, [])
  })

  it("exits 1, never sending the first message again, when the Lead did not take it", () => {
    const run = start(FLAGS, scenario({ firstMessage: { sent: false, reason: "the agent was not ready" } }))
    assert.equal(run.status, 1)
    assert.match(run.stderr, /t7\) started but its first message was not delivered: the agent was not ready/)
    assert.match(run.stderr, /hc read t7/)
    assert.equal(run.hc.filter((call) => call[0] === "run").length, 1)
    assert.equal(run.hc.filter((call) => call[0] === "send").length, 0)
  })

  it("refuses outside herdr before it calls hc", () => {
    const run = start(FLAGS, scenario(), { env: { HC_TERMINAL_ID: "" } })
    assert.equal(run.status, 2)
    assert.match(run.stderr, /outside herdr/)
    assert.deepEqual(run.hc, [])
  })

  it("refuses in a linked worktree before it calls hc", () => {
    const main = repo()
    write(join(main, "README.md"), "x\n")
    git(main, "add", "README.md")
    commit(main, "-m", "init")
    const linked = join(scratch("linked"), "wt")
    git(main, "worktree", "add", "-q", linked, "-b", "feature")
    const run = start(FLAGS, scenario(), { root: linked })
    assert.equal(run.status, 2)
    assert.match(run.stderr, /in a linked worktree/)
    assert.match(run.stderr, new RegExp(`from the main checkout, ${main}`))
    assert.deepEqual(run.hc, [])
  })

  it("refuses a bad name or a missing first message before it calls hc", () => {
    const refusals: [string[], RegExp][] = [
      [["--name", "Bad Name", "--prompt", PROMPT], /--name takes 1-32 of a-z, 0-9, - and _/],
      [["--name", "a".repeat(33), "--prompt", PROMPT], /--name takes/],
      [["--name", NAME], /--prompt/],
      [["--name", NAME, "--prompt", "  "], /--prompt/]
    ]
    for (const [args, message] of refusals) {
      const run = start(args, scenario())
      assert.equal(run.status, 2, args.join(" "))
      assert.match(run.stderr, message)
      assert.deepEqual(run.hc, [], args.join(" "))
    }
  })
})
