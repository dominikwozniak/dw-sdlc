// `dw-sdlc worker report` spawned with a fake hc first on PATH: a Recap delivered as text or as a file
// path, the retry while the Lead is blocked, and the non-zero exit when it gives up.

import assert from "node:assert/strict"
import { join } from "node:path"
import { describe, it } from "node:test"

import { repo, runBin, write } from "../harness.ts"
import { fakeHerdr, type Reply } from "../hc-harness.ts"

const BLOCKED: Reply = { exit: 9, stderr: "hc: t2 is blocked\n" }
const SENT: Reply = { stdout: "{}" }
const LONG = `# Recap\n\n| step | result |\n| ---- | ------ |\n| PR | merged |\n`

/** `dw-sdlc worker report <args>` for a Recap file holding `recap`, the calling terminal `t5`, `hc send` answering `sends`. */
function report(args: string[], sends: Reply[], recap = LONG, env: NodeJS.ProcessEnv = {}) {
  const herdr = fakeHerdr({ hc: { send: sends } }, "t5")
  const root = repo()
  write(join(root, "recap.md"), recap)
  const run = runBin(["worker", "report", "--to", "t2", "--recap", "recap.md", ...args], root, { ...herdr.env, ...env })
  return { ...run, root, hc: herdr.hcCalls() }
}

describe("dw-sdlc worker report", () => {
  it("sends a long Recap to the Lead as the path of its file", () => {
    const run = report([], [SENT])
    assert.equal(run.status, 0, run.stderr)
    assert.deepEqual(run.hc, [["send", "t2", join(run.root, "recap.md")]])
    assert.equal(run.stdout, "reported to t2\n")
  })

  it("sends a short one-line Recap as itself", () => {
    const run = report([], [SENT], "PR #9: merged, nothing left\n")
    assert.equal(run.status, 0, run.stderr)
    assert.deepEqual(run.hc, [["send", "t2", "PR #9: merged, nothing left"]])
  })

  it("sends a one-line Recap past the length limit as a path too", () => {
    const run = report([], [SENT], `${"word ".repeat(100)}\n`)
    assert.deepEqual(run.hc, [["send", "t2", join(run.root, "recap.md")]])
  })

  it("waits while the Lead is blocked and retries, never forcing the send", () => {
    const run = report(["--interval", "0"], [BLOCKED, BLOCKED, SENT])
    assert.equal(run.status, 0, run.stderr)
    assert.equal(run.hc.length, 3)
    assert.deepEqual(new Set(run.hc.map((call) => call.join("\0"))).size, 1)
    assert.ok(run.hc.every((call) => !call.includes("--force")))
    assert.match(run.stderr, /t2 is blocked; waiting 0 s \(attempt 1 of 30\)/)
    assert.match(run.stderr, /attempt 2 of 30/)
    assert.equal(run.stdout, "reported to t2\n")
  })

  it("exits non-zero when the Lead stays blocked past the bound, naming the file left behind", () => {
    const run = report(["--interval", "0", "--attempts", "3"], [BLOCKED, BLOCKED, BLOCKED])
    assert.equal(run.status, 1)
    assert.equal(run.hc.length, 3)
    assert.ok(run.hc.every((call) => !call.includes("--force")))
    assert.match(run.stderr, /gave up after 3 attempts: t2 is still blocked/)
    assert.match(run.stderr, /recap\.md/)
    assert.equal(run.stdout, "")
  })

  it("gives up at once on a refusal that is not a blocked Lead", () => {
    const run = report(["--interval", "0"], [{ exit: 1, stderr: "hc: no terminal t2\n" }])
    assert.equal(run.status, 1)
    assert.equal(run.hc.length, 1)
    assert.match(run.stderr, /hc send failed: hc: no terminal t2/)
  })

  it("refuses outside herdr, a missing Recap, an empty one and a bad bound before it calls hc", () => {
    const refusals: [string[], Reply[], string, NodeJS.ProcessEnv, RegExp][] = [
      [[], [SENT], LONG, { HC_TERMINAL_ID: "" }, /outside herdr/],
      [[], [SENT], "\n", {}, /recap\.md is empty/],
      [["--attempts", "0"], [SENT], LONG, {}, /--attempts takes/],
      [["--interval=-1"], [SENT], LONG, {}, /--interval takes/],
      [["--recap", "absent.md"], [SENT], LONG, {}, /absent\.md/]
    ]
    for (const [args, sends, recap, env, message] of refusals) {
      const run = report(args, sends, recap, env)
      assert.equal(run.status, 2, args.join(" "))
      assert.match(run.stderr, message)
      assert.deepEqual(run.hc, [], args.join(" "))
    }
    const herdr = fakeHerdr({ hc: { send: SENT } }, "t5")
    const bare = runBin(["worker", "report"], repo(), herdr.env)
    assert.equal(bare.status, 2)
    assert.match(bare.stderr, /--to/)
  })

  it("stops when hc is not installed", () => {
    const run = report([], [SENT], LONG, { PATH: join(repo(), "none") })
    assert.equal(run.status, 2)
    assert.match(run.stderr, /hc is not on PATH/)
  })
})
