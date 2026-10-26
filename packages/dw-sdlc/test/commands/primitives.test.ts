// `dw-sdlc primitives --paths` spawned on a throwaway repository with a catalogue: for each path the
// Primitives that name it, plain and as JSON, and a path none names.

import assert from "node:assert/strict"
import { symlinkSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"

import { repo, runBin, scratch } from "../harness.ts"

const CATALOGUE = ".ai/primitives.json"

const HOOK = {
  id: "hooks.hello",
  name: "Hello hook",
  group: "hooks",
  summary: "Says hello at session start.",
  code: ["plugins/demo/hooks/hello.sh"],
  docs: ["docs/demo.md#the-hello-hook", "docs/demo.md"]
}
const PLUGIN = {
  id: "distribution.demo",
  name: "demo plugin",
  group: "distribution",
  summary: "The demo plugin, whatever no other Primitive names in it.",
  code: ["plugins/demo/"],
  docs: ["docs/demo.md#releasing-it"]
}
const KEY = {
  id: "config.hello",
  name: "hello key",
  group: "config",
  summary: "Whom the hook greets.",
  code: ["config/schema.json"],
  docs: ["docs/config.md"]
}
const SCHEMA = { ...KEY, id: "config.file", name: "Config file", summary: "The schema of the config." }

const PATHS = ["plugins/demo/hooks/hello.sh", "plugins/demo/README.md", "config/schema.json", "tools/x.sh"]

function withCatalogue(files: Record<string, string | object> = {}): string {
  const catalogue = { version: 1, groups: [], primitives: [HOOK, PLUGIN, KEY, SCHEMA] }
  return repo({ files: { [CATALOGUE]: catalogue, ...files } })
}

function lines(text: string): string[] {
  return text.split("\n").filter((line) => line !== "")
}

describe("dw-sdlc primitives --paths", () => {
  it("prints for each path the Primitives that name it nearest, with their documents, and says when none does", () => {
    const run = runBin(["primitives", "--paths", ...PATHS], withCatalogue())
    assert.equal(run.status, 0, run.stderr)
    assert.deepEqual(lines(run.stdout), [
      "plugins/demo/hooks/hello.sh: hooks.hello (Hello hook) — Says hello at session start.",
      "  read: docs/demo.md#the-hello-hook, docs/demo.md",
      "plugins/demo/README.md: distribution.demo (demo plugin) — The demo plugin, whatever no other Primitive names in it.",
      "  read: docs/demo.md#releasing-it",
      "config/schema.json: config.hello (hello key) — Whom the hook greets.",
      "  read: docs/config.md",
      "config/schema.json: config.file (Config file) — The schema of the config.",
      "  read: docs/config.md",
      "tools/x.sh: no Primitive names this path"
    ])
  })

  it("prints the same as one document under --json", () => {
    const run = runBin(["primitives", "--json", "--paths", ...PATHS], withCatalogue())
    assert.equal(run.status, 0, run.stderr)
    const brief = ({ id, name, summary, docs }: typeof HOOK) => ({ id, name, summary, docs })
    assert.deepEqual(JSON.parse(run.stdout), {
      paths: [
        { path: "plugins/demo/hooks/hello.sh", primitives: [brief(HOOK)] },
        { path: "plugins/demo/README.md", primitives: [brief(PLUGIN)] },
        { path: "config/schema.json", primitives: [brief(KEY), brief(SCHEMA)] },
        { path: "tools/x.sh", primitives: [] }
      ]
    })
  })

  it("reads a path from the current directory and prints it as given", () => {
    const root = withCatalogue({ "plugins/demo/hooks/hello.sh": "echo hello\n" })
    const run = runBin(["primitives", "--paths", "hooks/hello.sh", "../../../outside.txt"], join(root, "plugins/demo"))
    assert.equal(run.status, 0, run.stderr)
    assert.deepEqual(lines(run.stdout), [
      "hooks/hello.sh: hooks.hello (Hello hook) — Says hello at session start.",
      "  read: docs/demo.md#the-hello-hook, docs/demo.md",
      "../../../outside.txt: no Primitive names this path"
    ])
  })

  it("names a path given through a symbolic link to the repository, a deleted file included", () => {
    const root = withCatalogue({ "plugins/demo/hooks/hello.sh": "echo hello\n" })
    const link = join(scratch("link"), "repo")
    symlinkSync(root, link)
    const hello = join(link, "plugins/demo/hooks/hello.sh")
    const gone = join(link, "plugins/demo/hooks/gone.sh")
    const run = runBin(["primitives", "--paths", hello, gone], link)
    assert.equal(run.status, 0, run.stderr)
    assert.deepEqual(lines(run.stdout), [
      `${hello}: hooks.hello (Hello hook) — Says hello at session start.`,
      "  read: docs/demo.md#the-hello-hook, docs/demo.md",
      `${gone}: distribution.demo (demo plugin) — The demo plugin, whatever no other Primitive names in it.`,
      "  read: docs/demo.md#releasing-it"
    ])
  })

  it("reads the catalogue the primitives Check reads, in the repository --root names", () => {
    const config = { version: 1, gate: { checks: { primitives: { file: "docs/primitives.json" } } } }
    const root = repo({
      files: {
        ".ai/agentic.config.json": config,
        "docs/primitives.json": { version: 1, groups: [], primitives: [HOOK] }
      }
    })
    const run = runBin(
      ["primitives", "--root", root, "--json", "--paths", join(root, "plugins/demo/hooks/hello.sh")],
      scratch("cwd")
    )
    assert.equal(run.status, 0, run.stderr)
    assert.equal(JSON.parse(run.stdout).paths[0].primitives[0].id, "hooks.hello")
  })

  it("exits 2 when there is no catalogue to read, or it is not one", () => {
    const missing = runBin(["primitives", "--paths", "x"], repo())
    assert.equal(missing.status, 2)
    assert.deepEqual(lines(missing.stderr), [
      `dw-sdlc primitives: ${CATALOGUE}: the catalogue does not exist — create it, or point gate.checks.primitives.file at the catalogue`
    ])
    const invalid = runBin(
      ["primitives", "--paths", "x"],
      repo({ files: { [CATALOGUE]: { version: 2, groups: [], primitives: [] } } })
    )
    assert.equal(invalid.status, 2)
    assert.deepEqual(lines(invalid.stderr), [
      `dw-sdlc primitives: ${CATALOGUE}: version: 2 is not 1 — fix the catalogue; dw-sdlc gate names each problem under the primitives Check`
    ])
  })

  it("exits 2 with its usage without --paths", () => {
    const run = runBin(["primitives", "plugins/demo/hooks/hello.sh"], withCatalogue())
    assert.equal(run.status, 2)
    assert.ok(run.stderr.startsWith("dw-sdlc primitives: name the paths with --paths\n"), run.stderr)
    assert.match(run.stderr, /Usage: dw-sdlc primitives/)
  })

  it("is a command the bin lists", () => {
    const run = runBin(["--help"], scratch("bin"))
    assert.match(run.stdout, /^ {2}primitives +name the Primitives/m)
  })
})
