// What references-sync.ts does through its CLI, against throwaway upstreams served over file://, so
// `--depth` and the partial clone behave as they do against GitHub: clones and updates at a branch or
// a tag, a ref naming a package, the sparse skip, what the Sync leaves alone, and how it fails.

import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"
import { pathToFileURL } from "node:url"

import { commit, git, initRepo, runScript, scratch, tag, write, writeJson, type Run } from "../harness.ts"

const CONFIG = ".ai/agentic.config.json"

type Upstream = { dir: string; url: string }

/** A repository with a README and a vendored tree, one commit on main. */
function upstream(): Upstream {
  const dir = initRepo(scratch("upstream"))
  write(join(dir, "README.md"), "one\n")
  write(join(dir, "repos", "vendored.txt"), "heavy\n")
  git(dir, "add", ".")
  commit(dir, "-m", "one")
  return { dir, url: pathToFileURL(dir).href }
}

/** A commit on `source` that adds `file`, or changes it. */
function advance(source: Upstream, file: string, content = `${file}\n`): void {
  write(join(source.dir, file), content)
  git(source.dir, "add", file)
  commit(source.dir, "-m", file)
}

/** A library with tags v1.0.0 and v2.0.0, and a commit on main past the last release. */
function library(): Upstream {
  const source = initRepo(scratch("library"))
  const lib = { dir: source, url: pathToFileURL(source).href }
  advance(lib, "README.md")
  tag(source, "v1.0.0")
  advance(lib, "NEW.md")
  tag(source, "v2.0.0")
  advance(lib, "UNRELEASED.md")
  return lib
}

/** A pnpm-workspace.yaml whose default catalog pins `lib` at `version`. */
function catalog(version: string): string {
  return `packages:\n  - packages/*\n\ncatalog:\n  lib: ${version}\n`
}

function entry(dir: string, source: Upstream, fields: Record<string, unknown> = {}): Record<string, unknown> {
  return { dir, repository: source.url, ref: "main", what: `the ${dir} clone`, when: "a test reads it", ...fields }
}

/** A repository whose committed config declares `references`, beside `files` when given. */
function consumer(references: unknown, files: Record<string, string> = {}): string {
  const root = initRepo(scratch("consumer"))
  writeJson(join(root, CONFIG), { version: 1, references })
  for (const [path, content] of Object.entries(files)) {
    write(join(root, path), content)
  }
  return root
}

function declare(root: string, references: unknown): void {
  writeJson(join(root, CONFIG), { version: 1, references })
}

function sync(root: string, ...dirs: string[]): Run {
  return runScript("references-sync", dirs, root)
}

function expectStatus(run: Run, want: number): void {
  assert.equal(run.status, want, `want exit ${want}, got ${run.status}\nstdout: ${run.stdout}\nstderr: ${run.stderr}`)
}

function clone(root: string, dir: string): string {
  return join(root, "references", dir)
}

function head(repository: string): string {
  return git(repository, "rev-parse", "HEAD").trim()
}

function has(root: string, dir: string, file: string): boolean {
  return existsSync(join(clone(root, dir), file))
}

function lines(text: string): string[] {
  return text.split("\n").filter((line) => line !== "")
}

describe("a fresh clone and an update", () => {
  const source = upstream()
  const root = consumer([entry("full", source), entry("slim", source, { skip: ["repos/"] })])

  it("clones every entry shallow and prints one line each: directory, short commit, repository and ref", () => {
    const run = sync(root)
    expectStatus(run, 0)
    const short = git(clone(root, "full"), "rev-parse", "--short", "HEAD").trim()
    assert.deepEqual(lines(run.stdout), [
      `references/full  ${short}  ${source.url} main`,
      `references/slim  ${short}  ${source.url} main`
    ])
    assert.equal(run.stderr, "")
    assert.equal(head(clone(root, "full")), head(source.dir))
    assert.equal(git(clone(root, "full"), "rev-parse", "--is-shallow-repository").trim(), "true")
    assert.ok(has(root, "full", "repos/vendored.txt"))
  })

  it("leaves out the paths skip names", () => {
    assert.ok(has(root, "slim", "README.md"))
    assert.ok(!has(root, "slim", "repos"))
  })

  it("moves only the named clone to the branch's new head, the sparse checkout kept", () => {
    advance(source, "NEW.md")
    const run = sync(root, "slim")
    expectStatus(run, 0)
    assert.equal(lines(run.stdout).length, 1)
    assert.ok(has(root, "slim", "NEW.md"))
    assert.ok(!has(root, "slim", "repos"), "the sparse checkout survives an update")
    assert.ok(!has(root, "full", "NEW.md"))
  })

  it("checks out the whole tree once skip is gone, and leaves the path out again once it is back", () => {
    declare(root, [entry("full", source), entry("slim", source)])
    expectStatus(sync(root, "slim"), 0)
    assert.ok(has(root, "slim", "repos/vendored.txt"))
    declare(root, [entry("full", source), entry("slim", source, { skip: ["repos/"] })])
    expectStatus(sync(root, "slim"), 0)
    assert.ok(!has(root, "slim", "repos"))
  })
})

