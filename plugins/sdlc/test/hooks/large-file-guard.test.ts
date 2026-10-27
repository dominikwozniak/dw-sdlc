// What large-file-guard.sh flags (exit 2) after a Write and lets pass (exit 0): the threshold, that
// only Write is judged, and that CLAUDE_MAX_WRITE_BYTES raises, lowers or, at 0, disables it.

import assert from "node:assert/strict"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"

import { expectExit, runHook, scratch, type Verdict } from "../harness.ts"

const TMP = scratch("large")

/** Printable bytes, so the fixture is not a binary blob. */
function makeFile(name: string, bytes: number): string {
  const path = join(TMP, name)
  writeFileSync(path, "x".repeat(bytes))
  return path
}
const SMALL = makeFile("small.md", 1024)
const UNDER = makeFile("under.md", 262144)
const OVER = makeFile("over.md", 300000)
const HUGE = makeFile("huge.js", 2000000)

function run(tool: string, filePath: string, env?: NodeJS.ProcessEnv): Verdict {
  const payload = { hook_event_name: "PostToolUse", tool_name: tool, tool_input: { file_path: filePath } }
  return runHook("large-file-guard", payload, { env })
}
function flagged(name: string, tool: string, filePath: string): void {
  it(name, () => {
    expectExit(run(tool, filePath), 2)
  })
}
function quiet(name: string, tool: string, filePath: string): void {
  it(name, () => {
    expectExit(run(tool, filePath), 0)
  })
}

describe("the default threshold", () => {
  flagged("over-threshold", "Write", OVER)
  flagged("far-over-threshold", "Write", HUGE)
  quiet("small-file", "Write", SMALL)
  quiet("exactly-at-threshold", "Write", UNDER)
  quiet("edit-is-not-judged", "Edit", HUGE)
  quiet("multiedit-is-not-judged", "MultiEdit", HUGE)
  quiet("read-is-not-judged", "Read", HUGE)
  quiet("bash-is-not-judged", "Bash", HUGE)
  quiet("missing-file", "Write", join(TMP, "does-not-exist.md"))
  quiet("empty-path", "Write", "")
})

describe("a relative path is measured under the payload's cwd", () => {
  it("relative-path-flagged", () => {
    const payload = {
      hook_event_name: "PostToolUse",
      tool_name: "Write",
      cwd: TMP,
      tool_input: { file_path: "huge.js" }
    }
    expectExit(runHook("large-file-guard", payload), 2)
  })
})

describe("CLAUDE_MAX_WRITE_BYTES", () => {
  it("lower-threshold-flags-small", () => {
    expectExit(run("Write", SMALL, { CLAUDE_MAX_WRITE_BYTES: "512" }), 2)
  })
  it("raised-threshold-passes-huge", () => {
    expectExit(run("Write", HUGE, { CLAUDE_MAX_WRITE_BYTES: "5000000" }), 0)
  })
  it("zero-disables", () => {
    expectExit(run("Write", HUGE, { CLAUDE_MAX_WRITE_BYTES: "0" }), 0)
  })
  it("non-numeric-falls-back-to-default", () => {
    expectExit(run("Write", HUGE, { CLAUDE_MAX_WRITE_BYTES: "lots" }), 2)
  })
  it("empty-falls-back-to-default", () => {
    expectExit(run("Write", SMALL, { CLAUDE_MAX_WRITE_BYTES: "" }), 0)
  })
})

describe("the message names the file, the size and the escape hatch", () => {
  const wants: [string, string][] = [
    ["the file", HUGE],
    ["the size", "2000000"],
    ["the escape hatch", "CLAUDE_MAX_WRITE_BYTES"]
  ]
  for (const [what, want] of wants) {
    it(`message names ${what}`, () => {
      const { stderr } = run("Write", HUGE)
      assert.ok(stderr.includes(want), `[${want}] not in stderr: ${stderr}`)
    })
  }
})

describe("garbage is silent", () => {
  it("empty payload", () => {
    expectExit(runHook("large-file-guard", ""), 0)
  })
  it("malformed payload", () => {
    expectExit(runHook("large-file-guard", "not json"), 0)
  })
})
