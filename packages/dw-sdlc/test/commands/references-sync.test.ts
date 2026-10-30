// What `dw-sdlc references sync` does, against throwaway upstreams served over file://, so `--depth`
// and the partial clone behave as they do against GitHub: clones and updates at a branch or a tag, a ref
// naming a package, the sparse skip and only, what it leaves alone, how it fails, two Syncs in a checkout.

import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, it } from "node:test"
import { setTimeout as sleep } from "node:timers/promises"
import { pathToFileURL } from "node:url"

import {
  commit,
  git,
  initRepo,
  runReferences,
  scratch,
  startReferences,
  tag,
  write,
  writeJson,
  type Run
} from "../references-harness.ts"

const CONFIG = ".ai/agentic.config.json"
const FILE = ".ai/references.json"

/** A repository to clone from: its directory, and the file:// URL a Reference names it by. */
type Upstream = { dir: string; url: string }

/** An empty repository on main. */
function newUpstream(prefix: string): Upstream {
  const dir = initRepo(scratch(prefix))
  return { dir, url: pathToFileURL(dir).href }
}

/** A commit on `source` that adds `file`, or changes it. */
function advance(source: Upstream, file: string, content = `${file}\n`): void {
  write(join(source.dir, file), content)
  git(source.dir, "add", file)
  commit(source.dir, "-m", file)
}

/** A repository with a README and a vendored tree. */
function upstream(): Upstream {
  const source = newUpstream("upstream")
  advance(source, "README.md")
  advance(source, "repos/vendored.txt")
  return source
}

/** Files at the repository's top, the part a Reference reads in two directories, and the rest. */
const PLUGINS = [
  "README.md",
  "package.json",
  "pstack/SKILL.md",
  "pstack/vendor/lib.md",
  "harness/README.md",
  "harness/pstack/run.md",
  "harness/other/run.md",
  "other/SKILL.md",
  "pstackish/SKILL.md"
]

/** A repository laid out like cursor/plugins, in one commit. */
function plugins(): Upstream {
  const source = newUpstream("plugins")
  for (const file of PLUGINS) {
    write(join(source.dir, file), `${file}\n`)
  }
  git(source.dir, "add", ...PLUGINS)
  commit(source.dir, "-m", "plugins")
  return source
}

/** A library with tags v1.0.0 and v2.0.0, and a commit on main past the last release. */
function library(): Upstream {
  const lib = newUpstream("library")
  advance(lib, "README.md")
  tag(lib.dir, "v1.0.0")
  advance(lib, "NEW.md")
  tag(lib.dir, "v2.0.0")
  advance(lib, "UNRELEASED.md")
  return lib
}

/** A pnpm-workspace.yaml whose default catalog pins `lib` at `version`. */
function catalog(version: string): string {
  return `packages:\n  - packages/*\n\ncatalog:\n  lib: ${version}\n`
}

function entry(dir: string, url: string, fields: Record<string, unknown> = {}): Record<string, unknown> {
  return { dir, repository: url, ref: "main", what: `the ${dir} clone`, when: "a test reads it", ...fields }
}

function declare(root: string, references: unknown, file = FILE): void {
  writeJson(join(root, file), { version: 1, references })
}

/**
 * A repository whose `.ai/references.json` declares `references`, set up by the setup so its Router's
 * table is in step with the file, beside `files` when given.
 */
function consumer(references: unknown, files: Record<string, string> = {}): string {
  const root = initRepo(scratch("consumer"))
  declare(root, references)
  const setup = runReferences("setup", [], root)
  assert.equal(setup.status, 0, `${setup.stdout}\n${setup.stderr}`)
  for (const [path, content] of Object.entries(files)) {
    write(join(root, path), content)
  }
  return root
}

function sync(root: string, ...dirs: string[]): Run {
  return runReferences("sync", dirs, root)
}