describe("a branch and a tag", () => {
  const lib = library()
  const root = consumer([entry("lib", lib)])

  it("moves a clone from a branch's head to a tag and back", () => {
    expectStatus(sync(root), 0)
    assert.ok(has(root, "lib", "UNRELEASED.md"))

    declare(root, [entry("lib", lib, { ref: "v1.0.0" })])
    const tagged = sync(root)
    expectStatus(tagged, 0)
    assert.match(tagged.stdout, /^references\/lib {2}\w+ {2}\S+ v1\.0\.0$/m)
    assert.ok(has(root, "lib", "README.md"))
    assert.ok(!has(root, "lib", "NEW.md"))

    declare(root, [entry("lib", lib)])
    expectStatus(sync(root), 0)
    assert.ok(has(root, "lib", "UNRELEASED.md"))
  })
})

describe("a ref naming a package", () => {
  const lib = library()

  it("follows the exact version package.json pins", () => {
    const root = consumer([entry("lib", lib, { ref: "v{lib}" })], {
      "package.json": JSON.stringify({ dependencies: { lib: "1.0.0" } })
    })
    const run = sync(root)
    expectStatus(run, 0)
    assert.match(run.stdout, /^references\/lib {2}\w+ {2}\S+ v1\.0\.0$/m)
    assert.ok(!has(root, "lib", "NEW.md"))
  })

  it("follows a catalog: pin through the default catalog, and moves with it", () => {
    const root = consumer([entry("lib", lib, { ref: "v{lib}" })], {
      "package.json": JSON.stringify({ devDependencies: { lib: "catalog:" } }),
      "pnpm-workspace.yaml": catalog("1.0.0")
    })
    expectStatus(sync(root), 0)
    assert.ok(!has(root, "lib", "NEW.md"))

    write(join(root, "pnpm-workspace.yaml"), catalog("2.0.0"))
    const moved = sync(root)
    expectStatus(moved, 0)
    assert.match(moved.stdout, /^references\/lib {2}\w+ {2}\S+ v2\.0\.0$/m)
    assert.ok(has(root, "lib", "NEW.md"))
    assert.ok(!has(root, "lib", "UNRELEASED.md"), "a tag, not the branch's head")
  })

  it("fails an entry whose pin is a range or missing, and syncs the others", () => {
    const root = consumer(
      [entry("ranged", lib, { ref: "v{lib}" }), entry("missing", lib, { ref: "v{nope}" }), entry("fine", lib)],
      { "package.json": JSON.stringify({ devDependencies: { lib: "^1.0.0" } }) }
    )
    const run = sync(root)
    expectStatus(run, 1)
    assert.deepEqual(lines(run.stderr), [
      "references/ranged  FAILED  ref v{lib} needs an exact version of lib, and its pin is ^1.0.0",
      "references/missing  FAILED  ref v{nope} names nope, which package.json does not depend on"
    ])
    assert.ok(!existsSync(clone(root, "ranged")))
    assert.ok(has(root, "fine", "README.md"))
  })
})

