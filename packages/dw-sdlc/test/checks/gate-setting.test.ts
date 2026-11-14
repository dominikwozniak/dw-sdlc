// A Check that reads another Check's setting, or the Gate command, reads it from the Gate it is handed,
// in this process: no config file is on disk, so nothing is read from one.

import assert from "node:assert/strict"
import { join } from "node:path"
import { describe, it } from "node:test"

import type { Gate } from "../../src/agentic-config.ts"
import { agentsMap } from "../../src/checks/agents-map.ts"
import { enabledChecks, shippedCheck } from "../../src/checks/index.ts"
import { routedDocs } from "../../src/checks/routed-docs.ts"
import { repo, write } from "../harness.ts"

const MAP =
  "# demo\n\nRun `pnpm check`.\n\n## Task Router\n\n| task | read |\n| --- | --- |\n| a guide | `docs/guide.md` |\n"

function gate(over: Partial<Gate> = {}): Gate {
  return { steps: [], drift: "fail", checks: { run: [] }, ...over }
}

describe("a Check under the Gate it is handed", () => {
  it("judges the agent map against the Gate command it is given", () => {
    const root = repo({ files: { "AGENTS.md": MAP } })
    const command = (given: string): string[] =>
      agentsMap
        .run(root, agentsMap.defaults, gate({ command: given }))
        .map(({ message }) => message)
        .filter((message) => message.includes("Gate command"))
    assert.deepEqual(command("pnpm check"), [])
    assert.deepEqual(command("make gate"), ['does not name the Gate command "make gate"'])
  })

  it("reads the map the Gate's agents-map setting names", () => {
    const root = repo({ files: { "MAP.md": MAP } })
    write(join(root, "docs", "guide.md"), "# Guide\n")
    write(join(root, "docs", "stray.md"), "# Stray\n")
    const found = routedDocs.run(
      root,
      routedDocs.defaults,
      gate({ checks: { run: [], "agents-map": { file: "MAP.md" } } })
    )
    assert.deepEqual(
      found.map(({ file }) => file),
      ["docs/stray.md"]
    )
  })

  it("is turned on, and bound to the Gate, by the Gate's own setting", () => {
    const root = repo({ files: { "AGENTS.md": MAP } })
    const on = gate({ command: "make gate", checks: { run: [], "agents-map": true } })
    assert.deepEqual(
      enabledChecks(on).map(({ name }) => name),
      ["agents-map"]
    )
    const messages = shippedCheck("agents-map", on)
      ?.run(root)
      .map(({ message }) => message)
    assert.ok(messages?.includes('does not name the Gate command "make gate"'), JSON.stringify(messages))
  })
})
