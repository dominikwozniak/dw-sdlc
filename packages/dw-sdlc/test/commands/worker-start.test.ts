// `dw-sdlc worker start` spawned with a fake hc and herdr-app first on PATH: the refusals, the exact
// `hc run` call built from the config and the flags, the tab rename, and the read-back of the delivery.

import assert from "node:assert/strict"
import { chmodSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"

import { COMMITTED_FILE, LOCAL_FILE } from "../../src/agentic-config.ts"
import { commit, git, repo, runBin, runCommand, scratch, write } from "../harness.ts"
import { fakeHerdr, layout, listing, type Listed, type Scenario, type Table, terminal } from "../hc-harness.ts"

const BRIEF = "/implement #9\n\nGoal: do the thing.\nReport: dw-sdlc worker report --to t1\n"
const LEAD = "t1"
const SPACE = "sp73c299c33da8b7774dfa6d430511aee5"
const NAME = "worker-9-demo"

type Files = Record<string, string | object>

/** A terminal the Lead started. */
const mine = (address: string, over: Partial<Listed> = {}): Listed => ({ address, parent: LEAD, ...over })

/** A Lead in a herdr space, a free `hc run` that answers `t7`, and a delivered first message. */
function scenario(
  over: { live?: Listed[]; got?: Parameters<typeof terminal>[1]; tabs?: Record<string, string[]> } = {}
): { hc: Table; "herdr-app": Table } {
  const { live = [], got = {}, tabs = { tb9: ["t7"] } } = over
  return {
    hc: {
      ls: listing(...live),
      [`get ${LEAD}`]: terminal(LEAD, { labels: { "herdr.space": SPACE, "herdr.tab": "tb1" } }),
      run: terminal("t7", { name: NAME, parent: LEAD }),
      "get t7": terminal("t7", { name: NAME, parent: LEAD, ...got })
    },
    "herdr-app": { ls: layout(tabs), "do tab.rename": { stdout: "{}" } }
  }
}

/** `dw-sdlc worker start <args>` from a repository holding `files` and a Brief, the calling terminal `t1`. */
function start(args: string[], scene: Scenario, files: Files = {}, env: NodeJS.ProcessEnv = {}) {
  const herdr = fakeHerdr(scene, LEAD)
  const root = repo({ files })
  write(join(root, "brief.md"), BRIEF)
  const run = runBin(["worker", "start", "--brief", "brief.md", "--name", NAME, ...args], root, {
    ...herdr.env,
    ...env
  })
  return { ...run, root, hc: herdr.hcCalls(), app: herdr.appCalls() }
}

/** The `hc run` call a start makes with the default command, model and effort. */
function runCall(root: string, over: { command?: string[]; model?: string; effort?: string; space?: boolean } = {}) {
  const { command = ["claude"], model = "sonnet", effort = "high", space = true } = over
  return [
    "run",
    "--bg",
    "--json",
    "--name",
    NAME,
    "--label",
    "role=worker",
    ...(space ? ["--label", `herdr.space=${SPACE}`] : []),
    "--outlive-parent",
    "--cwd",
    root,
    "--",
    ...command,
    "--worktree",
    NAME,
    "--model",
    model,
    "--effort",
    effort,
    BRIEF
  ]
}

const LISTED = ["ls", "--json", "--label", "role=worker"]

describe("dw-sdlc worker start", () => {
  it("starts the Worker on the default command, model and effort, names its tab, and reads the delivery back", () => {
    const run = start([], scenario())
    assert.equal(run.status, 0, run.stderr)
    assert.deepEqual(run.hc, [LISTED, ["get", LEAD, "--json"], runCall(run.root), ["get", "t7", "--json"]])
    assert.deepEqual(run.app, [["ls"], ["do", "tab.rename", "--id", "tb9", "--name", NAME]])
    assert.equal(run.stdout, `started ${NAME} (t7) on sonnet at high effort\n`)
    assert.equal(run.stderr, "")
  })

  it("takes the command, model and effort from the config, and a flag wins over the config", () => {
    const worker = { command: "cswap run -- --dangerously-skip-permissions", model: "opus", effort: "max" }
    const files = {
      [COMMITTED_FILE]: { worker: { model: "opus", effort: "max" } },
      [LOCAL_FILE]: { worker: { command: worker.command } }
    }
    const fromConfig = start([], scenario(), files)
    assert.equal(fromConfig.status, 0, fromConfig.stderr)
    const command = ["cswap", "run", "--", "--dangerously-skip-permissions"]
    assert.deepEqual(fromConfig.hc[2], runCall(fromConfig.root, { command, model: "opus", effort: "max" }))

    const flagged = start(["--model", "haiku", "--effort", "low"], scenario(), files)
    assert.equal(flagged.status, 0, flagged.stderr)
    assert.deepEqual(flagged.hc[2], runCall(flagged.root, { command, model: "haiku", effort: "low" }))
  })

  it("prints what it started as JSON on request", () => {
    const run = start(["--json"], scenario())
    assert.equal(run.status, 0, run.stderr)
    assert.deepEqual(JSON.parse(run.stdout), {
      name: NAME,
      address: "t7",
      command: "claude",
      model: "sonnet",
      effort: "high",
      cwd: run.root,
      delivered: true,
      tab: "renamed"
    })
  })

  it("leaves the tab alone when the Lead sits in no herdr space", () => {
    const scene = scenario()
    scene.hc[`get ${LEAD}`] = terminal(LEAD)
    const run = start([], scene)
    assert.equal(run.status, 0, run.stderr)
    assert.deepEqual(run.hc[2], runCall(run.root, { space: false }))
    assert.deepEqual(run.app, [])
  })

  it("asks herdr-app again until it lists the Worker's tab, which comes a moment after hc run", () => {
    const scene = scenario()
    scene["herdr-app"].ls = [layout({ tb2: ["t3"] }), layout({ tb2: ["t3"] }), layout({ tb2: ["t3"], tb9: ["t7"] })]
    const run = start([], scene)
    assert.equal(run.status, 0, run.stderr)
    assert.equal(run.stderr, "")
    assert.deepEqual(run.app, [["ls"], ["ls"], ["ls"], ["do", "tab.rename", "--id", "tb9", "--name", NAME]])
  })

  it("warns, and still succeeds, when the Worker's tab cannot be renamed", () => {
    // --wait bounds the search for the tab too: at 0 herdr-app is asked once.
    const lost = start(["--wait", "0"], scenario({ tabs: { tb2: ["t3"] } }))
    assert.equal(lost.status, 0, lost.stderr)
    assert.match(lost.stderr, /warning: the tab of t7 is not in herdr-app ls within 0 s/)
    assert.deepEqual(lost.app, [["ls"]])

    const refused = scenario()
    refused["herdr-app"]["do tab.rename"] = { exit: 1, stdout: '{"error":"no such tab"}' }
    const run = start(["--json"], refused)
    assert.equal(run.status, 0, run.stderr)
    assert.match(run.stderr, /warning: .*no such tab/)
    assert.equal(JSON.parse(run.stdout).tab, "kept")
  })

  it("refuses outside herdr before it calls hc", () => {
    const run = start([], scenario(), {}, { HC_TERMINAL_ID: "" })
    assert.equal(run.status, 2)
    assert.match(run.stderr, /outside herdr/)
    assert.deepEqual(run.hc, [])
  })

  it("refuses a fourth live Worker of the same Lead, and starts it when told the limit is higher", () => {
    const live = [
      mine("t4"),
      mine("t5", { status: "blocked" }),
      mine("t6"),
      mine("t8", { state: "finished" }),
      { address: "t9", parent: "t0" }
    ]
    const refused = start([], scenario({ live }))
    assert.equal(refused.status, 2)
    assert.match(refused.stderr, /3 live Workers.*--max-workers/)
    assert.deepEqual(refused.hc, [LISTED])

    const two = start([], scenario({ live: live.slice(0, 2) }))
    assert.equal(two.status, 0, two.stderr)

    const told = start(["--max-workers", "4"], scenario({ live }))
    assert.equal(told.status, 0, told.stderr)
    assert.deepEqual(told.hc[2], runCall(told.root))
  })

  it("fails loudly when herdr did not deliver the first message, and says how to recover", () => {
    const got = { firstMessage: { sent: false, reason: "the agent was not ready" } }
    const run = start([], scenario({ got }))
    assert.equal(run.status, 1)
    assert.match(run.stderr, /t7/)
    assert.match(run.stderr, /not delivered: the agent was not ready/)
    assert.match(run.stderr, /hc read t7/)
    assert.equal(run.stdout, "")

    const json = start(["--json"], scenario({ got }))
    assert.equal(json.status, 1)
    assert.deepEqual(
      {
        address: JSON.parse(json.stdout).address,
        delivered: JSON.parse(json.stdout).delivered,
        reason: JSON.parse(json.stdout).reason
      },
      { address: "t7", delivered: false, reason: "the agent was not ready" }
    )
  })

  it("fails when the Worker exited or errored before it took the message", () => {
    const exited = start([], scenario({ got: { state: "finished", status: null } }))
    assert.equal(exited.status, 1)
    assert.match(exited.stderr, /not delivered: the terminal has finished/)

    const errored = start([], scenario({ got: { status: "error" } }))
    assert.equal(errored.status, 1)
    assert.match(errored.stderr, /not delivered: .*error/)
  })

  it("fails when the Worker is still idle or silent once the wait is up, as a plain launch leaves no first message to read", () => {
    for (const status of ["idle", null]) {
      const run = start(["--wait", "0"], scenario({ got: { status } }))
      assert.equal(run.status, 1, String(status))
      assert.match(run.stderr, /not delivered: the Worker showed no sign of work within 0 s/)
      assert.equal(run.hc.at(-1)?.[0], "get")
    }
  })

  it("names the running Worker, and exits 1, when the read-back itself fails", () => {
    const scene = scenario()
    scene.hc["get t7"] = { exit: 1, stderr: "hc: the core went away\n" }
    const run = start([], scene)
    assert.equal(run.status, 1)
    assert.match(
      run.stderr,
      /t7\) started but its first message was not delivered: the terminal could not be read back/
    )
    assert.match(run.stderr, /the core went away/)
  })

  it("reads the terminal again until the Worker shows work", () => {
    const scene = scenario()
    scene.hc["get t7"] = [
      terminal("t7", { name: NAME, parent: LEAD, status: "idle" }),
      terminal("t7", { name: NAME, parent: LEAD, status: "working" })
    ]
    const run = start(["--wait", "5"], scene)
    assert.equal(run.status, 0, run.stderr)
    assert.deepEqual(
      run.hc.filter((call) => call[0] === "get" && call[1] === "t7"),
      [
        ["get", "t7", "--json"],
        ["get", "t7", "--json"]
      ]
    )
  })

  it("starts the Worker in the main checkout when the Lead sits in a linked worktree", () => {
    const herdr = fakeHerdr(scenario(), LEAD)
    const main = repo()
    write(join(main, "README.md"), "x\n")
    git(main, "add", "README.md")
    commit(main, "-m", "init")
    const linked = join(scratch("linked"), "wt")
    git(main, "worktree", "add", "-q", linked, "-b", "feature")
    write(join(linked, "brief.md"), BRIEF)
    const run = runBin(["worker", "start", "--brief", "brief.md", "--name", NAME], linked, herdr.env)
    assert.equal(run.status, 0, run.stderr)
    assert.deepEqual(herdr.hcCalls()[2], runCall(main))
  })

  it("stops with hc's own words when hc run fails, and when hc is not installed", () => {
    const scene = scenario()
    scene.hc.run = { exit: 1, stderr: "hc: name `worker-9-demo` is taken\n" }
    const taken = start([], scene)
    assert.equal(taken.status, 2)
    assert.match(taken.stderr, /hc run failed: hc: name `worker-9-demo` is taken/)
    assert.deepEqual(taken.app, [])

    const bare = scratch("no-hc")
    const none = start([], scenario(), {}, { PATH: bare })
    assert.equal(none.status, 2)
    assert.match(none.stderr, /hc is not on PATH/)
  })

  it("refuses a missing or bad flag, and a missing or empty Brief, before it calls hc", () => {
    const refusals: [string[], RegExp][] = [
      [["--name", "Bad Name"], /--name takes/],
      [["--effort", "turbo"], /--effort takes one of low, medium, high, xhigh, max/],
      [["--model", ""], /--model takes/],
      [["--max-workers", "0"], /--max-workers takes/],
      [["--brief", "absent.md"], /absent\.md/]
    ]
    for (const [args, message] of refusals) {
      const run = start(args, scenario())
      assert.equal(run.status, 2, args.join(" "))
      assert.match(run.stderr, message)
      assert.deepEqual(run.hc, [], args.join(" "))
    }
    const herdr = fakeHerdr(scenario(), LEAD)
    const root = repo({ files: { "empty.md": "  \n" } })
    const empty = runBin(["worker", "start", "--brief", "empty.md", "--name", NAME], root, herdr.env)
    assert.equal(empty.status, 2)
    assert.match(empty.stderr, /empty\.md is empty/)
    const bare = runBin(["worker", "start"], root, herdr.env)
    assert.equal(bare.status, 2)
    assert.match(bare.stderr, /--brief/)
    assert.deepEqual(herdr.hcCalls(), [])
  })
})

