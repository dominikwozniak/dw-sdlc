// What the bin answers when a command throws what it has no answer for: exit 2 and one line, the same
// for every command, since exit 1 means a verdict the command reached.

import assert from "node:assert/strict"
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"

import { COMMITTED_FILE } from "../src/agentic-config.ts"
import { lines, repo, type Run, runBin } from "./harness.ts"

function assertCannotRun(run: Run, what: string): void {
  assert.equal(run.status, 2, `${what}: ${run.stderr}`)
  const said = lines(run.stderr)
  assert.equal(said.length, 1, `${what}: ${run.stderr}`)
  assert.ok(said[0]?.startsWith("dw-sdlc: "), `${what}: ${run.stderr}`)
}

describe("dw-sdlc when a command throws what it has no answer for", () => {
  it("exits 2 on one line when the config's path is a directory", () => {
    for (const command of [["gate"], ["pr", "ship", "40", "-R", "owner/name"]]) {
      const root = repo()
      mkdirSync(join(root, COMMITTED_FILE), { recursive: true })
      assertCannotRun(runBin(command, root), command.join(" "))
    }
  })

  it("exits 2 on one line when the Gate has no place to capture a command's output", () => {
    const root = repo({ files: { [COMMITTED_FILE]: { version: 1, gate: { steps: ["true"] } } } })
    assertCannotRun(runBin(["gate"], root, { TMPDIR: join(root, "no-such-directory") }), "gate")
  })
})
