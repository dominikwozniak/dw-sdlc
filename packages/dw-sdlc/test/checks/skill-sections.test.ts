// The `skill-sections` Check through `dw-sdlc check` and `dw-sdlc gate`, and `dw-sdlc check skill-sections
// --write`, on a throwaway repository whose skills copy sections of their unit's README: the exit code,
// each failure line word for word, and the skill file the write leaves.

import assert from "node:assert/strict"
import { readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"

import { lines, repo, runBin } from "../harness.ts"

const CONFIG = ".ai/agentic.config.json"
const SKILL = "packages/a/skills/fixture-a/SKILL.md"

function catalogue(...docs: string[]): object {
  return {
    version: 1,
    groups: [{ id: "unit", name: "Unit" }],
    primitives: [{ id: "unit.a", name: "a", group: "unit", summary: "The unit a.", code: ["packages/a"], docs }]
  }
}

function readme(errors: string): string {
  return `# @fixture/a\n\nIntro.\n\n## Errors\n\n${errors}\n\n## License\n\nMIT\n`
}

function part(anchor: string, body: string): string {
  return `<!-- README.md#${anchor} -->\n\n${body}\n\n<!-- /README.md#${anchor} -->`
}

/** A repository whose skill copies the Errors section of its README; `files` over it. */
function withSkill(files: Record<string, string | object> = {}, checks: object = { "skill-sections": true }): string {
  return repo({
    files: {
      [CONFIG]: { version: 1, gate: { checks } },
      ".ai/primitives.json": catalogue("packages/a/README.md#errors"),
      "packages/a/README.md": readme("Old text."),
      [SKILL]: `# Skill\n\n${part("errors", "## Errors\n\nOld text.")}\n\nOwn text.\n`,
      ...files
    }
  })
}

/** `dw-sdlc check skill-sections` on `root`, with `args` after it: its exit code and its failure lines, the verdict cut. */
function sections(root: string, ...args: string[]): { status: number; failures: string[] } {
  const run = runBin(["check", "skill-sections", ...args], root)
  const failures = lines(run.stdout).filter((line) => !line.startsWith("check skill-sections: "))
  return { status: run.status, failures }
}

function read(root: string, path: string): string {
  return readFileSync(join(root, path), "utf8")
}

const STALE =
  "differs from that section of packages/a/README.md — edit the README, not the part, then run dw-sdlc check skill-sections --write"

describe("the skill-sections Check", () => {
  it("passes a part that matches its README section, and fails it once the README changes under it", () => {
    const root = withSkill()
    assert.deepEqual(sections(root), { status: 0, failures: [] })
    const changed = withSkill({ "packages/a/README.md": readme("New text.") })
    assert.deepEqual(sections(changed), {
      status: 1,
      failures: [`${SKILL}:3: skill-sections: the part from README.md#errors ${STALE}`]
    })
  })

  it("fails a part whose anchor names no heading of the README, and one that reads a README that does not exist", () => {
    const root = withSkill({
      ".ai/primitives.json": catalogue("packages/a/README.md#errors", "packages/b/README.md#errors"),
      "packages/a/README.md": "# @fixture/a\n\n## Error codes\n\nText.\n",
      "packages/b/skills/fixture-b/SKILL.md": `${part("errors", "## Errors")}\n`
    })
    assert.deepEqual(sections(root), {
      status: 1,
      failures: [
        `${SKILL}:3: skill-sections: the part from README.md#errors names no heading of packages/a/README.md — point it at a heading the README has`,
        "packages/b/skills/fixture-b/SKILL.md:1: skill-sections: the part from README.md#errors reads packages/b/README.md, which does not exist — write the README, or drop the part"
      ]
    })
  })

  it("fails a part from a section no Primitive's docs name, the README named whole or another README's section aside", () => {
    const root = withSkill({
      ".ai/primitives.json": catalogue("packages/a/README.md", "packages/b/README.md#errors")
    })
    assert.deepEqual(sections(root), {
      status: 1,
      failures: [
        `${SKILL}:3: skill-sections: the part from README.md#errors copies a section no Primitive's docs name — name packages/a/README.md#errors in a Primitive's docs, or point the part at a section they name`
      ]
    })
  })

  it("fails a marker without its pair, a mistyped one included, and reads the part after it", () => {
    const skill =
      "<!-- README.md#errors -->\n\n## Errors\n\nOld text.\n\n<!-- /README.md#error -->\n\n" +
      "<!-- README.md#license-->\n\n## License\n\nMIT\n\n<!-- /README.md#license -->\n\n" +
      `${part("errors", "## Errors\n\nOld text.")}\n`
    const root = withSkill({ [SKILL]: skill })
    const remedy =
      "open a part with <!-- README.md#<anchor> --> and close it with <!-- /README.md#<anchor> -->, each on its own line"
    assert.deepEqual(sections(root), {
      status: 1,
      failures: [
        `${SKILL}:1: skill-sections: the opening marker of README.md#errors has no closing marker — ${remedy}`,
        `${SKILL}:7: skill-sections: the closing marker of README.md#error has no opening marker — ${remedy}`,
        `${SKILL}:15: skill-sections: the closing marker of README.md#license has no opening marker — ${remedy}`
      ]
    })
  })

  it("reads no marker inside code, so a skill can show the syntax", () => {
    const skill = "# Skill\n\nOpen with `<!-- README.md#errors -->`.\n\n```md\n<!-- /README.md#errors -->\n```\n"
    assert.deepEqual(sections(withSkill({ [SKILL]: skill })), { status: 0, failures: [] })
  })

  it("fails a code fence that never closes, so the parts after it are never left unread", () => {
    const skill = `# Skill\n\n\`\`\`sh\npnpm test\n\n${part("errors", "## Errors\n\nStale.")}\n`
    assert.deepEqual(sections(withSkill({ [SKILL]: skill })), {
      status: 1,
      failures: [
        `${SKILL}:3: skill-sections: a code fence opens here and never closes, so no marker after it is read — close the fence`
      ]
    })
  })

  it("passes a repository with no skills, and skills with no part, without reading the catalogue", () => {
    const bare = repo({ files: { [CONFIG]: { version: 1, gate: { checks: { "skill-sections": true } } } } })
    assert.deepEqual(sections(bare), { status: 0, failures: [] })
    const noParts = repo({
      files: {
        [CONFIG]: { version: 1, gate: { checks: { "skill-sections": true } } },
        [SKILL]: "# Skill\n\nOwn text.\n",
        ".ai/primitives.json": "not JSON"
      }
    })
    assert.deepEqual(sections(noParts), { status: 0, failures: [] })
  })

  it("exits 2 when a skill holds a part and the catalogue is missing or not valid", () => {
    const missing = withSkill()
    rmSync(join(missing, ".ai/primitives.json"))
    assert.deepEqual(sections(missing), {
      status: 2,
      failures: [
        ".ai/primitives.json: skill-sections: the catalogue does not exist, and a skill holds a part — create it, or point gate.checks.primitives.file at the catalogue"
      ]
    })
    const invalid = withSkill({ ".ai/primitives.json": { version: 2 } })
    assert.deepEqual(sections(invalid), {
      status: 2,
      failures: [
        ".ai/primitives.json: skill-sections: the catalogue is not valid, and a skill holds a part — fix what dw-sdlc check primitives names"
      ]
    })
  })

  it("reads the README beside the skills directory, at the root too, and skips skills under a dot directory", () => {
    const root = withSkill({
      ".ai/primitives.json": catalogue("README.md#errors", "packages/a/README.md#errors"),
      "README.md": readme("Root text."),
      "skills/root/SKILL.md": `${part("errors", "## Errors\n\nRoot text.")}\n`,
      "packages/a/skills/fixture-a/references/more.md": `${part("errors", "## Errors\n\nOld text.")}\n`,
      ".agents/skills/vendored/SKILL.md": `${part("errors", "## Errors\n\nStale.")}\n`
    })
    assert.deepEqual(sections(root), { status: 0, failures: [] })
  })

  it("runs last in the Gate", () => {
    const run = runBin(["gate", "--json"], withSkill({}, { "skill-sections": true, "markdown-refs": true }))
    assert.deepEqual(
      JSON.parse(run.stdout).checks.map(({ name }: { name: string }) => name),
      ["markdown-refs", "skill-sections"]
    )
  })
})

describe("the skill-sections Check's options", () => {
  it("judges the skill files files matches, a list replacing the default", () => {
    const root = withSkill(
      { "docs/agent/guide.md": `${part("errors", "## Errors\n\nStale.")}\n` },
      { "skill-sections": { files: ["docs/agent/*.md"] } }
    )
    assert.deepEqual(sections(root), {
      status: 1,
      failures: [
        "docs/agent/guide.md:1: skill-sections: the part from README.md#errors copies a section no Primitive's docs name — name docs/agent/README.md#errors in a Primitive's docs, or point the part at a section they name"
      ]
    })
  })

  it("reads the catalogue primitives reads", () => {
    const root = withSkill(
      { ".ai/catalogue.json": catalogue("packages/a/README.md#errors") },
      { "skill-sections": true, primitives: { file: ".ai/catalogue.json" } }
    )
    rmSync(join(root, ".ai/primitives.json"))
    assert.deepEqual(sections(root), { status: 0, failures: [] })
  })

  it("stays off under false and when the config leaves it out", () => {
    const stale = { "packages/a/README.md": readme("New text.") }
    for (const checks of [{ "skill-sections": false }, {}]) {
      const run = runBin(["gate", "--json"], withSkill(stale, checks))
      assert.equal(run.status, 0, run.stdout)
      assert.deepEqual(JSON.parse(run.stdout).checks, [])
    }
  })
})

describe("dw-sdlc check skill-sections --write", () => {
  it("writes a part from its README section, keeps the skill's own text, and then passes", () => {
    const root = withSkill({ "packages/a/README.md": readme("New text.") })
    const run = runBin(["check", "skill-sections", "--write"], root)
    assert.equal(run.status, 0, run.stdout)
    assert.deepEqual(lines(run.stdout), [
      "check skill-sections: wrote 1 part in 1 file",
      "check skill-sections: green — 0 steps, 1 check"
    ])
    assert.equal(read(root, SKILL), `# Skill\n\n${part("errors", "## Errors\n\nNew text.")}\n\nOwn text.\n`)
    assert.deepEqual(sections(root), { status: 0, failures: [] })
  })

  it("fills an empty pair with its section: its subsections, a heading in a fence not one, by GitHub's anchor", () => {
    const hook = "### `useThing`, its hook\n\nText."
    const hooks = `## Hooks\n\n\`\`\`sh\n# a comment, not a heading\n\`\`\`\n\n${hook}`
    const root = withSkill({
      ".ai/primitives.json": catalogue("packages/a/README.md#hooks", "packages/a/README.md#usething-its-hook"),
      "packages/a/README.md": `# @fixture/a\n\n${hooks}\n\n## Errors\n\nText.\n`,
      [SKILL]:
        "<!-- README.md#hooks -->\n<!-- /README.md#hooks -->\n\n" +
        "<!-- README.md#usething-its-hook -->\n<!-- /README.md#usething-its-hook -->\n"
    })
    const run = runBin(["check", "skill-sections", "--write"], root)
    assert.equal(run.status, 0, run.stdout)
    assert.equal(lines(run.stdout)[0], "check skill-sections: wrote 2 parts in 1 file")
    assert.equal(read(root, SKILL), `${part("hooks", hooks)}\n\n${part("usething-its-hook", hook)}\n`)
  })

  it("leaves a part it cannot write and reports it, and writes nothing on a tree that matches", () => {
    const content = `${part("errors", "## Errors\n\nOld text.")}\n`
    const root = withSkill({ "packages/a/README.md": "# @fixture/a\n\n## Error codes\n", [SKILL]: content })
    const run = runBin(["check", "skill-sections", "--write"], root)
    assert.equal(run.status, 1, run.stdout)
    assert.deepEqual(lines(run.stdout), [
      "check skill-sections: every part matches its section, so nothing was written",
      `${SKILL}:1: skill-sections: the part from README.md#errors names no heading of packages/a/README.md — point it at a heading the README has`,
      "check skill-sections: failed — 1 failure"
    ])
    assert.equal(read(root, SKILL), content)
  })

  it("writes on the Check's defaults where the config leaves it off, and says so on stderr under --json", () => {
    const root = withSkill({ "packages/a/README.md": readme("New text.") }, {})
    const run = runBin(["check", "skill-sections", "--write", "--json"], root)
    assert.equal(run.status, 0, run.stdout)
    assert.equal(run.stderr, "check skill-sections: wrote 1 part in 1 file\n")
    assert.equal(JSON.parse(run.stdout).status, "pass")
  })

  it("exits 2 on a Check that derives no file, and writes nothing on a missing catalogue", () => {
    const root = withSkill()
    const refused = runBin(["check", "markdown-refs", "--write"], root)
    assert.equal(refused.status, 2)
    assert.equal(refused.stderr, 'dw-sdlc check: "markdown-refs" takes no --write: it derives no file\n')
    const unknown = runBin(["check", "nope", "--write"], root)
    assert.equal(unknown.status, 2)
    assert.match(unknown.stdout, /^check: no Check is named "nope" — name one of /)
    const stale = `# Skill\n\n${part("errors", "## Errors\n\nStale.")}\n`
    const missing = withSkill({ [SKILL]: stale })
    rmSync(join(missing, ".ai/primitives.json"))
    assert.equal(sections(missing, "--write").status, 2)
    assert.equal(read(missing, SKILL), stale)
  })
})
