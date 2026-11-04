// The `agents-map` Check through `dw-sdlc gate`, on a throwaway repository whose map, `CLAUDE.md`,
// skills and lock break one rule at a time: the exit code and each failure line word for word.

import assert from "node:assert/strict"
import { mkdirSync, rmSync, symlinkSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"

import { repo, runBin } from "../harness.ts"

const CONFIG = ".ai/agentic.config.json"
const MANIFEST = { "package.json": JSON.stringify({ scripts: { check: "dw-sdlc gate" } }) }

const MAP = `# demo — agent rules

## Commands

\`\`\`bash
pnpm check   # the Gate
\`\`\`

## Task Router

| task                                    | read                               |
| --------------------------------------- | ---------------------------------- |
| editing \`lib.sh\` or \`when\` a doc moves  | \`docs/guide.md\`, \`docs/adr/*.md\`   |
| what a Primitive is and where it lives  | \`.ai/primitives.json\`              |

## Agent skills
`

/** The map's Task Router row that points at the catalogue, on line 14 of `MAP`. */
const CATALOGUE_ROW = "| what a Primitive is and where it lives  | `.ai/primitives.json`              |\n"

/** What `MAP` points at, and one skill in step: its directory, its lock entry, its link. */
const TREE = {
  ...MANIFEST,
  "AGENTS.md": MAP,
  "docs/guide.md": "# Guide\n",
  "docs/adr/0001-first.md": "# First\n",
  ".ai/primitives.json": "{}",
  ".agents/skills/tdd/SKILL.md": "---\nname: tdd\n---\n",
  "skills-lock.json": { version: 1, skills: { tdd: { source: "mattpocock/skills" } } }
}

function link(root: string, skill: string, target = `../../.agents/skills/${skill}`): void {
  mkdirSync(join(root, ".claude/skills"), { recursive: true })
  symlinkSync(target, join(root, ".claude/skills", skill))
}

/** `CLAUDE.md` at `root` a link to `target`, in place of what it was. */
function relinkClaude(root: string, target: string): void {
  rmSync(join(root, "CLAUDE.md"), { force: true })
  symlinkSync(target, join(root, "CLAUDE.md"))
}

/**
 * A repository with `agents-map` set to `setting`, `TREE` with `files` over it, the tdd skill linked,
 * and `CLAUDE.md` a link to `AGENTS.md` unless `files` writes one.
 */
function withMap(files: Record<string, string | object> = {}, setting: unknown = true, gate: object = {}): string {
  const config = { version: 1, gate: { checks: { "agents-map": setting }, ...gate } }
  const root = repo({ files: { [CONFIG]: config, ...TREE, ...files } })
  link(root, "tdd")
  if (!("CLAUDE.md" in files)) {
    symlinkSync("AGENTS.md", join(root, "CLAUDE.md"))
  }
  return root
}

function lines(text: string): string[] {
  return text.split("\n").filter((line) => line !== "")
}

/** The failure lines of a Gate run that ran the one Check, its own `gate: check` line and the verdict cut. */
function failures(stdout: string): string[] {
  return lines(stdout).slice(1, -1)
}

describe("the agents-map Check", () => {
  it("passes a map within budget that names the Gate, routes to the catalogue and to paths that exist", () => {
    const run = runBin(["gate"], withMap())
    assert.equal(run.status, 0, run.stdout)
    assert.deepEqual(lines(run.stdout), ["gate: check agents-map", "gate: green — 0 steps, 1 check"])
  })

  it("holds the map to 150 lines and 10240 bytes by default", () => {
    const padded = `${MAP}${"- a line of the map that says something an agent needs to know, and more\n".repeat(140)}`
    const run = runBin(["gate"], withMap({ "AGENTS.md": padded }))
    assert.equal(run.status, 1)
    assert.deepEqual(failures(run.stdout), [
      "AGENTS.md: agents-map: 156 lines, over the 150-line budget — cut it, or move a topic into a doc a Task Router row points at",
      "AGENTS.md: agents-map: 10651 bytes, over the 10240-byte budget — cut it, or move a topic into a doc a Task Router row points at"
    ])
  })

  it("fails a map that does not name the Gate command, the inferred one or the one gate.command sets", () => {
    const inferred = runBin(["gate"], withMap({ "AGENTS.md": MAP.replace("pnpm check", "pnpm checkout") }))
    assert.equal(inferred.status, 1)
    assert.deepEqual(failures(inferred.stdout), [
      'AGENTS.md: agents-map: does not name the Gate command "pnpm check" — name it where the map lists the commands'
    ])
    const set = runBin(["gate"], withMap({}, true, { command: "make verify" }))
    assert.deepEqual(failures(set.stdout), [
      'AGENTS.md: agents-map: does not name the Gate command "make verify" — name it where the map lists the commands'
    ])
  })

  it("fails when the Gate has no command for the map to name", () => {
    const run = runBin(["gate"], withMap({ "package.json": "{}" }))
    assert.equal(run.status, 1)
    assert.deepEqual(failures(run.stdout), [
      "agents-map: the Gate has no command for the map to name — set gate.command in the agentic config, or give package.json a check script"
    ])
  })

  it("fails a map with no Task Router row to the catalogue, and asks for none where there is no catalogue", () => {
    const run = runBin(["gate"], withMap({ "AGENTS.md": MAP.replace(CATALOGUE_ROW, "") }))
    assert.equal(run.status, 1)
    assert.deepEqual(failures(run.stdout), [
      "AGENTS.md: agents-map: no Task Router row points at .ai/primitives.json — add a row that sends an agent to the catalogue"
    ])
    const root = withMap({ "AGENTS.md": MAP.replace(CATALOGUE_ROW, "") })
    rmSync(join(root, ".ai/primitives.json"))
    assert.equal(runBin(["gate"], root).status, 0)
  })

  it("looks for the row to the catalogue the primitives Check reads", () => {
    const moved = { primitives: { file: "docs/primitives.json" }, "agents-map": true }
    const root = withMap({ "docs/primitives.json": "{}" }, true, { checks: moved })
    const run = runBin(["gate"], root)
    const expected =
      "AGENTS.md: agents-map: no Task Router row points at docs/primitives.json — add a row that sends an agent to the catalogue"
    assert.ok(lines(run.stdout).includes(expected), run.stdout)
  })

  it("fails each path the Task Router points at that does not exist, on its row's line", () => {
    const broken = MAP.replace("`docs/guide.md`, `docs/adr/*.md`  ", "`docs/gone.md`, `docs/decisions/*.md`")
    const run = runBin(["gate"], withMap({ "AGENTS.md": broken }))
    assert.equal(run.status, 1)
    assert.deepEqual(failures(run.stdout), [
      'AGENTS.md:13: agents-map: the Task Router points at "docs/gone.md", which does not exist — fix the path or drop it from the row',
      'AGENTS.md:13: agents-map: the Task Router points at "docs/decisions/*.md", which does not exist — fix the path or drop it from the row'
    ])
  })

  it("fails a CLAUDE.md that is missing, a file of its own or a link elsewhere, so Claude Code reads the map", () => {
    const missing = withMap()
    rmSync(join(missing, "CLAUDE.md"))
    const run = runBin(["gate"], missing)
    assert.equal(run.status, 1)
    assert.deepEqual(failures(run.stdout), [
      "CLAUDE.md: agents-map: does not exist — link it to the map: ln -s AGENTS.md CLAUDE.md"
    ])

    const file = runBin(["gate"], withMap({ "CLAUDE.md": MAP }))
    assert.equal(file.status, 1)
    assert.deepEqual(failures(file.stdout), [
      "CLAUDE.md: agents-map: is a file of its own, not a link to AGENTS.md — move what it holds into AGENTS.md, remove it, then ln -s AGENTS.md CLAUDE.md"
    ])

    const elsewhere = withMap()
    relinkClaude(elsewhere, "docs/guide.md")
    const linked = runBin(["gate"], elsewhere)
    assert.equal(linked.status, 1)
    assert.deepEqual(failures(linked.stdout), [
      'CLAUDE.md: agents-map: links to "docs/guide.md", not to AGENTS.md — remove it, then ln -s AGENTS.md CLAUDE.md'
    ])
  })

  it("fails a CLAUDE.md link to the map by an absolute path, which no other clone resolves", () => {
    const root = withMap()
    relinkClaude(root, join(root, "AGENTS.md"))
    const run = runBin(["gate"], root)
    assert.equal(run.status, 1)
    assert.deepEqual(failures(run.stdout), [
      `CLAUDE.md: agents-map: links to ${JSON.stringify(join(root, "AGENTS.md"))}, not to AGENTS.md — remove it, then ln -s AGENTS.md CLAUDE.md`
    ])
  })

  it("passes a CLAUDE.md link to the map spelled ./AGENTS.md", () => {
    const root = withMap()
    relinkClaude(root, "./AGENTS.md")
    assert.equal(runBin(["gate"], root).status, 0)
  })

  it("exits 2 when the map does not exist", () => {
    const root = withMap()
    rmSync(join(root, "AGENTS.md"))
    const run = runBin(["gate"], root)
    assert.equal(run.status, 2)
    assert.deepEqual(failures(run.stdout), [
      "AGENTS.md: agents-map: the map does not exist — write it, or point gate.checks.agents-map.file at the map"
    ])
  })
})

describe("the agents-map Check on the skills", () => {
  it("fails a skill the lock does not pin and a pin with no skill", () => {
    const root = withMap({
      ".agents/skills/grill/SKILL.md": "",
      "skills-lock.json": { version: 1, skills: { tdd: {}, gone: {} } }
    })
    link(root, "grill")
    const run = runBin(["gate"], root)
    assert.equal(run.status, 1)
    assert.deepEqual(failures(run.stdout), [
      '.agents/skills/grill: agents-map: skill "grill" is not in skills-lock.json — add it through the skills CLI, or remove the directory',
      'skills-lock.json: agents-map: locks skill "gone", which .agents/skills does not hold — restore the skill, or drop it from the lock'
    ])
  })

  it("fails a skill with no link, a link elsewhere and an entry .agents/skills does not hold", () => {
    const root = withMap({
      ".agents/skills/grill/SKILL.md": "",
      ".agents/skills/pr/SKILL.md": "",
      "skills-lock.json": { version: 1, skills: { tdd: {}, grill: {}, pr: {} } },
      ".claude/skills/own/SKILL.md": ""
    })
    link(root, "pr", "../../.agents/skills/tdd")
    const run = runBin(["gate"], root)
    assert.equal(run.status, 1)
    assert.deepEqual(failures(run.stdout), [
      '.claude/skills/grill: agents-map: skill "grill" has no link here — link it to ../../.agents/skills/grill',
      ".claude/skills/pr: agents-map: is not a link to .agents/skills/pr — link it to ../../.agents/skills/pr",
      '.claude/skills/own: agents-map: .agents/skills holds no skill "own" — remove it, or move the skill into .agents/skills'
    ])
  })

  it("fails a lock it cannot read: one with no skills object, or not JSON", () => {
    const run = runBin(["gate"], withMap({ "skills-lock.json": { version: 1 } }))
    assert.equal(run.status, 1)
    assert.deepEqual(failures(run.stdout), [
      "skills-lock.json: agents-map: not a skills lock: it has no skills object — fix it, or write it again through the skills CLI"
    ])
    const notJson = runBin(["gate"], withMap({ "skills-lock.json": "{ skills" }))
    assert.equal(notJson.status, 1)
    assert.deepEqual(failures(notJson.stdout), [
      "skills-lock.json: agents-map: not a skills lock: not JSON: Expected property name or '}' in JSON at position 2 (line 1 column 3) — fix it, or write it again through the skills CLI"
    ])
  })

  it("passes skills kept in .claude/skills itself with their lock, and a repository with no skills", () => {
    const root = repo({
      files: {
        [CONFIG]: { version: 1, gate: { checks: { "agents-map": true } } },
        ...TREE,
        ".agents/skills/tdd/SKILL.md": "",
        ".claude/skills/tdd/SKILL.md": ""
      }
    })
    symlinkSync("AGENTS.md", join(root, "CLAUDE.md"))
    rmSync(join(root, ".agents"), { recursive: true })
    assert.equal(runBin(["gate"], root).status, 0)
    rmSync(join(root, ".claude"), { recursive: true })
    rmSync(join(root, "skills-lock.json"))
    assert.equal(runBin(["gate"], root).status, 0)
  })
})

describe("the agents-map Check's options", () => {
  it("holds CLAUDE.md to a link to the map the file option names, and to nothing when that map is CLAUDE.md", () => {
    const moved = withMap({ "docs/map.md": MAP }, { file: "docs/map.md" })
    const run = runBin(["gate"], moved)
    assert.equal(run.status, 1)
    assert.deepEqual(failures(run.stdout), [
      'CLAUDE.md: agents-map: links to "AGENTS.md", not to docs/map.md — remove it, then ln -s docs/map.md CLAUDE.md'
    ])
    relinkClaude(moved, "docs/map.md")
    assert.equal(runBin(["gate"], moved).status, 0)

    const own = withMap({ "CLAUDE.md": MAP }, { file: "CLAUDE.md" })
    rmSync(join(own, "AGENTS.md"))
    assert.equal(runBin(["gate"], own).status, 0)
  })

  it("reads the map from file and holds it to maxLines and maxBytes", () => {
    const root = withMap({ "CLAUDE.md": MAP }, { file: "CLAUDE.md", maxLines: 10, maxBytes: 100 })
    rmSync(join(root, "AGENTS.md"))
    const run = runBin(["gate"], root)
    assert.equal(run.status, 1)
    assert.deepEqual(failures(run.stdout), [
      "CLAUDE.md: agents-map: 16 lines, over the 10-line budget — cut it, or move a topic into a doc a Task Router row points at",
      "CLAUDE.md: agents-map: 431 bytes, over the 100-byte budget — cut it, or move a topic into a doc a Task Router row points at"
    ])
  })
})
