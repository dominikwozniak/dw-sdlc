// The fake hc and herdr-app the Worker commands' tests put first on PATH: replies served in order or
// repeated, a call past the last reply or with no scenario failing loudly, every call logged per tool.

import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { runCommand, scratch } from "./harness.ts"
import { fakeHerdr } from "./hc-harness.ts"

describe("the fake hc", () => {
  it("serves a list in order, repeats a lone reply, prefers a two-word key, and logs each call per tool", () => {
    const herdr = fakeHerdr({
      hc: {
        "send t2": [{ exit: 9, stderr: "blocked\n" }, { stdout: "sent" }],
        send: { stdout: "any send" },
        ls: { stdout: "listed" }
      },
      "herdr-app": { "do tab.rename": { stdout: "renamed" } }
    })
    const cwd = scratch("fake-hc")
    const call = (tool: string, ...args: string[]) => runCommand(tool, args, cwd, herdr.env)
    assert.deepEqual(call("hc", "send", "t2", "hello"), { status: 9, stdout: "", stderr: "blocked\n" })
    assert.deepEqual(call("hc", "send", "t3", "hello"), { status: 0, stdout: "any send", stderr: "" })
    assert.deepEqual(call("hc", "send", "t2", "hello"), { status: 0, stdout: "sent", stderr: "" })
    assert.equal(call("hc", "send", "t2", "hello").status, 99, "a call past the last reply fails loudly")
    assert.equal(call("hc", "ls").stdout, "listed")
    assert.equal(call("hc", "ls").stdout, "listed")
    assert.equal(call("hc", "kill", "t2").status, 99, "a call the scenario does not name fails loudly")
    assert.equal(call("herdr-app", "do", "tab.rename", "--id", "tb1").stdout, "renamed")
    assert.deepEqual(
      herdr.hcCalls().map((args) => args.slice(0, 2)),
      [["send", "t2"], ["send", "t3"], ["send", "t2"], ["send", "t2"], ["ls"], ["ls"], ["kill", "t2"]]
    )
    assert.deepEqual(herdr.appCalls(), [["do", "tab.rename", "--id", "tb1"]])
  })
})
