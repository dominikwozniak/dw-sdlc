// `dw-sdlc pr ship --wait`: the script polls every recheckAfter and prints one document, the first answer
// that is not a wait, within the 40 min CI budget. Under DW_SDLC_NOW each poll moves its own clock on.

import assert from "node:assert/strict"
import { chmodSync, existsSync, readFileSync } from "node:fs"
import { delimiter, join } from "node:path"
import { describe, it } from "node:test"

import { COMMITTED_FILE } from "../../src/agentic-config.ts"
import { repo, runBin, scratch, write } from "../harness.ts"
import { BASE_OID, type Context, fakeGh, GREEN, type Pr, RUN, type Response, served } from "../pr-harness.ts"

const TARGET = ["40", "-R", "byarcadia-app/foundation"]
const STARTED = "2026-10-31T11:01:00Z"
const FILES = { [COMMITTED_FILE]: { pr: { merge: "ask" } } }

const RUNNING: Context = { kind: "run", name: "Check", state: "IN_PROGRESS", link: RUN, startedAt: STARTED }
/** Its one check running since STARTED: a ci-pending wait that rechecks every minute with no merged history. */
const PENDING: Pr = { ...GREEN, mergeStateStatus: "BLOCKED", checks: [RUNNING] }
const PASSED: Pr = { ...GREEN, checks: [{ ...RUNNING, state: "SUCCESS" }] }

/** The clock `minutes` after STARTED. */
const after = (minutes: number): string => new Date(Date.parse(STARTED) + minutes * 60_000).toISOString()

type Waited = { status: number | null; stdout: string; stderr: string; graphql: number; sleeps: string[] }

/** `pr ship --wait --json` over the replies in order, the clock at `clock` or the system's when left out. */
function waited(replies: Pr[], clock?: string, args: string[] = [], commands: Record<string, Response> = {}): Waited {
  const gh = fakeGh({ graphql: replies.map(served), commands })
  // A sleep of its own that waits for nothing and logs its seconds, first on PATH.
  const dir = scratch("sleep")
  write(join(dir, "sleep"), `#!/bin/sh\necho "$1" >>${JSON.stringify(join(dir, "slept"))}\n`)
  chmodSync(join(dir, "sleep"), 0o755)
  const env = {
    ...gh.env,
    PATH: `${dir}${delimiter}${gh.env.PATH ?? ""}`,
    ...(clock === undefined ? {} : { DW_SDLC_NOW: clock })
  }
  const run = runBin(["pr", "ship", ...TARGET, ...args, "--wait", "--json"], repo({ files: FILES }), env)
  const slept = join(dir, "slept")
  return {
    status: run.status,
    stdout: run.stdout,
    stderr: run.stderr,
    graphql: gh.calls().filter(([a, b]) => a === "api" && b === "graphql").length,
    sleeps: existsSync(slept) ? readFileSync(slept, "utf8").split("\n").filter(Boolean) : []
  }
}

describe("dw-sdlc pr ship --wait", () => {
  it("prints one document, the first answer that is not a wait, with its exit code", () => {
    const run = waited([PENDING, PENDING, PASSED], after(1))
    assert.equal(run.status, 30, run.stdout + run.stderr)
    assert.equal(run.graphql, 3)
    const document = JSON.parse(run.stdout) as Record<string, unknown>
    assert.equal(document.status, "park")
    assert.equal(document.action, "ready-to-merge")
    assert.deepEqual(run.sleeps, [], "a clock the test set is moved on, never slept")
  })

  it("answers at once when the first answer is not a wait", () => {
    const run = waited([PASSED], after(1))
    assert.equal(run.status, 30, run.stdout + run.stderr)
    assert.equal(run.graphql, 1)
    assert.equal((JSON.parse(run.stdout) as Record<string, unknown>).action, "ready-to-merge")
  })

  it("parks ci-stuck once a ci-pending wait is past the 40 min budget", () => {
    const run = waited([PENDING, PENDING, PENDING, PENDING], after(39))
    assert.equal(run.status, 30, run.stdout + run.stderr)
    // 39 min and 40 min are within the budget, 41 min is past it.
    assert.equal(run.graphql, 3)
    const document = JSON.parse(run.stdout) as Record<string, unknown>
    assert.equal(document.status, "park")
    assert.equal(document.action, "ci-stuck")
    assert.match(String(document.reason), /past the 40 min budget/)
  })

  it("returns the wait again at its limit, with the same --wait --json step", () => {
    const run = waited(
      Array.from({ length: 60 }, () => PENDING),
      after(0),
      ["--merge"]
    )
    assert.equal(run.status, 20, run.stdout + run.stderr)
    // A poll a minute from 0 to 40 min.
    assert.equal(run.graphql, 41)
    const document = JSON.parse(run.stdout) as Record<string, unknown>
    assert.equal(document.status, "wait")
    assert.equal(document.reason, "ci-pending")
    assert.deepEqual(document.next, [
      { by: "agent", run: "dw-sdlc pr ship 40 -R byarcadia-app/foundation --merge --wait --json" }
    ])
  })

  it("sleeps recheckAfter between polls when no clock is set", () => {
    const run = waited([{ ...GREEN, mergeable: "UNKNOWN" }, { ...GREEN, mergeable: "UNKNOWN" }, PASSED])
    assert.equal(run.status, 30, run.stdout + run.stderr)
    assert.equal(run.graphql, 3)
    assert.deepEqual(run.sleeps, ["15", "15"])
  })

  it("names what an earlier poll performed when a later read fails", () => {
    const updated = "5f0c2a7e9d4b1c3a6e8f0d2b4a6c8e0f1a3b5c7d"
    const compare = `api repos/byarcadia-app/foundation/compare/${BASE_OID}...${updated}?per_page=1`
    const behind = { stdout: JSON.stringify({ status: "ahead", ahead_by: 1, behind_by: 0 }) }
    // The first poll updates the branch and waits on CI; the second finds no reply left, as a read that fails.
    const replies = [
      { ...GREEN, mergeStateStatus: "BEHIND" },
      { ...PENDING, head: updated }
    ]
    const run = waited(replies, after(1), [], { [compare]: behind })
    assert.equal(run.status, 2, run.stdout + run.stderr)
    const document = JSON.parse(run.stdout) as { performed: { action: string; ok: boolean }[] }
    assert.deepEqual(
      document.performed.map(({ action, ok }) => [action, ok]),
      [["update-branch", true]]
    )
  })

  it("prints nothing but the one answer as a line when --json is left out", () => {
    const gh = fakeGh({ graphql: [served(PENDING), served(PASSED)] })
    const run = runBin(["pr", "ship", ...TARGET, "--wait"], repo({ files: FILES }), {
      ...gh.env,
      DW_SDLC_NOW: after(1)
    })
    assert.equal(run.status, 30, run.stdout + run.stderr)
    assert.equal(
      run.stdout
        .trim()
        .split("\n")
        .filter((line) => line.startsWith("park")).length,
      1
    )
    assert.match(run.stdout, /^park/)
  })

  it("describes --wait in --help", () => {
    const run = runBin(["pr", "ship", "--help"], repo(), {})
    assert.equal(run.status, 0, run.stderr)
    assert.match(run.stdout, /\[--wait\]/)
    assert.match(run.stdout, /--wait polls inside the script, every recheckAfter/)
    assert.match(run.stdout, /40 min CI\s+budget/)
  })
})
