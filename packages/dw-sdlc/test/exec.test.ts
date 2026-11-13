// How the package runs a short-lived child process: stopped at its limit, no git prompt, room for a long
// answer, and a tool's own exit left to its caller.

import assert from "node:assert/strict"
import { chmodSync, existsSync, readFileSync } from "node:fs"
import { delimiter, join } from "node:path"
import { describe, it } from "node:test"

import { realProbe } from "../src/commands/doctor.ts"
import { exec, TimedOut } from "../src/exec.ts"
import { lines, repo, runBin, scratch, write } from "./harness.ts"

/** Long enough for the git calls ahead of the tool on a busy runner, short enough to wait out. */
const LIMIT = "2000"

/** Whether process `pid` is gone within `withinMs`: a killed child stays a zombie until it is reaped. */
function gone(pid: number, withinMs = 2000): boolean {
  const deadline = performance.now() + withinMs
  for (;;) {
    try {
      process.kill(pid, 0)
    } catch {
      return true
    }
    if (performance.now() >= deadline) {
      return false
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50)
  }
}

/** An environment with `tool` first on PATH, one that never answers, and a limit reached quickly. */
function hanging(tool: string, over: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const dir = scratch("hanging")
  const bin = join(dir, tool)
  write(bin, "#!/bin/sh\nexec sleep 30\n")
  chmodSync(bin, 0o755)
  return { PATH: `${dir}${delimiter}${process.env.PATH ?? ""}`, DW_SDLC_LIMIT_MS: LIMIT, ...over }
}

/** How long a stopped child may take to die on a loaded machine; the child sleeps well past it. */
const GONE_MS = 10_000

/** The first limit a child-stop run tries, and the last, doubling in between. */
const FIRST_LIMIT_MS = 500
const LAST_LIMIT_MS = 16_000

/**
 * The pid a child of the tool wrote before `exec` stopped the tool at its limit, 0 when none did. A run whose
 * limit passed before the child wrote its pid says nothing of `exec`, so it runs again with the limit doubled.
 */
function stoppedChild(around: (child: string) => string): number {
  for (let limitMs = FIRST_LIMIT_MS; ; limitMs *= 2) {
    const pidFile = join(scratch("child"), "pid")
    const child = `sh -c 'echo $$ > "$0"; exec sleep 30' "${pidFile}"`
    assert.throws(
      () => exec("sh", ["-c", around(child)], { limitMs }),
      (error: unknown) => error instanceof TimedOut
    )
    const written = existsSync(pidFile) ? readFileSync(pidFile, "utf8") : ""
    if (written !== "" || limitMs >= LAST_LIMIT_MS) {
      return Number(written)
    }
  }
}

describe("exec", () => {
  it("stops a tool past its limit and names it", () => {
    const started = performance.now()
    assert.throws(
      () => exec("sleep", ["30"], { limitMs: 100 }),
      (error: unknown) => {
        assert.ok(error instanceof TimedOut)
        assert.equal(error.message, "sleep 30 did not answer within 0.1 s")
        return true
      }
    )
    assert.ok(performance.now() - started < 5000, "the tool was stopped at its limit")
  })

  it("stops a tool that ignores SIGTERM at its limit", () => {
    const started = performance.now()
    assert.throws(
      () => exec("sh", ["-c", "trap '' TERM; sleep 6"], { limitMs: 300 }),
      (error: unknown) => error instanceof TimedOut
    )
    assert.ok(performance.now() - started < 3000, "the tool was killed at its limit, not when it chose to exit")
  })

  for (const [shape, around] of [
    ["in the foreground", (child: string) => `${child}; true`],
    ["in the background", (child: string) => `${child} & wait`],
    ["left behind by a shell that exits", (child: string) => `${child} &`]
  ] as const) {
    it(`stops a child of the tool ${shape} with it`, () => {
      let pid: number | undefined
      try {
        pid = stoppedChild(around)
        assert.ok(Number.isInteger(pid) && pid > 0, "the child wrote its pid")
        assert.ok(gone(pid, GONE_MS), `the child ${pid} is still running`)
      } finally {
        if (pid !== undefined && pid > 0 && !gone(pid, 0)) {
          process.kill(pid, "SIGKILL")
        }
      }
    })
  }

  it("names a long command by its start, on one line", () => {
    assert.throws(
      () => exec("sh", ["-c", `\n\nexec sleep 30\n# ${"x".repeat(200)}`], { limitMs: 100 }),
      (error: unknown) => {
        assert.ok(error instanceof TimedOut)
        assert.ok(!error.message.includes("\n"), error.message)
        assert.ok(error.message.length < 130, error.message)
        return true
      }
    )
  })

  it("tells git no one can answer a prompt, over the environment it is given", () => {
    const script = 'printf "%s %s" "$GIT_TERMINAL_PROMPT" "$GIVEN"'
    assert.equal(exec("sh", ["-c", script], { env: { GIVEN: "kept", PATH: process.env.PATH } }).stdout, "0 kept")
  })

  it("holds an answer past the default buffer of 1 MiB", () => {
    const { status, stdout } = exec(process.execPath, ["-e", 'process.stdout.write("x".repeat(2 * 1024 * 1024))'])
    assert.equal(status, 0)
    assert.equal(stdout.length, 2 * 1024 * 1024)
  })

  it("feeds `input` and runs from `cwd`", () => {
    assert.equal(exec("cat", [], { input: "fed" }).stdout, "fed")
    assert.equal(exec("pwd", ["-P"], { cwd: "/" }).stdout.trim(), "/")
  })

  it("leaves a tool's own exit and a missing tool to the caller", () => {
    assert.equal(exec("sh", ["-c", "exit 3"]).status, 3)
    const missing = exec("no-such-tool-anywhere", [])
    assert.ok(missing.error !== undefined && "code" in missing.error && missing.error.code === "ENOENT")
  })
})

describe("dw-sdlc when a tool it runs hangs", () => {
  it("exits 2 from pr ship, naming gh and the remedy", () => {
    const run = runBin(["pr", "ship", "40", "-R", "owner/name"], repo(), hanging("gh", { GH_HOST: "" }))
    assert.equal(run.status, 2, run.stderr)
    assert.deepEqual(lines(run.stderr), [
      "dw-sdlc pr ship: gh auth status --active --hostname github.com did not answer within 2 s — check gh auth status and the network, then call again"
    ])
  })

  it("exits 2 from worker ls, naming hc", () => {
    const run = runBin(["worker", "ls"], repo(), hanging("hc", { HC_TERMINAL_ID: "t1" }))
    assert.equal(run.status, 2, run.stderr)
    assert.match(run.stderr, /^dw-sdlc worker ls: hc .* did not answer within 2 s/)
  })

  it("leaves a doctor's probe answering as a tool that could not run, so the other checks still report", () => {
    process.env.DW_SDLC_LIMIT_MS = "100"
    try {
      assert.deepEqual(realProbe.run("sleep", ["30"]), { status: 127, stdout: "" })
      assert.equal(realProbe.shell("exec sleep 30"), "")
    } finally {
      delete process.env.DW_SDLC_LIMIT_MS
    }
  })
})
