// The Worker commands in the bin's usage, and each one's own --help, which needs no herdr.

import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { repo, runBin } from "../harness.ts"

describe("the worker commands' usage", () => {
  it("lists them in the bin's usage", () => {
    const run = runBin(["--help"], repo(), { HC_TERMINAL_ID: "" })
    assert.equal(run.status, 0, run.stderr)
    assert.match(run.stdout, /^ {2}worker start {6}start a Worker on a Brief in a herdr terminal$/m)
    assert.match(run.stdout, /^ {2}worker ls {9}list the Workers this Lead started and their states$/m)
    assert.match(run.stdout, /^ {2}worker report {5}deliver a Recap to the Lead, retrying while it is blocked$/m)
  })

  it("prints each command's options outside herdr", () => {
    for (const command of ["start", "ls", "report"]) {
      const run = runBin(["worker", command, "--help"], repo(), { HC_TERMINAL_ID: "" })
      assert.equal(run.status, 0, `${command}: ${run.stderr}`)
      assert.match(run.stdout, new RegExp(`^Usage: dw-sdlc worker ${command}`))
    }
  })
})
