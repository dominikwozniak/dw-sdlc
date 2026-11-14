// `dw-sdlc setup` in a checkout whose git dir lies outside it, as `git init --separate-git-dir` or a
// submodule leaves it: the machine's files go to the checkout, the excludes to the git dir.

import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"

import { LOCAL_FILE } from "../../src/agentic-config.ts"
import { setup } from "../../src/commands/setup.ts"
import { runCommand, scratch, write } from "../harness.ts"

describe("dw-sdlc setup with the git dir outside the checkout", () => {
  it("writes the local layer and settings in the checkout, and the excludes in the git dir", () => {
    const root = scratch("checkout")
    const gitDir = join(scratch("git-dir"), "repository.git")
    assert.equal(runCommand("git", ["init", "-q", "--separate-git-dir", gitDir, root], root).status, 0)
    write(join(root, "pnpm-lock.yaml"), "")
    const steps = setup({ root, home: scratch("home"), force: false, dryRun: false, path: "" })
    assert.ok(existsSync(join(root, LOCAL_FILE)), JSON.stringify(steps))
    assert.ok(existsSync(join(root, ".claude", "settings.local.json")))
    assert.match(readFileSync(join(gitDir, "info", "exclude"), "utf8"), /^\.ai\/agentic\.config\.local\.json$/m)
  })
})
