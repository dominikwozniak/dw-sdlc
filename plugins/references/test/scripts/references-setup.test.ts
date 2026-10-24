// What references-setup.ts does through its CLI, run with --root from another directory on a throwaway
// repository: the files a first run writes, a repeat that writes nothing, what it never overwrites or
// removes, the dry run, and the files it refuses.

import assert from "node:assert/strict"
import { existsSync, readFileSync, readlinkSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"

import { git, initRepo, runScript, scratch, write, writeJson, type Run } from "../harness.ts"

const ROUTER = readFileSync(join(import.meta.dirname, "..", "..", "templates", "router.md"), "utf8")
const EXCLUDES = [
  "**/references/*/CLAUDE.md",
  "**/references/*/**/CLAUDE.md",
  "**/references/*/AGENTS.md",
  "**/references/*/**/AGENTS.md"
]

const elsewhere = scratch("cwd")

function setup(root: string, ...flags: string[]): Run {
  return runScript("references-setup", ["--root", root, ...flags], elsewhere)
}

function expectStatus(run: Run, want: number): void {
  assert.equal(run.status, want, `want exit ${want}, got ${run.status}\nstdout: ${run.stdout}\nstderr: ${run.stderr}`)
}

function lines(text: string): string[] {
  return text.split("\n").filter((line) => line !== "")
}

function read(root: string, file: string): string {
  return readFileSync(join(root, file), "utf8")
}

function json(root: string, file: string): unknown {
  return JSON.parse(read(root, file))
}

describe("a first run", () => {
  const root = initRepo(scratch("repo"))
  const run = setup(root)

  it("writes the Router and its symlink, the exclusion globs, the ignore lines and an empty key", () => {
    expectStatus(run, 0)
    assert.deepEqual(lines(run.stdout), [
      "wrote       references/AGENTS.md",
      "wrote       references/CLAUDE.md",
      "wrote       .claude/settings.json",
      "wrote       .gitignore",
      "wrote       .ai/agentic.config.json"
    ])
    assert.equal(run.stderr, "")
    assert.equal(read(root, "references/AGENTS.md"), ROUTER)
    assert.equal(readlinkSync(join(root, "references/CLAUDE.md")), "AGENTS.md")
    assert.deepEqual(json(root, ".claude/settings.json"), { claudeMdExcludes: EXCLUDES })
    assert.deepEqual(json(root, ".ai/agentic.config.json"), { references: [] })
  })

  it("leaves a key the Sync reads as no References", () => {
    const sync = runScript("references-sync", [], root)
    expectStatus(sync, 0)
    assert.equal(sync.stdout, "")
    assert.equal(sync.stderr, "")
  })

  it("keeps every clone out of git but the Router and its symlink", () => {
    write(join(root, "references/kody/README.md"), "a clone\n")
    const untracked = lines(git(root, "status", "--porcelain", "--untracked-files=all"))
    assert.ok(untracked.includes("?? references/AGENTS.md"), untracked.join("\n"))
    assert.ok(untracked.includes("?? references/CLAUDE.md"), untracked.join("\n"))
    assert.ok(!untracked.some((line) => line.includes("kody")), untracked.join("\n"))
  })
})

describe("a repeat", () => {
  it("writes nothing on a second run", () => {
    const root = initRepo(scratch("repo"))
    expectStatus(setup(root), 0)
    const files = ["references/AGENTS.md", ".claude/settings.json", ".gitignore", ".ai/agentic.config.json"]
    const before = files.map((file) => read(root, file))
    const run = setup(root)
    expectStatus(run, 0)
    assert.deepEqual(lines(run.stdout), [
      "unchanged   references/AGENTS.md",
      "unchanged   references/CLAUDE.md",
      "unchanged   .claude/settings.json",
      "unchanged   .gitignore",
      "unchanged   .ai/agentic.config.json"
    ])
    assert.deepEqual(
      files.map((file) => read(root, file)),
      before
    )
  })
})

describe("what the setup never overwrites or removes", () => {
  it("an existing Router, and a CLAUDE.md of its own", () => {
    const root = initRepo(scratch("repo"))
    write(join(root, "references/AGENTS.md"), "# my router\n")
    const run = setup(root)
    expectStatus(run, 0)
    assert.ok(lines(run.stdout).includes("unchanged   references/AGENTS.md"), run.stdout)
    assert.ok(lines(run.stdout).includes("wrote       references/CLAUDE.md"), run.stdout)
    assert.equal(read(root, "references/AGENTS.md"), "# my router\n")
    assert.equal(readlinkSync(join(root, "references/CLAUDE.md")), "AGENTS.md")

    const other = initRepo(scratch("repo"))
    write(join(other, "references/CLAUDE.md"), "# claude only\n")
    expectStatus(setup(other), 0)
    assert.equal(read(other, "references/CLAUDE.md"), "# claude only\n")
  })

  it("a settings entry or key, which stays where it is as the missing globs are appended", () => {
    const root = initRepo(scratch("repo"))
    writeJson(join(root, ".claude/settings.json"), {
      claudeMdExcludes: ["**/vendor/CLAUDE.md", "**/references/*/AGENTS.md"],
      enabledPlugins: { "x@y": false }
    })
    expectStatus(setup(root), 0)
    assert.deepEqual(json(root, ".claude/settings.json"), {
      claudeMdExcludes: [
        "**/vendor/CLAUDE.md",
        "**/references/*/AGENTS.md",
        "**/references/*/CLAUDE.md",
        "**/references/*/**/CLAUDE.md",
        "**/references/*/**/AGENTS.md"
      ],
      enabledPlugins: { "x@y": false }
    })
  })

  it("an ignore line, the file only gaining the lines it lacks", () => {
    const root = initRepo(scratch("repo"))
    write(join(root, ".gitignore"), "node_modules/\n")
    expectStatus(setup(root), 0)
    assert.equal(
      read(root, ".gitignore"),
      "node_modules/\n\n" +
        "# References are cloned on each machine by the references plugin; only the Router is tracked.\n" +
        "references/*\n!references/AGENTS.md\n!references/CLAUDE.md\n"
    )

    const partial = initRepo(scratch("repo"))
    write(join(partial, ".gitignore"), "dist/\nreferences/*\n!references/AGENTS.md")
    expectStatus(setup(partial), 0)
    assert.equal(read(partial, ".gitignore"), "dist/\nreferences/*\n!references/AGENTS.md\n!references/CLAUDE.md\n")
  })

  it("a config's other keys and their layout, the empty key added at its end", () => {
    const root = initRepo(scratch("repo"))
    write(join(root, ".ai/agentic.config.json"), '{\n  "version": 1,\n  "packageManagers": { "node": "pnpm" }\n}\n')
    expectStatus(setup(root), 0)
    assert.equal(
      read(root, ".ai/agentic.config.json"),
      '{\n  "version": 1,\n  "packageManagers": { "node": "pnpm" },\n  "references": []\n}\n'
    )
  })

  it("a key the config already has, entries and all", () => {
    const root = initRepo(scratch("repo"))
    const config = '{ "references": [{ "dir": "kody" }] }\n'
    write(join(root, ".ai/agentic.config.json"), config)
    const run = setup(root)
    expectStatus(run, 0)
    assert.ok(lines(run.stdout).includes("unchanged   .ai/agentic.config.json"), run.stdout)
    assert.equal(read(root, ".ai/agentic.config.json"), config)
  })
})

describe("a dry run", () => {
  it("prints what it would write and writes nothing", () => {
    const root = initRepo(scratch("repo"))
    const run = setup(root, "--dry-run")
    expectStatus(run, 0)
    assert.deepEqual(lines(run.stdout), [
      "would write references/AGENTS.md",
      "would write references/CLAUDE.md",
      "would write .claude/settings.json",
      "would write .gitignore",
      "would write .ai/agentic.config.json"
    ])
    for (const file of ["references", ".claude", ".gitignore", ".ai"]) {
      assert.ok(!existsSync(join(root, file)), `${file} written by a dry run`)
    }
  })
})

describe("the root", () => {
  it("is the repository a subdirectory of it sits in", () => {
    const root = initRepo(scratch("repo"))
    write(join(root, "src/index.ts"), "")
    expectStatus(setup(join(root, "src")), 0)
    assert.ok(existsSync(join(root, "references/AGENTS.md")))
    assert.ok(!existsSync(join(root, "src/references")))
  })
})

describe("what the setup refuses", () => {
  it("a settings file or a config that is not a JSON object, left as it is while the rest is written; exit 1", () => {
    const root = initRepo(scratch("repo"))
    write(join(root, ".claude/settings.json"), "{ not json")
    write(join(root, ".ai/agentic.config.json"), "[]\n")
    const run = setup(root)
    expectStatus(run, 1)
    assert.deepEqual(lines(run.stdout), [
      "wrote       references/AGENTS.md",
      "wrote       references/CLAUDE.md",
      "refused     .claude/settings.json — is not a JSON object; fix it by hand first",
      "wrote       .gitignore",
      "refused     .ai/agentic.config.json — is not a JSON object; fix it by hand first"
    ])
    assert.equal(read(root, ".claude/settings.json"), "{ not json")
    assert.equal(read(root, ".ai/agentic.config.json"), "[]\n")
  })

  it("a claudeMdExcludes that is not a list", () => {
    const root = initRepo(scratch("repo"))
    writeJson(join(root, ".claude/settings.json"), { claudeMdExcludes: "**/CLAUDE.md" })
    const run = setup(root)
    expectStatus(run, 1)
    assert.ok(
      lines(run.stdout).includes(
        "refused     .claude/settings.json — claudeMdExcludes is not a list; fix it by hand first"
      ),
      run.stdout
    )
  })

  it("an unknown option, with exit 2 and the usage", () => {
    const run = setup(initRepo(scratch("repo")), "--force")
    expectStatus(run, 2)
    assert.match(run.stderr, /Usage: node <plugin root>\/scripts\/references-setup\.ts/)
    assert.equal(run.stdout, "")
  })
})
