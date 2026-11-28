// The plugin's bin/dw-sdlc as the Bash tool runs it: found by name on PATH, from a directory outside the
// repository, with argv, both streams and the exit code passed through to the package CLI it links.

import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { accessSync, constants, symlinkSync } from "node:fs"
import { delimiter, join } from "node:path"
import { describe, it } from "node:test"

import { scratch } from "./harness.ts"

const BIN_DIR = join(import.meta.dirname, "..", "bin")

/** Runs bare `dw-sdlc <args>` from `cwd` with the plugin's bin directory first on PATH, as Claude Code puts it. */
function dwSdlc(args: string[], cwd: string) {
  const result = spawnSync("dw-sdlc", args, {
    cwd,
    env: { ...process.env, PATH: `${BIN_DIR}${delimiter}${process.env.PATH ?? ""}` },
    encoding: "utf8"
  })
  if (result.error !== undefined) {
    throw result.error
  }
  return { status: result.status ?? -1, stdout: result.stdout, stderr: result.stderr }
}

describe("bin/dw-sdlc", () => {
  const outside = scratch("bin")

  it("is executable", () => {
    accessSync(join(BIN_DIR, "dw-sdlc"), constants.X_OK)
  })

  it("runs the CLI by name from a directory outside the repository", () => {
    const result = dwSdlc(["--help"], outside)
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /^Usage: dw-sdlc <command> \[options\]/)
    assert.match(result.stdout, /pr ship/)
  })

  it("passes the exit code and stderr through", () => {
    const result = dwSdlc(["no-such-command"], outside)
    assert.equal(result.status, 2)
    assert.match(result.stderr, /^dw-sdlc: unknown command "no-such-command"/)
  })

  it("runs the CLI through a symlink to the bin, in a directory whose name holds a space", () => {
    const linked = join(scratch("bin link"), "dw-sdlc")
    symlinkSync(join(BIN_DIR, "dw-sdlc"), linked)
    const result = spawnSync(linked, ["--help"], { cwd: outside, encoding: "utf8" })
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /^Usage: dw-sdlc <command> \[options\]/)
  })

  it("passes a command's own flags through", () => {
    const result = dwSdlc(["pr", "ship", "--help"], outside)
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /^Usage: dw-sdlc pr ship/)
  })
})