describe("what the Sync leaves alone", () => {
  it("a clone with local edits the update would overwrite, reported and as it was", () => {
    const source = upstream()
    const root = consumer([entry("edited", source), entry("fine", source)])
    expectStatus(sync(root), 0)
    const before = head(clone(root, "edited"))
    write(join(clone(root, "edited"), "README.md"), "mine\n")
    advance(source, "README.md", "theirs\n")

    const run = sync(root)
    expectStatus(run, 1)
    assert.match(run.stderr, /^references\/edited {2}FAILED {2}git checkout .*local changes/m)
    assert.equal(readFileSync(join(clone(root, "edited"), "README.md"), "utf8"), "mine\n")
    assert.equal(head(clone(root, "edited")), before)
    assert.equal(head(clone(root, "fine")), head(source.dir))
  })

  it("a directory that is not a clone of its repository, reported and as it was", () => {
    const source = upstream()
    const root = consumer([entry("plain", source), entry("foreign", source), entry("fine", source)])
    write(join(clone(root, "plain"), "mine.txt"), "")
    git(root, "clone", "-q", upstream().url, clone(root, "foreign"))

    const run = sync(root)
    expectStatus(run, 1)
    assert.match(run.stderr, /^references\/plain {2}FAILED {2}references\/plain exists and is not a clone of /m)
    assert.match(run.stderr, /^references\/foreign {2}FAILED {2}references\/foreign exists and is not a clone of /m)
    assert.ok(existsSync(join(clone(root, "plain"), "mine.txt")))
    assert.ok(!existsSync(join(clone(root, "plain"), ".git")))
    assert.ok(has(root, "fine", "README.md"))
  })

  it("a directory the list does not name, reported and never deleted", () => {
    const source = upstream()
    const root = consumer([entry("full", source)])
    write(join(clone(root, "old"), "x.txt"), "")
    const run = sync(root)
    expectStatus(run, 0)
    assert.match(run.stdout, /^Not listed in \.ai\/agentic\.config\.json, left alone: references\/old$/m)
    assert.ok(existsSync(join(clone(root, "old"), "x.txt")))
  })

  it("the repository a git hook points GIT_DIR at", () => {
    // A hook run from a linked worktree, pre-push among them, exports GIT_DIR.
    const pushed = initRepo(scratch("pushed"))
    write(join(pushed, "README.md"), "mine\n")
    git(pushed, "add", ".")
    commit(pushed, "-m", "mine")
    const before = head(pushed)
    const root = consumer([entry("full", upstream())])

    const run = runScript("references-sync", [], root, { GIT_DIR: join(pushed, ".git") })
    expectStatus(run, 0)
    assert.ok(has(root, "full", "README.md"))
    assert.equal(head(pushed), before)
    assert.equal(git(pushed, "remote"), "")
    assert.equal(git(pushed, "config", "core.bare").trim(), "false")
  })
})

describe("how the Sync fails", () => {
  it("syncs nothing on a key the parser refuses, and names the entry, the field and the reason", () => {
    const source = upstream()
    const root = consumer([entry("full", source)])
    expectStatus(sync(root), 0)
    const before = head(clone(root, "full"))
    advance(source, "NEW.md")
    declare(root, [entry("full", source), entry("new", source, { skip: ["../x"] })])

    const run = sync(root)
    expectStatus(run, 2)
    assert.equal(run.stdout, "")
    assert.deepEqual(lines(run.stderr), [
      'references:sync: .ai/agentic.config.json: references[1].skip[0]: "../x" must be relative to the clone and stay inside it; nothing synced'
    ])
    assert.equal(head(clone(root, "full")), before)
    assert.ok(!existsSync(clone(root, "new")))
  })

  it("fails an unreachable repository alone", () => {
    const source = upstream()
    const gone = { dir: "", url: pathToFileURL(join(scratch("gone"), "nothing")).href }
    const root = consumer([entry("gone", gone), entry("fine", source)])
    const run = sync(root)
    expectStatus(run, 1)
    assert.match(run.stderr, /^references\/gone {2}FAILED {2}git fetch/m)
    assert.equal(lines(run.stderr).length, 1)
    assert.ok(has(root, "fine", "README.md"))
  })

  it("exits 2 on a dir the list does not name, and syncs nothing", () => {
    const source = upstream()
    const root = consumer([entry("full", source)])
    const run = sync(root, "full", "nope")
    expectStatus(run, 2)
    assert.match(run.stderr, /^references:sync: not in the references of \.ai\/agentic\.config\.json: nope$/m)
    assert.ok(!existsSync(clone(root, "full")))
  })

  it("exits 2 on a config that is not JSON", () => {
    const root = consumer([])
    write(join(root, CONFIG), "{ not json")
    const run = sync(root)
    expectStatus(run, 2)
    assert.match(run.stderr, /^references:sync: \.ai\/agentic\.config\.json: not JSON: .*; nothing synced$/m)
  })
})

describe("a repository that declares no References", () => {
  it("prints nothing and exits 0 without a config", () => {
    const run = sync(initRepo(scratch("bare")))
    assert.deepEqual(run, { status: 0, stdout: "", stderr: "" })
  })

  it("prints nothing and exits 0 without the key, a references/ directory beside it", () => {
    const root = initRepo(scratch("keyless"))
    writeJson(join(root, CONFIG), { version: 1 })
    write(join(root, "references", "mine", "x.txt"), "")
    assert.deepEqual(sync(root), { status: 0, stdout: "", stderr: "" })
  })

  it("exits 2 on a named dir", () => {
    const run = sync(initRepo(scratch("bare")), "kody")
    expectStatus(run, 2)
    assert.match(run.stderr, /not in the references of \.ai\/agentic\.config\.json: kody/)
  })
})