/** A clone of a bare origin on main with origin/HEAD set, and the herdr tools that serve a start from it. */
function cloned() {
  const dir = scratch("origin")
  const origin = join(dir, "origin.git")
  git(dir, "init", "-q", "--bare", "-b", "main", origin)
  const root = join(dir, "clone")
  git(dir, "clone", "-q", origin, root)
  git(root, "switch", "-q", "-c", "main")
  write(join(root, "README.md"), "one\n")
  git(root, "add", "README.md")
  commit(root, "-m", "one")
  git(root, "push", "-q", "-u", "origin", "main")
  git(root, "remote", "set-head", "origin", "main")
  write(join(root, "brief.md"), BRIEF)
  const herdr = fakeHerdr(scenario(), LEAD)
  /** A commit on origin's main that this clone has not fetched; its id. */
  const moveOrigin = (): string => {
    const other = join(dir, "other")
    git(dir, "clone", "-q", origin, other)
    write(join(other, "README.md"), "two\n")
    git(other, "add", "README.md")
    commit(other, "-m", "two")
    git(other, "push", "-q", "origin", "main")
    return git(other, "rev-parse", "HEAD").trim()
  }
  const startIt = (env: NodeJS.ProcessEnv = {}) =>
    runBin(["worker", "start", "--brief", "brief.md", "--name", NAME], root, { ...herdr.env, ...env })
  return { root, herdr, moveOrigin, startIt }
}

