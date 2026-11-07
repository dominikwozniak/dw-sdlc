// The fake gh the Ship script's tests put first on PATH: GraphQL replies served in order, every other
// call answered by its whole arguments, else by its first two words, every call logged.

import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { runCommand, scratch } from "./harness.ts"
import { fakeGh } from "./pr-harness.ts"

describe("the fake gh", () => {
  it("serves the GraphQL replies in order, answers other calls by their whole arguments or first two words, and logs each call", () => {
    const gh = fakeGh({
      graphql: [{ stdout: "first" }, { stdout: "second", stderr: "warned\n", exit: 1 }],
      commands: { "pr ready": { stdout: "ready", exit: 3 }, "pr ready 41": { stdout: "exact" } }
    })
    const cwd = scratch("fake-gh")
    const call = (...args: string[]) => runCommand("gh", args, cwd, gh.env)
    assert.deepEqual(call("api", "graphql", "-f", "query=a"), { status: 0, stdout: "first", stderr: "" })
    assert.deepEqual(call("pr", "ready", "40"), { status: 3, stdout: "ready", stderr: "" })
    assert.deepEqual(call("pr", "ready", "41"), { status: 0, stdout: "exact", stderr: "" }, "whole arguments win")
    assert.deepEqual(call("api", "graphql", "-f", "query=b"), { status: 1, stdout: "second", stderr: "warned\n" })
    assert.equal(call("api", "graphql").status, 99, "a call past the last reply fails loudly")
    assert.deepEqual(call("auth", "status"), { status: 0, stdout: "", stderr: "" })
    assert.deepEqual(gh.calls(), [
      ["api", "graphql", "-f", "query=…"],
      ["pr", "ready", "40"],
      ["pr", "ready", "41"],
      ["api", "graphql", "-f", "query=…"],
      ["api", "graphql"],
      ["auth", "status"]
    ])
  })
})
