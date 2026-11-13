// How the Gate's command runner holds SIGINT and SIGTERM, run in a Node process of its own so a
// signal it sends itself never reaches the test runner.

import assert from "node:assert/strict"
import { join } from "node:path"
import { describe, it } from "node:test"

import { PACKAGE_ROOT, runCommand, scratch } from "./harness.ts"

const RUNNER = join(PACKAGE_ROOT, "src", "run-command.ts")

/** Runs `body`, the statements of an async function, under `holdingSignals` and prints `stoppedBy()`. */
function holding(body: string): { status: number; stdout: string } {
  const script = `
    import { holdingSignals, runCommand, stoppedBy } from ${JSON.stringify(RUNNER)}
    await holdingSignals(async () => { ${body} })
    console.log("stopped by " + (stoppedBy() ?? "nothing"))
  `
  return runCommand(process.execPath, ["--input-type=module", "--eval", script], scratch("run"))
}

describe("holdingSignals", () => {
  it("keeps a signal the process got just after its last command ended", () => {
    // The signal reaches libuv after the loop read the command's exit, as a Step's SIGINT can on CI.
    const run = holding(`
      await runCommand("true", process.cwd(), "capture")
      process.kill(process.pid, "SIGINT")
    `)
    assert.equal(run.stdout, "stopped by SIGINT\n")
  })
})
