// The `routed-docs` Check through `dw-sdlc check` and `dw-sdlc gate`, on a throwaway repository whose
// Task Router and catalogue reach its docs one way at a time: the exit code and each failure line word
// for word.

import assert from "node:assert/strict"
import { rmSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"

import { lines, repo, runBin } from "../harness.ts"

const CONFIG = ".ai/agentic.config.json"

/** A Task Router whose first cell names a doc it does not reach, then a doc, a directory and a glob. */
const MAP = `# demo — agent rules

## Task Router

| task                          | read                                 |
| ----------------------------- | ------------------------------------ |
| tidying \`docs/stray.md\`       | \`docs/guide.md\`                      |
| editing the schema            | \`docs/adr\`, \`docs/specs/*.md\`        |
| what a Primitive is           | \`.ai/primitives.json\`                |

## Commands
`

const CATALOGUE = {
  version: 1,
  groups: [{ id: "gate", name: "Gate" }],
  primitives: [
    {
      id: "gate.domain",
      name: "Domain",
      group: "gate",
      summary: "The words the repository uses.",
      code: ["src/domain.ts"],
      docs: ["docs/agents/domain.md#the-glossary"]
    }
  ]
}

/** Every doc reached: by a row naming it, a directory above it, a glob, the catalogue; and a research note. */
const TREE = {
  "AGENTS.md": MAP,
  ".ai/primitives.json": CATALOGUE,
  "docs/guide.md": "# Guide\n",
  "docs/adr/0001-first.md": "# First\n",
  "docs/adr/old/0002-second.md": "# Second\n",
  "docs/specs/gate.md": "# Gate\n",
  "docs/agents/domain.md": "# Domain\n\n## The glossary\n",
  "docs/research/gate/notes.md": "# Notes\n"
}

const UNREACHED =
  "no Task Router row or Primitive reaches it — add a Task Router row, name it in a Primitive's docs, or exempt it"

/** A repository with `checks` as its gate.checks, `TREE` with `files` over it. */
function withDocs(files: Record<string, string | object> = {}, checks: object = { "routed-docs": true }): string {
  return repo({ files: { [CONFIG]: { version: 1, gate: { checks } }, ...TREE, ...files } })
}

/** `dw-sdlc check routed-docs` on `root`: its exit code and its failure lines, the verdict cut. */
function routed(root: string): { status: number; failures: string[] } {
  const run = runBin(["check", "routed-docs"], root)
  return { status: run.status, failures: lines(run.stdout).filter((line) => !line.startsWith("check routed-docs: ")) }
}

describe("the routed-docs Check", () => {
  it("passes a doc a row names, one under a directory a row names, one a row's glob matches, one a Primitive's docs name, and a research note", () => {
    assert.deepEqual(routed(withDocs()), { status: 0, failures: [] })
  })

  it("fails each doc no row and no Primitive reaches, a doc named in a row's first cell and one a glob's * stops short of", () => {
    const root = withDocs({ "docs/stray.md": "# Stray\n", "docs/specs/drafts/next.md": "# Next\n" })
    assert.deepEqual(routed(root), {
      status: 1,
      failures: [`docs/specs/drafts/next.md: routed-docs: ${UNREACHED}`, `docs/stray.md: routed-docs: ${UNREACHED}`]
    })
  })

  it("fails a map with no Task Router table once on the map, before each doc only the table reached", () => {
    const root = withDocs({ "AGENTS.md": "# demo — agent rules\n\n## Commands\n" })
    assert.deepEqual(routed(root), {
      status: 1,
      failures: [
        "AGENTS.md: routed-docs: has no Task Router table to reach a doc from — add a Task Router section whose table names the docs",
        `docs/adr/0001-first.md: routed-docs: ${UNREACHED}`,
        `docs/adr/old/0002-second.md: routed-docs: ${UNREACHED}`,
        `docs/guide.md: routed-docs: ${UNREACHED}`,
        `docs/specs/gate.md: routed-docs: ${UNREACHED}`
      ]
    })
  })

  it("exits 2 when the map does not exist", () => {
    const root = withDocs()
    rmSync(join(root, "AGENTS.md"))
    assert.deepEqual(routed(root), {
      status: 2,
      failures: [
        "AGENTS.md: routed-docs: the map does not exist — write it, or point gate.checks.agents-map.file at the map"
      ]
    })
  })

  it("reaches nothing through a catalogue that does not exist, and fails nothing on it", () => {
    const root = withDocs()
    rmSync(join(root, ".ai/primitives.json"))
    assert.deepEqual(routed(root), { status: 1, failures: [`docs/agents/domain.md: routed-docs: ${UNREACHED}`] })
  })

  it("runs after agents-map in the Gate", () => {
    const run = runBin(["gate", "--json"], withDocs({}, { "routed-docs": true, "agents-map": true }))
    const { checks } = JSON.parse(run.stdout)
    assert.deepEqual(
      checks.map(({ name }: { name: string }) => name),
      ["agents-map", "routed-docs"]
    )
  })
})

describe("the routed-docs Check's options", () => {
  it("judges the docs files matches and exempt leaves out, a list replacing each default", () => {
    const root = withDocs(
      { "guides/setup.md": "# Setup\n", "docs/specs/old.md": "# Old\n" },
      { "routed-docs": { files: ["docs/**/*.md", "guides/*.md"], exempt: ["docs/specs/**"] } }
    )
    assert.deepEqual(routed(root), {
      status: 1,
      failures: [`docs/research/gate/notes.md: routed-docs: ${UNREACHED}`, `guides/setup.md: routed-docs: ${UNREACHED}`]
    })
  })

  it("reads the map agents-map reads and the catalogue primitives reads", () => {
    const root = withDocs(
      { "MAP.md": MAP.replace("docs/guide.md", "docs/adr/*.md"), ".ai/catalogue.json": CATALOGUE },
      { "agents-map": { file: "MAP.md" }, primitives: { file: ".ai/catalogue.json" } }
    )
    rmSync(join(root, ".ai/primitives.json"))
    assert.deepEqual(routed(root), { status: 1, failures: [`docs/guide.md: routed-docs: ${UNREACHED}`] })
  })

  it("stays off under false and when the config leaves it out", () => {
    const off = runBin(["gate", "--json"], withDocs({ "docs/stray.md": "# Stray\n" }, { "routed-docs": false }))
    assert.equal(off.status, 0, off.stdout)
    assert.deepEqual(JSON.parse(off.stdout).checks, [])
    const unset = runBin(["gate", "--json"], withDocs({ "docs/stray.md": "# Stray\n" }, {}))
    assert.equal(unset.status, 0, unset.stdout)
    assert.deepEqual(JSON.parse(unset.stdout).checks, [])
  })
})