/** A Sync started without waiting for it. */
function startSync(root: string, env: NodeJS.ProcessEnv = {}): Promise<Run> {
  return startReferences("sync", [], root, env)
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

/** Every file checked out in the clone at `dir`, its .git aside, sorted. */
function checkedOut(root: string, dir: string): string[] {
  const top = clone(root, dir)
  return readdirSync(top, { recursive: true, withFileTypes: true })
    .filter((found) => found.isFile())
    .map((found) => relative(top, join(found.parentPath, found.name)))
    .filter((path) => path.split("/")[0] !== ".git")
    .toSorted()
}

describe("a fresh clone and an update", () => {
  const source = upstream()
  const root = consumer([entry("full", source.url), entry("slim", source.url, { skip: ["repos/"] })])

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
    declare(root, [entry("full", source.url), entry("slim", source.url)])
    expectStatus(sync(root, "slim"), 0)
    assert.ok(has(root, "slim", "repos/vendored.txt"))
    declare(root, [entry("full", source.url), entry("slim", source.url, { skip: ["repos/"] })])
    expectStatus(sync(root, "slim"), 0)
    assert.ok(!has(root, "slim", "repos"))
  })
})

describe("only", () => {
  const source = plugins()
  const root = consumer([
    entry("pstack", source.url, { only: ["pstack/", "harness/pstack/"] }),
    entry("vendorless", source.url, { only: ["pstack/", "harness/pstack"], skip: ["pstack/vendor/"] }),
    entry("one-file", source.url, { only: ["harness/other/run.md"] })
  ])

  it("holds the top-level files and the paths only names, and nothing else; each line as without it", () => {
    const run = sync(root)
    expectStatus(run, 0)
    const short = git(clone(root, "pstack"), "rev-parse", "--short", "HEAD").trim()
    assert.deepEqual(lines(run.stdout), [
      `references/pstack  ${short}  ${source.url} main`,
      `references/vendorless  ${short}  ${source.url} main`,
      `references/one-file  ${short}  ${source.url} main`
    ])
    assert.equal(run.stderr, "")
    assert.deepEqual(checkedOut(root, "pstack"), [
      "README.md",
      "harness/pstack/run.md",
      "package.json",
      "pstack/SKILL.md",
      "pstack/vendor/lib.md"
    ])
  })

  it("leaves out a skip path inside them", () => {
    assert.deepEqual(checkedOut(root, "vendorless"), [
      "README.md",
      "harness/pstack/run.md",
      "package.json",
      "pstack/SKILL.md"
    ])
  })

  it("holds a file only names, deep under directories it otherwise leaves out", () => {
    assert.deepEqual(checkedOut(root, "one-file"), ["README.md", "harness/other/run.md", "package.json"])
  })

  it("shrinks a whole clone once only is added, and brings the whole tree back once it is removed", () => {
    const whole = consumer([entry("pstack", source.url)])
    expectStatus(sync(whole), 0)
    assert.deepEqual(checkedOut(whole, "pstack"), PLUGINS.toSorted())

    declare(whole, [entry("pstack", source.url, { only: ["pstack/"] })])
    expectStatus(sync(whole), 0)
    assert.deepEqual(checkedOut(whole, "pstack"), [
      "README.md",
      "package.json",
      "pstack/SKILL.md",
      "pstack/vendor/lib.md"
    ])

    declare(whole, [entry("pstack", source.url)])
    expectStatus(sync(whole), 0)
    assert.deepEqual(checkedOut(whole, "pstack"), PLUGINS.toSorted())
  })

  it("fails an entry once the ref's tree lacks a path only names, the clone as it was, and syncs the rest", () => {
    const renaming = plugins()
    const named = consumer([entry("pstack", renaming.url, { only: ["pstack/"] }), entry("fine", renaming.url)])
    expectStatus(sync(named), 0)
    const before = head(clone(named, "pstack"))
    const kept = checkedOut(named, "pstack")
    git(renaming.dir, "mv", "pstack", "plugin-pstack")
    commit(renaming.dir, "-m", "rename")

    const run = sync(named)
    expectStatus(run, 1)
    assert.deepEqual(lines(run.stderr), ["references/pstack  FAILED  only names pstack/, which the tree at main lacks"])
    assert.equal(head(clone(named, "pstack")), before)
    assert.deepEqual(checkedOut(named, "pstack"), kept)
    assert.equal(head(clone(named, "fine")), head(renaming.dir))
  })

  it("keeps only across a move between a branch and a tag, and fails a tag whose tree lacks a path it names", () => {
    const released = plugins()
    tag(released.dir, "v1.0.0")
    advance(released, "CHANGELOG.md")
    advance(released, "later/SKILL.md")
    const moving = consumer([entry("pstack", released.url, { only: ["pstack/"] })])
    expectStatus(sync(moving), 0)
    assert.deepEqual(checkedOut(moving, "pstack"), [
      "CHANGELOG.md",
      "README.md",
      "package.json",
      "pstack/SKILL.md",
      "pstack/vendor/lib.md"
    ])

    declare(moving, [entry("pstack", released.url, { ref: "v1.0.0", only: ["pstack/"] })])
    expectStatus(sync(moving), 0)
    assert.deepEqual(checkedOut(moving, "pstack"), [
      "README.md",
      "package.json",
      "pstack/SKILL.md",
      "pstack/vendor/lib.md"
    ])

    declare(moving, [entry("pstack", released.url, { only: ["pstack/", "later/"] })])
    expectStatus(sync(moving), 0)
    const before = head(clone(moving, "pstack"))
    assert.deepEqual(checkedOut(moving, "pstack"), [
      "CHANGELOG.md",
      "README.md",
      "later/SKILL.md",
      "package.json",
      "pstack/SKILL.md",
      "pstack/vendor/lib.md"
    ])

    declare(moving, [entry("pstack", released.url, { ref: "v1.0.0", only: ["pstack/", "later/"] })])
    const run = sync(moving)
    expectStatus(run, 1)
    assert.deepEqual(lines(run.stderr), [
      "references/pstack  FAILED  only names later/, which the tree at v1.0.0 lacks"
    ])
    assert.equal(head(clone(moving, "pstack")), before)
    assert.ok(has(moving, "pstack", "later/SKILL.md"))
  })
})

