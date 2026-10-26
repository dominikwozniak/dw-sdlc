// The `primitives` Check through `dw-sdlc gate`, on a throwaway repository whose catalogue breaks one
// rule at a time: the exit code and each failure line word for word.

import assert from "node:assert/strict"
import { chmodSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"

import { repo, runBin } from "../harness.ts"

const CONFIG = ".ai/agentic.config.json"
const CATALOGUE = ".ai/primitives.json"

const HOOK = {
  id: "hooks.hello",
  name: "Hello hook",
  group: "hooks",
  summary: "Says hello at session start.",
  code: ["plugins/demo/hooks/hello.sh"],
  docs: ["docs/demo.md#the-hello-hook", "docs/demo.md"]
}
const MANIFEST = {
  id: "distribution.demo",
  name: "demo plugin",
  group: "distribution",
  summary: "The manifest and the README of the demo plugin.",
  code: ["plugins/demo/.claude-plugin/", "plugins/demo/README.md"],
  docs: ["docs/demo.md#releasing-it"]
}
const GROUPS = [
  { id: "hooks", name: "Hooks" },
  { id: "distribution", name: "Distribution" }
]

/** The tree `HOOK` and `MANIFEST` name, a test beside the hook, and the doc both point at. */
const TREE = {
  "plugins/demo/hooks/hello.sh": "echo hello\n",
  "plugins/demo/.claude-plugin/plugin.json": "{}",
  "plugins/demo/README.md": "# demo\n",
  "plugins/demo/test/hello.test.ts": "// a test needs no Primitive\n",
  "docs/demo.md": "# Demo\n\n## The `hello` hook\n\n```md\n## Not a heading\n```\n\n## Releasing it\n"
}

/** A repository with `primitives` set to `setting` under gate.checks, the catalogue at `CATALOGUE`. */
function withCatalogue(
  document: string | object,
  files: Record<string, string | object> = {},
  setting: unknown = true
) {
  const config = { version: 1, gate: { checks: { primitives: setting } } }
  return repo({ files: { [CONFIG]: config, [CATALOGUE]: document, ...TREE, ...files } })
}

function catalogue(primitives: unknown[] = [HOOK, MANIFEST]): object {
  return { version: 1, groups: GROUPS, primitives }
}

function lines(text: string): string[] {
  return text.split("\n").filter((line) => line !== "")
}

/** The failure lines of a Gate run that ran the one Check, its own `gate: check` line and the verdict cut. */
function failures(stdout: string): string[] {
  return lines(stdout).slice(1, -1)
}

describe("the primitives Check", () => {
  it("passes a catalogue whose ids, groups, summaries, code and docs hold and that names every file", () => {
    const run = runBin(["gate"], withCatalogue(catalogue()))
    assert.equal(run.status, 0, run.stdout)
    assert.deepEqual(lines(run.stdout), ["gate: check primitives", "gate: green — 0 steps, 1 check"])
  })

  it("fails a catalogue that is not JSON, or not its shape, and judges nothing else", () => {
    const run = runBin(["gate"], withCatalogue("{ version: 1 }"))
    assert.equal(run.status, 1)
    assert.deepEqual(failures(run.stdout), [
      `${CATALOGUE}: primitives: not JSON: Expected property name or '}' in JSON at position 2 (line 1 column 3) — give it the catalogue's shape: version 1, groups of id and name, primitives of id, name, group, summary, code and docs`
    ])
    const shapeless = runBin(
      ["gate"],
      withCatalogue({ version: 1, groups: GROUPS, primitives: [{ ...HOOK, code: "x" }] })
    )
    assert.equal(shapeless.status, 1)
    assert.deepEqual(failures(shapeless.stdout), [
      `${CATALOGUE}: primitives: primitives[0].code: expected array, got "x" — give it the catalogue's shape: version 1, groups of id and name, primitives of id, name, group, summary, code and docs`
    ])
  })

  it("fails an id that an earlier Primitive took, on the line of the later one", () => {
    const run = runBin(["gate"], withCatalogue(JSON.stringify(catalogue([HOOK, MANIFEST, HOOK]), null, 2)))
    assert.equal(run.status, 1)
    assert.deepEqual(failures(run.stdout), [
      `${CATALOGUE}:41: primitives: id "hooks.hello" is taken by an earlier Primitive — give each Primitive an id of its own`
    ])
  })

  it("fails a group that groups does not list", () => {
    const run = runBin(["gate"], withCatalogue(catalogue([{ ...HOOK, group: "guards" }, MANIFEST])))
    assert.equal(run.status, 1)
    assert.deepEqual(failures(run.stdout), [
      `${CATALOGUE}:1: primitives: "hooks.hello" is in group "guards", which groups does not list — add the group to groups, or move the Primitive into one listed there`
    ])
  })

  it("fails a summary over 120 characters or over one line", () => {
    const long = { ...HOOK, summary: "x".repeat(121) }
    const twoLines = { ...MANIFEST, summary: "The manifest.\nAnd the README." }
    const run = runBin(["gate"], withCatalogue(catalogue([long, twoLines])))
    assert.equal(run.status, 1)
    assert.deepEqual(failures(run.stdout), [
      `${CATALOGUE}:1: primitives: the summary of "hooks.hello" is 121 characters, over 120 — keep the summary to one line of 120 characters or fewer`,
      `${CATALOGUE}:1: primitives: the summary of "distribution.demo" runs over 2 lines — keep the summary to one line of 120 characters or fewer`
    ])
  })

  it("passes a summary of exactly 120 characters", () => {
    const run = runBin(["gate"], withCatalogue(catalogue([{ ...HOOK, summary: "é".repeat(120) }, MANIFEST])))
    assert.equal(run.status, 0, run.stdout)
  })

  it("fails a code path that does not exist", () => {
    const moved = { ...HOOK, code: ["plugins/demo/hooks/hello.sh", "plugins/demo/hooks/gone.sh"] }
    const run = runBin(["gate"], withCatalogue(catalogue([moved, MANIFEST])))
    assert.equal(run.status, 1)
    assert.deepEqual(failures(run.stdout), [
      `${CATALOGUE}:1: primitives: "hooks.hello" names code at "plugins/demo/hooks/gone.sh", which does not exist — fix the path or drop it`
    ])
  })

  it("fails a doc that does not exist and an anchor no heading has, a heading inside a code fence included", () => {
    const docs = [
      "docs/gone.md",
      "docs/demo.md#releasing",
      "docs/demo.md#not-a-heading",
      "docs#intro",
      "docs/demo.md#the-hello-hook"
    ]
    const run = runBin(["gate"], withCatalogue(catalogue([{ ...HOOK, docs }, MANIFEST])))
    assert.equal(run.status, 1)
    assert.deepEqual(failures(run.stdout), [
      `${CATALOGUE}:1: primitives: "hooks.hello" names the doc "docs/gone.md", which does not exist — fix the path or drop it`,
      `${CATALOGUE}:1: primitives: "hooks.hello" names the doc "docs/demo.md#releasing", which has no heading with that anchor — point the entry at a heading the file has`,
      `${CATALOGUE}:1: primitives: "hooks.hello" names the doc "docs/demo.md#not-a-heading", which has no heading with that anchor — point the entry at a heading the file has`,
      `${CATALOGUE}:1: primitives: "hooks.hello" names the doc "docs#intro", which has no heading with that anchor — point the entry at a heading the file has`
    ])
  })

  it("reports a Primitive on its own line when a group has the same id", () => {
    const moved = { ...HOOK, id: "hooks", code: ["plugins/demo/hooks/hello.sh", "plugins/demo/hooks/gone.sh"] }
    const run = runBin(["gate"], withCatalogue(JSON.stringify(catalogue([moved, MANIFEST]), null, 2)))
    assert.deepEqual(failures(run.stdout), [
      `${CATALOGUE}:15: primitives: "hooks" names code at "plugins/demo/hooks/gone.sh", which does not exist — fix the path or drop it`
    ])
  })

  it("fails each file under a root that no Primitive names, with a line naming the file", () => {
    const root = withCatalogue(catalogue(), { "plugins/demo/hooks/new.sh": "echo new\n", "plugins/other/skill.md": "" })
    const run = runBin(["gate"], root)
    assert.equal(run.status, 1)
    assert.deepEqual(failures(run.stdout), [
      `plugins/demo/hooks/new.sh: primitives: no Primitive names this file — name it, or a directory above it, in the code of a Primitive in ${CATALOGUE}`,
      `plugins/other/skill.md: primitives: no Primitive names this file — name it, or a directory above it, in the code of a Primitive in ${CATALOGUE}`
    ])
  })

  it("leaves out an ignored file and the files outside the roots", () => {
    const root = withCatalogue(catalogue(), { ".gitignore": "*.log\n", "plugins/demo/debug.log": "", "tools/x.sh": "" })
    const run = runBin(["gate"], root)
    assert.equal(run.status, 0, run.stdout)
  })

  it("exits 2 when the catalogue does not exist", () => {
    const root = repo({ files: { [CONFIG]: { version: 1, gate: { checks: { primitives: true } } } } })
    const run = runBin(["gate"], root)
    assert.equal(run.status, 2)
    assert.deepEqual(lines(run.stdout), [
      "gate: check primitives",
      `${CATALOGUE}: primitives: the catalogue does not exist — create it, or point gate.checks.primitives.file at the catalogue`,
      "gate: cannot run — 1 failure"
    ])
  })

  it("exits 2 outside a git repository, where it cannot list the files under the roots", () => {
    const config = { version: 1, gate: { checks: { primitives: true } } }
    const root = repo({ git: false, files: { [CONFIG]: config, [CATALOGUE]: catalogue(), ...TREE } })
    const run = runBin(["gate"], root)
    assert.equal(run.status, 2)
    assert.deepEqual(failures(run.stdout), [
      "primitives: cannot list the files under packages, plugins, scripts, src: not a git repository — run the Gate inside a git repository"
    ])
  })

  it("exits 2 when it cannot read the catalogue", { skip: process.getuid?.() === 0 }, () => {
    const root = withCatalogue(catalogue())
    chmodSync(join(root, CATALOGUE), 0o000)
    const run = runBin(["gate"], root)
    assert.equal(run.status, 2)
    const [line = ""] = failures(run.stdout)
    assert.ok(line.startsWith("primitives: stopped: EACCES: permission denied"), line)
    assert.ok(line.endsWith(" — fix what stopped it, or report it to dw-sdlc"), line)
  })
})

describe("the primitives Check's options", () => {
  it("reads the catalogue from file and names the files under roots", () => {
    const root = withCatalogue(
      {},
      { "docs/catalogue.json": catalogue(), "tools/x.sh": "" },
      { file: "docs/catalogue.json", roots: ["tools"] }
    )
    const run = runBin(["gate"], root)
    assert.equal(run.status, 1)
    assert.deepEqual(failures(run.stdout), [
      "tools/x.sh: primitives: no Primitive names this file — name it, or a directory above it, in the code of a Primitive in docs/catalogue.json"
    ])
  })

  it("stays off under false", () => {
    const run = runBin(["gate"], withCatalogue({}, {}, false))
    assert.equal(run.status, 0, run.stdout)
    assert.deepEqual(lines(run.stdout), ["gate: green — 0 steps, 0 checks"])
  })
})
