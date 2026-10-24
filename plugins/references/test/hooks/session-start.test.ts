// What session-start.sh tells a session as it starts, fed the real SessionStart payload the way Claude
// Code spawns it: from a directory other than the project's, CLAUDE_PROJECT_DIR naming the project.
// A repository without the key gets nothing; a Sync that fails prints its lines and one line more.
// Either way the session starts: exit 0.

import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"
import { pathToFileURL } from "node:url"

import { commit, git, initRepo, runHook, scratch, write, writeJson, type Run } from "../harness.ts"

const CONFIG = ".ai/agentic.config.json"

/** The hook's run for a session starting in `project`, spawned from elsewhere. */
function start(project: string): Run {
  const payload = { hook_event_name: "SessionStart", source: "startup", cwd: project }
  return runHook("session-start", payload, scratch("elsewhere"), { CLAUDE_PROJECT_DIR: project })
}

/** A repository with one commit, by the file:// URL a Reference names it. */
function upstream(): string {
  const dir = initRepo(scratch("upstream"))
  write(join(dir, "README.md"), "README\n")
  git(dir, "add", "README.md")
  commit(dir, "-m", "README")
  return pathToFileURL(dir).href
}

function entry(dir: string, url: string): Record<string, unknown> {
  return { dir, repository: url, ref: "main", what: `the ${dir} clone`, when: "a test reads it" }
}

describe("session-start.sh", () => {
  it("prints nothing and exits 0 in a repository without the key", () => {
    const project = initRepo(scratch("keyless"))
    writeJson(join(project, CONFIG), { version: 1 })
    assert.deepEqual(start(project), { status: 0, stdout: "", stderr: "" })
  })

  it("prints the Sync's lines and says the clones stay where they were when the Sync fails, and exits 0", () => {
    const fine = upstream()
    const gone = pathToFileURL(join(scratch("gone"), "nothing")).href
    const project = initRepo(scratch("project"))
    writeJson(join(project, CONFIG), { version: 1, references: [entry("fine", fine), entry("gone", gone)] })

    const run = start(project)
    assert.equal(run.status, 0, `stdout: ${run.stdout}\nstderr: ${run.stderr}`)
    assert.equal(run.stderr, "")
    const lines = run.stdout.split("\n").filter(Boolean)
    assert.equal(lines.length, 3, run.stdout)
    assert.match(lines[0] ?? "", new RegExp(`^references/fine {2}[0-9a-f]+ {2}${fine} main$`))
    assert.match(lines[1] ?? "", /^references\/gone {2}FAILED {2}git fetch/)
    assert.match(lines[2] ?? "", /^references: the Sync failed, so each clone stays where it was/)
    assert.ok(existsSync(join(project, "references", "fine", "README.md")))
  })
})