describe("dw-sdlc worker start, the base of the Worker", () => {
  it("fetches origin's default branch before it starts the Worker, so the tip origin moved to is the base", () => {
    const { root, herdr, moveOrigin, startIt } = cloned()
    const before = git(root, "rev-parse", "origin/main").trim()
    const tip = moveOrigin()
    assert.notEqual(tip, before)
    assert.equal(git(root, "rev-parse", "origin/main").trim(), before, "the clone has not fetched yet")

    const run = startIt()
    assert.equal(run.status, 0, run.stderr)
    assert.equal(git(root, "rev-parse", "origin/main").trim(), tip)
    assert.equal(herdr.hcCalls()[2]?.[0], "run")
  })

  it("fetches every branch of origin when no default branch is known", () => {
    const { root, moveOrigin, startIt } = cloned()
    git(root, "remote", "set-head", "origin", "-d")
    const tip = moveOrigin()
    const run = startIt()
    assert.equal(run.status, 0, run.stderr)
    assert.equal(git(root, "rev-parse", "origin/main").trim(), tip)
  })

  it("starts no Worker, and says why, when the fetch fails", () => {
    const { root, herdr, startIt } = cloned()
    git(root, "remote", "set-url", "origin", join(root, "no-such-origin.git"))
    const run = startIt()
    assert.equal(run.status, 2)
    assert.match(run.stderr, /git fetch origin main failed, so the Worker would begin from a stale base/)
    assert.match(run.stderr, /check the network and the access to origin, then start the Worker again/)
    assert.equal(run.stdout, "")
    assert.deepEqual(herdr.hcCalls(), [LISTED])
  })

  it("starts no Worker when the fetch outlives its time limit", () => {
    const { herdr, startIt } = cloned()
    const realGit = runCommand("which", ["git"], scratch("which")).stdout.trim()
    const shim = scratch("slow-git")
    const bin = join(shim, "git")
    write(bin, `#!/bin/sh\ncase " $* " in *" fetch "*) sleep 5;; esac\nexec "${realGit}" "$@"\n`)
    chmodSync(bin, 0o755)
    const run = startIt({
      PATH: `${shim}:${herdr.env.PATH ?? ""}`,
      DW_SDLC_LIMIT_MS: "1500"
    })
    assert.equal(run.status, 2, run.stderr)
    assert.match(
      run.stderr,
      /git fetch origin main failed, so the Worker would begin from a stale base: .*did not answer/
    )
    assert.deepEqual(herdr.hcCalls(), [LISTED])
  })
})