describe("a branch and a tag", () => {
  const lib = library()
  const root = consumer([entry("lib", lib.url)])

  it("moves a clone from a branch's head to a tag and back", () => {
    expectStatus(sync(root), 0)
    assert.ok(has(root, "lib", "UNRELEASED.md"))

    declare(root, [entry("lib", lib.url, { ref: "v1.0.0" })])
    const tagged = sync(root)
    expectStatus(tagged, 0)
    assert.match(tagged.stdout, /^references\/lib {2}\w+ {2}\S+ v1\.0\.0$/m)
    assert.ok(has(root, "lib", "README.md"))
    assert.ok(!has(root, "lib", "NEW.md"))

    declare(root, [entry("lib", lib.url)])
    expectStatus(sync(root), 0)
    assert.ok(has(root, "lib", "UNRELEASED.md"))
  })
})

describe("a ref naming a package", () => {
  const lib = library()

  it("follows the exact version package.json pins", () => {
    const root = consumer([entry("lib", lib.url, { ref: "v{lib}" })], {
      "package.json": JSON.stringify({ dependencies: { lib: "1.0.0" } })
    })
    const run = sync(root)
    expectStatus(run, 0)
    assert.match(run.stdout, /^references\/lib {2}\w+ {2}\S+ v1\.0\.0$/m)
    assert.ok(!has(root, "lib", "NEW.md"))
  })

  it("follows a catalog: pin through the default catalog, and moves with it", () => {
    const root = consumer([entry("lib", lib.url, { ref: "v{lib}" })], {
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

  it("reads a catalog:default pin the same, under a catalog: line carrying a comment", () => {
    const root = consumer([entry("lib", lib.url, { ref: "v{lib}" })], {
      "package.json": JSON.stringify({ devDependencies: { lib: "catalog:default" } }),
      "pnpm-workspace.yaml": "catalog: # one bump moves every package\n  lib: 1.0.0\n"
    })
    const run = sync(root)
    expectStatus(run, 0)
    assert.match(run.stdout, /^references\/lib {2}\w+ {2}\S+ v1\.0\.0$/m)
  })

  it("fails an entry whose pin is a range or missing, and syncs the others", () => {
    const root = consumer(
      [
        entry("ranged", lib.url, { ref: "v{lib}" }),
        entry("missing", lib.url, { ref: "v{nope}" }),
        entry("fine", lib.url)
      ],
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
    const root = consumer([entry("edited", source.url), entry("fine", source.url)])
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
    const root = consumer([entry("plain", source.url), entry("foreign", source.url), entry("fine", source.url)])
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
    const root = consumer([entry("full", source.url)])
    write(join(clone(root, "old"), "x.txt"), "")
    const run = sync(root)
    expectStatus(run, 0)
    assert.match(run.stdout, /^Not listed in \.ai\/references\.json, left alone: references\/old$/m)
    assert.ok(existsSync(join(clone(root, "old"), "x.txt")))
  })

  it("the repository a git hook points GIT_DIR at", () => {
    // A hook run from a linked worktree, pre-push among them, exports GIT_DIR.
    const pushed = initRepo(scratch("pushed"))
    write(join(pushed, "README.md"), "mine\n")
    git(pushed, "add", ".")
    commit(pushed, "-m", "mine")
    const before = head(pushed)
    const root = consumer([entry("full", upstream().url)])

    const run = runReferences("sync", [], root, { GIT_DIR: join(pushed, ".git") })
    expectStatus(run, 0)
    assert.ok(has(root, "full", "README.md"))
    assert.equal(head(pushed), before)
    assert.equal(git(pushed, "remote"), "")
    assert.equal(git(pushed, "config", "core.bare").trim(), "false")
  })
})

describe("the Router", () => {
  const SETUP = `node "${join(import.meta.dirname, "..", "..", "src", "cli.ts")}" references setup`

  it("says in one line that the Router is missing, naming the setup to run; the line changes no exit code", () => {
    const source = upstream()
    const root = initRepo(scratch("unset"))
    declare(root, [entry("full", source.url)])
    const run = sync(root)
    expectStatus(run, 0)
    const short = git(clone(root, "full"), "rev-parse", "--short", "HEAD").trim()
    assert.deepEqual(lines(run.stdout), [
      `references/full  ${short}  ${source.url} main`,
      `references/AGENTS.md  missing  run ${SETUP} from the project to write the Router`
    ])
    assert.equal(run.stderr, "")
  })

  it("says in one line that the table is behind the key, and nothing once the setup rewrote it", () => {
    const source = upstream()
    const root = consumer([entry("full", source.url)])
    declare(root, [entry("full", source.url), entry("more", source.url)])
    const run = sync(root, "full")
    expectStatus(run, 0)
    assert.equal(
      lines(run.stdout)[1],
      `references/AGENTS.md  behind the key  run ${SETUP} from the project to rewrite its table`
    )
    assert.equal(lines(run.stdout).length, 2, run.stdout)

    expectStatus(runReferences("setup", [], root), 0)
    const again = sync(root, "full")
    expectStatus(again, 0)
    assert.equal(lines(again.stdout).length, 1, again.stdout)
  })

  it("says in one line that the Router's markers are not a pair, which the setup refuses to touch", () => {
    const source = upstream()
    const root = consumer([entry("full", source.url)])
    write(join(root, "references/AGENTS.md"), "# mine\n\n<!-- references:end -->\n")
    const run = sync(root, "full")
    expectStatus(run, 0)
    assert.equal(
      lines(run.stdout)[1],
      "references/AGENTS.md  broken  has a references:end marker without a references:start; fix the pair by hand first"
    )
  })
})

describe("how the Sync fails", () => {
  it("syncs nothing on a key the parser refuses, and names the entry, the field and the reason", () => {
    const source = upstream()
    const root = consumer([entry("full", source.url)])
    expectStatus(sync(root), 0)
    const before = head(clone(root, "full"))
    advance(source, "NEW.md")
    declare(root, [entry("full", source.url), entry("new", source.url, { skip: ["../x"] })])

    const run = sync(root)
    expectStatus(run, 2)
    assert.equal(run.stdout, "")
    assert.deepEqual(lines(run.stderr), [
      'references:sync: .ai/references.json: references[1].skip[0]: "../x" must be relative to the clone and stay inside it; nothing synced'
    ])
    assert.equal(head(clone(root, "full")), before)
    assert.ok(!existsSync(clone(root, "new")))
  })

  it("syncs nothing on an only that is empty or leaves the clone, or a skip path outside every only path", () => {
    const source = upstream()
    const cases: [Record<string, unknown>, string][] = [
      [{ only: [] }, "references[1].only: must name at least one path"],
      [{ only: ["/docs/"] }, 'references[1].only[0]: "/docs/" must be relative to the clone and stay inside it'],
      [
        { only: ["docs/../../x"] },
        'references[1].only[0]: "docs/../../x" must be relative to the clone and stay inside it'
      ],
      [{ only: ["docs/"], skip: ["repos/"] }, 'references[1].skip[0]: "repos/" must lie inside one of the only paths']
    ]
    for (const [fields, problem] of cases) {
      const root = consumer([entry("full", source.url)])
      declare(root, [entry("full", source.url), entry("narrow", source.url, fields)])
      const run = sync(root)
      expectStatus(run, 2)
      assert.equal(run.stdout, "")
      assert.deepEqual(lines(run.stderr), [`references:sync: .ai/references.json: ${problem}; nothing synced`])
      assert.ok(!existsSync(clone(root, "full")))
    }
  })

  it("fails an unreachable repository alone", () => {
    const source = upstream()
    const gone = pathToFileURL(join(scratch("gone"), "nothing")).href
    const root = consumer([entry("gone", gone), entry("fine", source.url)])
    const run = sync(root)
    expectStatus(run, 1)
    assert.match(run.stderr, /^references\/gone {2}FAILED {2}git fetch/m)
    assert.equal(lines(run.stderr).length, 1)
    assert.ok(has(root, "fine", "README.md"))
  })

  it("exits 2 on a dir the list does not name, and syncs nothing", () => {
    const source = upstream()
    const root = consumer([entry("full", source.url)])
    const run = sync(root, "full", "nope")
    expectStatus(run, 2)
    assert.match(run.stderr, /^references:sync: not in \.ai\/references\.json: nope$/m)
    assert.ok(!existsSync(clone(root, "full")))
  })

  it("exits 2 on a references file that is not JSON", () => {
    const root = consumer([])
    write(join(root, FILE), "{ not json")
    const run = sync(root)
    expectStatus(run, 2)
    assert.match(run.stderr, /^references:sync: \.ai\/references\.json: not JSON: .*; nothing synced$/m)
  })

  it("syncs as before on an agentic config that is not JSON, which is the guards' to report", () => {
    const source = upstream()
    const root = consumer([entry("full", source.url)])
    write(join(root, CONFIG), "{ not json")
    expectStatus(sync(root), 0)
    assert.ok(has(root, "full", "README.md"))
  })

  it("exits 2 on a references key left in the agentic config, naming the setup that moves it, and syncs nothing", () => {
    const source = upstream()
    const root = consumer([entry("full", source.url)])
    writeJson(join(root, CONFIG), { version: 1, references: [entry("full", source.url)] })
    const run = sync(root)
    expectStatus(run, 2)
    assert.equal(run.stdout, "")
    assert.match(
      run.stderr,
      /^references:sync: \.ai\/agentic\.config\.json: .*`dw-sdlc references setup`.*; nothing synced$/m
    )
    assert.ok(!existsSync(clone(root, "full")))
  })
})

describe("two Syncs in one checkout", () => {
  const LOCK = "references/.sync.lock"

  /** The lock as a Sync run by process `pid` writes it. */
  function hold(root: string, pid: number): void {
    write(join(root, LOCK), `${pid}\n`)
  }

  it("started at once, both sync every entry and fail none", async () => {
    const source = upstream()
    const root = consumer([entry("a", source.url), entry("b", source.url), entry("c", source.url)])
    const [first, second] = await Promise.all([startSync(root), startSync(root)])
    const short = git(clone(root, "a"), "rev-parse", "--short", "HEAD").trim()
    for (const run of [first, second]) {
      expectStatus(run, 0)
      assert.equal(run.stderr, "")
      assert.deepEqual(lines(run.stdout), [
        `references/a  ${short}  ${source.url} main`,
        `references/b  ${short}  ${source.url} main`,
        `references/c  ${short}  ${source.url} main`
      ])
    }
    assert.ok(!existsSync(join(root, LOCK)), "the lock is released")
  })

  it("waits for the one that holds the lock, then syncs", async () => {
    const source = upstream()
    const root = consumer([entry("full", source.url)])
    hold(root, process.pid)
    const started = startSync(root)
    await sleep(500)
    assert.ok(!existsSync(clone(root, "full")), "nothing synced while the lock is held")
    rmSync(join(root, LOCK))

    const run = await started
    expectStatus(run, 0)
    assert.equal(run.stderr, "")
    assert.match(run.stdout, /^references\/full {2}\w+ {2}\S+ main$/m)
    assert.ok(has(root, "full", "README.md"))
    assert.ok(!existsSync(join(root, LOCK)))
  })

  it("gives up after REFERENCES_SYNC_WAIT seconds: one line, exit 0, no Reference failed", () => {
    const source = upstream()
    const root = consumer([entry("full", source.url)])
    hold(root, process.pid)
    const run = runReferences("sync", [], root, { REFERENCES_SYNC_WAIT: "1" })
    expectStatus(run, 0)
    assert.equal(run.stdout, "")
    assert.deepEqual(lines(run.stderr), [
      `references:sync: another Sync (pid ${process.pid}) still holds references/.sync.lock after 1 s; the clones are what it leaves`
    ])
    assert.ok(!existsSync(clone(root, "full")))
    assert.equal(readFileSync(join(root, LOCK), "utf8"), `${process.pid}\n`, "the other Sync's lock stays")
  })

  /** A Sync against a left-over lock: synced at once, the lock gone. */
  function expectCleared(root: string): void {
    const run = runReferences("sync", [], root, { REFERENCES_SYNC_WAIT: "2" })
    expectStatus(run, 0)
    assert.equal(run.stderr, "")
    assert.ok(has(root, "full", "README.md"))
    assert.ok(!existsSync(join(root, LOCK)))
  }

  it("removes the lock a killed Sync left and syncs at once", () => {
    const root = consumer([entry("full", upstream().url)])
    hold(root, spawnSync("true").pid)
    expectCleared(root)
  })

  it("removes a lock that names no pid", () => {
    const root = consumer([entry("full", upstream().url)])
    write(join(root, LOCK), "")
    expectCleared(root)
  })

  // pid 1 is init's, which this user cannot signal; root could, so the case is skipped for root.
  it("removes a lock naming a pid this user cannot signal", { skip: process.getuid?.() === 0 }, () => {
    const root = consumer([entry("full", upstream().url)])
    hold(root, 1)
    expectCleared(root)
  })

  it("releases the lock when a Reference fails", () => {
    const gone = pathToFileURL(join(scratch("gone"), "nothing")).href
    const root = consumer([entry("gone", gone)])
    expectStatus(sync(root), 1)
    assert.ok(!existsSync(join(root, LOCK)))
  })
})

describe("a repository that declares no References", () => {
  it("prints nothing and exits 0 without a config", () => {
    const run = sync(initRepo(scratch("bare")))
    assert.deepEqual(run, { status: 0, stdout: "", stderr: "" })
  })

  it("prints nothing and exits 0 without the file, a references/ directory beside it", () => {
    const root = initRepo(scratch("keyless"))
    writeJson(join(root, CONFIG), { version: 1 })
    write(join(root, "references", "mine", "x.txt"), "")
    assert.deepEqual(sync(root), { status: 0, stdout: "", stderr: "" })
  })

  it("prints nothing and exits 0 when only the local layer declares one", () => {
    const root = initRepo(scratch("local"))
    writeJson(join(root, CONFIG), { version: 1 })
    declare(root, [entry("full", upstream().url)], ".ai/agentic.config.local.json")
    assert.deepEqual(sync(root), { status: 0, stdout: "", stderr: "" })
    assert.ok(!existsSync(clone(root, "full")))
  })

  it("exits 2 on a named dir", () => {
    const run = sync(initRepo(scratch("bare")), "kody")
    expectStatus(run, 2)
    assert.match(run.stderr, /not in \.ai\/references\.json: kody/)
  })
})
