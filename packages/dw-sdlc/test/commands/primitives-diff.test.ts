// `dw-sdlc primitives --diff` spawned on a throwaway repository with a base commit and a head commit:
// the block, the JSON and the exit code for each class, a file with two owners, a change outside every
// Primitive, no catalogue at base, and every case it cannot answer.

import assert from "node:assert/strict"
import { rmSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"

import { commit, git, lines, repo, runBin, write } from "../harness.ts"

const CATALOGUE = ".ai/primitives.json"
const START = "<!-- primitives:start -->"
const END = "<!-- primitives:end -->"

function primitive(id: string, code: string[], docs: string[] = ["docs/demo.md#the-hook"]) {
  const name = `${id} name`
  return { id, name, group: id.split(".")[0], summary: `What ${id} does.`, code, docs }
}

const HOOK = primitive("hooks.hello", ["plugins/demo/hooks/hello.sh"])
const GREETER = primitive("hooks.greeter", ["plugins/demo/hooks/greeter.sh"], ["docs/greeter.md"])
const CONFIG = primitive("config.file", ["config/schema.json"], ["docs/config.md#schema", "docs/demo.md"])
const KEY = primitive("config.key", ["config/schema.json"], ["docs/config.md"])
const CACHE = primitive("gate.cache", ["src/cache.ts"], ["docs/cache.md"])

function catalogue(...primitives: object[]): object {
  return { version: 1, groups: [], primitives }
}

const BASE_FILES = {
  "plugins/demo/hooks/hello.sh": "echo hello\n",
  "plugins/demo/hooks/greeter.sh": "echo greet\n",
  "config/schema.json": "{}\n",
  "docs/demo.md": "# Demo\n",
  "docs/config.md": "# Config\n",
  "package.json": "{}\n"
}

/** A repository on `main` holding `base`, then a branch `feat` where `change` runs and its work is committed. */
function history(base: Record<string, string | object>, change: (root: string) => void): string {
  const root = repo({ files: base })
  git(root, "symbolic-ref", "HEAD", "refs/heads/main")
  git(root, "add", "-A")
  commit(root, "-m", "base")
  git(root, "switch", "-q", "-c", "feat")
  change(root)
  git(root, "add", "-A")
  commit(root, "--allow-empty", "-m", "change")
  return root
}

function overwrite(root: string, files: Record<string, string | object>): void {
  for (const [file, content] of Object.entries(files)) {
    write(join(root, file), typeof content === "string" ? content : JSON.stringify(content))
  }
}

const changed = () =>
  history({ ...BASE_FILES, [CATALOGUE]: catalogue(HOOK, GREETER, CONFIG, KEY) }, (dir) => {
    overwrite(dir, {
      [CATALOGUE]: catalogue(HOOK, CONFIG, KEY, CACHE),
      "plugins/demo/hooks/hello.sh": "echo hello again\n",
      "config/schema.json": '{ "changed": true }\n',
      "docs/demo.md": "# Demo\n\nChanged.\n",
      "src/cache.ts": "export {}\n",
      "package.json": '{ "private": true }\n'
    })
    rmSync(join(dir, "plugins/demo/hooks/greeter.sh"))
  })

/** A Primitive as `--diff --json` prints it. */
function brief(
  { id, name, summary }: ReturnType<typeof primitive>,
  kind: string,
  files: number,
  docs: [string, boolean][]
): object {
  return { id, name, class: kind, files, summary, docs: docs.map(([entry, touched]) => ({ entry, touched })) }
}
describe("dw-sdlc primitives --diff", () => {
  it("prints a block counting each class, then a row per Primitive: removes, adds, extends, each by id", () => {
    const run = runBin(["primitives", "--diff", "main"], changed())
    assert.equal(run.status, 0, run.stderr)
    assert.deepEqual(lines(run.stdout), [
      START,
      "**Removes 1 Primitive, adds 1, extends 3.** 3 files outside the catalogue.",
      "| Primitive | Class | Files |",
      "| --- | --- | --- |",
      "| `hooks.greeter` (hooks.greeter name) | removes | 1 |",
      "| `gate.cache` (gate.cache name) | adds | 1 |",
      "| `config.file` (config.file name) | extends | 1 |",
      "| `config.key` (config.key name) | extends | 1 |",
      "| `hooks.hello` (hooks.hello name) | extends | 1 |",
      END
    ])
  })

  it("prints the same under --json, each doc with whether the change touches its file", () => {
    const run = runBin(["primitives", "--diff", "main", "--json"], changed())
    assert.equal(run.status, 0, run.stderr)
    assert.deepEqual(JSON.parse(run.stdout), {
      base: "main",
      primitives: [
        brief(GREETER, "removes", 1, [["docs/greeter.md", false]]),
        brief(CACHE, "adds", 1, [["docs/cache.md", false]]),
        brief(CONFIG, "extends", 1, [
          ["docs/config.md#schema", false],
          ["docs/demo.md", true]
        ]),
        brief(KEY, "extends", 1, [["docs/config.md", false]]),
        brief(HOOK, "extends", 1, [["docs/demo.md#the-hook", true]])
      ],
      outside: 3
    })
  })

  it("says no Primitive changes when the change touches none, counting no file", () => {
    const dir = history({ ...BASE_FILES, [CATALOGUE]: catalogue(HOOK) }, (path) => {
      overwrite(path, { "package.json": '{ "private": true }\n', "pnpm-lock.yaml": "lock\n" })
    })
    const run = runBin(["primitives", "--diff", "main"], dir)
    assert.equal(run.status, 0, run.stderr)
    assert.deepEqual(lines(run.stdout), [START, "No Primitive changes.", END])
    const json = JSON.parse(runBin(["primitives", "--diff", "main", "--json"], dir).stdout)
    assert.deepEqual(json, { base: "main", primitives: [], outside: 2 })
  })

  it("reads a rename as a removes and an adds", () => {
    const dir = history({ ...BASE_FILES, [CATALOGUE]: catalogue(HOOK) }, (path) => {
      overwrite(path, { [CATALOGUE]: catalogue({ ...HOOK, id: "hooks.hi" }) })
    })
    const run = runBin(["primitives", "--diff", "main"], dir)
    assert.deepEqual(lines(run.stdout), [
      START,
      "**Removes 1 Primitive, adds 1.** 1 file outside the catalogue.",
      "| Primitive | Class | Files |",
      "| --- | --- | --- |",
      "| `hooks.hello` (hooks.hello name) | removes | 0 |",
      "| `hooks.hi` (hooks.hello name) | adds | 0 |",
      END
    ])
  })

  it("adds every Primitive when the base has no catalogue", () => {
    const dir = history(BASE_FILES, (path) => {
      overwrite(path, { [CATALOGUE]: catalogue(HOOK, KEY), "plugins/demo/hooks/hello.sh": "echo again\n" })
    })
    const run = runBin(["primitives", "--diff", "main"], dir)
    assert.equal(run.status, 0, run.stderr)
    assert.deepEqual(lines(run.stdout), [
      START,
      "**Adds 2 Primitives.** 1 file outside the catalogue.",
      "| Primitive | Class | Files |",
      "| --- | --- | --- |",
      "| `config.key` (config.key name) | adds | 0 |",
      "| `hooks.hello` (hooks.hello name) | adds | 1 |",
      END
    ])
  })

  it("reads the change from the merge-base, so a commit on the base after the branch left it is no part", () => {
    const dir = history({ ...BASE_FILES, [CATALOGUE]: catalogue(HOOK, KEY) }, (path) => {
      overwrite(path, { "plugins/demo/hooks/hello.sh": "echo hello again\n" })
    })
    git(dir, "switch", "-q", "main")
    overwrite(dir, { "config/schema.json": '{ "later": true }\n' })
    git(dir, "add", "-A")
    commit(dir, "-m", "later on main")
    git(dir, "switch", "-q", "feat")
    const json = JSON.parse(runBin(["primitives", "--diff", "main", "--json"], dir).stdout)
    assert.deepEqual(
      json.primitives.map(({ id }: { id: string }) => id),
      ["hooks.hello"]
    )
  })

  it("exits 2 with a remedy when it cannot answer", () => {
    const dir = history({ ...BASE_FILES, [CATALOGUE]: catalogue(HOOK) }, (path) => {
      overwrite(path, { "package.json": "{}\n" })
    })
    const together = runBin(["primitives", "--diff", "main", "--paths", "x"], dir)
    assert.equal(together.status, 2)
    assert.match(together.stderr, /^dw-sdlc primitives: --diff and --paths exclude each other; ask one question\n/)
    const unresolved = runBin(["primitives", "--diff", "nope"], dir)
    assert.equal(unresolved.status, 2)
    assert.deepEqual(lines(unresolved.stderr), [
      'dw-sdlc primitives: the base "nope" does not resolve to a commit — fetch it, or name a ref that exists'
    ])
    assert.equal(unresolved.stdout, "")
  })

  it("exits 2 for an invalid catalogue at the base, and for none or an invalid one at HEAD", () => {
    const invalidBase = history({ ...BASE_FILES, [CATALOGUE]: { version: 2, groups: [], primitives: [] } }, (path) => {
      overwrite(path, { [CATALOGUE]: catalogue(HOOK) })
    })
    const atBase = runBin(["primitives", "--diff", "main"], invalidBase)
    assert.equal(atBase.status, 2)
    assert.deepEqual(lines(atBase.stderr), [
      `dw-sdlc primitives: ${CATALOGUE} at "main": version: 2 is not 1 — fix the catalogue; dw-sdlc gate names each problem under the primitives Check`
    ])

    const none = history(BASE_FILES, (path) => {
      overwrite(path, { "package.json": "{}\n" })
    })
    const missing = runBin(["primitives", "--diff", "main"], none)
    assert.equal(missing.status, 2)
    assert.deepEqual(lines(missing.stderr), [
      `dw-sdlc primitives: ${CATALOGUE}: the catalogue does not exist at HEAD — create it, or point gate.checks.primitives.file at the catalogue`
    ])

    const invalidHead = history({ ...BASE_FILES, [CATALOGUE]: catalogue(HOOK) }, (path) => {
      overwrite(path, { [CATALOGUE]: { version: 2, groups: [], primitives: [] } })
    })
    const atHead = runBin(["primitives", "--diff", "main"], invalidHead)
    assert.equal(atHead.status, 2)
    assert.deepEqual(lines(atHead.stderr), [
      `dw-sdlc primitives: ${CATALOGUE}: version: 2 is not 1 — fix the catalogue; dw-sdlc gate names each problem under the primitives Check`
    ])
  })
})
