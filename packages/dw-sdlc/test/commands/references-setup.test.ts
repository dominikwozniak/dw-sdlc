// What `dw-sdlc references setup` does, run with --root from another directory on a throwaway
// repository: the files a first run writes, a repeat that writes nothing, what it never overwrites or
// removes, the dry run, and the files it refuses.

import assert from "node:assert/strict"
import { existsSync, readFileSync, readlinkSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"

import { git, initRepo, runReferences, scratch, write, writeJson, type Run } from "../references-harness.ts"

const ROUTER = readFileSync(join(import.meta.dirname, "..", "..", "templates", "router.md"), "utf8")
const EXCLUDES = [
  "**/references/*/CLAUDE.md",
  "**/references/*/**/CLAUDE.md",
  "**/references/*/AGENTS.md",
  "**/references/*/**/AGENTS.md"
]

const elsewhere = scratch("cwd")

function setup(root: string, ...flags: string[]): Run {
  return runReferences("setup", ["--root", root, ...flags], elsewhere)
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

/** An entry of the key for a GitHub repository named `dir`. */
function reference(dir: string, when: string): Record<string, unknown> {
  return { dir, repository: `https://github.com/o/${dir}`, ref: "main", what: `the ${dir} repository`, when }
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

  it("gives the Router a block under The list that says how the first Reference is added", () => {
    const router = read(root, "references/AGENTS.md")
    const block = router.indexOf(
      "<!-- references:start — written from .ai/agentic.config.json by the setup; edit the key -->"
    )
    assert.ok(block > router.indexOf("## The list"), "the block sits under The list")
    assert.ok(block < router.indexOf("## Rules"), "the block sits above Rules")
    assert.match(router, /^No Reference is declared yet: `\/sdlc-references-add <repository>` adds one\.$/m)
    assert.match(router, /^<!-- references:end -->$/m)
  })

  it("leaves a key the Sync reads as no References", () => {
    const sync = runReferences("sync", [], root)
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
  it("the text of an existing Router, which gains the block at its end when it has no markers, and a CLAUDE.md of its own", () => {
    const block =
      "<!-- references:start — written from .ai/agentic.config.json by the setup; edit the key -->\n" +
      "No Reference is declared yet: `/sdlc-references-add <repository>` adds one.\n" +
      "<!-- references:end -->\n"
    for (const router of ["# my router\n", "# my router"]) {
      const root = initRepo(scratch("repo"))
      write(join(root, "references/AGENTS.md"), router)
      const run = setup(root)
      expectStatus(run, 0)
      assert.ok(lines(run.stdout).includes("wrote       references/AGENTS.md"), run.stdout)
      assert.ok(lines(run.stdout).includes("wrote       references/CLAUDE.md"), run.stdout)
      assert.equal(read(root, "references/AGENTS.md"), `# my router\n\n${block}`)
      assert.equal(readlinkSync(join(root, "references/CLAUDE.md")), "AGENTS.md")
    }

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
        "# References are cloned on each machine by the sdlc plugin; only the Router is tracked.\n" +
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
    const config =
      '{ "references": [{ "dir": "kody", "repository": "https://github.com/kody-hq/kody", "ref": "main", "what": "Kody", "when": "a test" }] }\n'
    write(join(root, ".ai/agentic.config.json"), config)
    const run = setup(root)
    expectStatus(run, 0)
    assert.ok(lines(run.stdout).includes("unchanged   .ai/agentic.config.json"), run.stdout)
    assert.equal(read(root, ".ai/agentic.config.json"), config)
  })
})

describe("the Router's table", () => {
  const START = "<!-- references:start — written from .ai/agentic.config.json by the setup; edit the key -->"
  const END = "<!-- references:end -->"

  /** `text` with its block, the markers included, replaced by `block`. */
  function routerWith(text: string, block: string): string {
    return text.slice(0, text.indexOf(START)) + block + text.slice(text.indexOf(END) + END.length)
  }

  function table(...rows: string[]): string {
    return [START, "| dir | reach for it when |", "| --- | --- |", ...rows, END].join("\n")
  }

  it("writes one row per entry in the key's order, when verbatim with | escaped", () => {
    const root = initRepo(scratch("repo"))
    writeJson(join(root, ".ai/agentic.config.json"), {
      references: [
        reference("kody", "agent instructions for a large repo, or `a | b` in a code span"),
        reference("dw-mc", "a CLI over `gh`")
      ]
    })
    const run = setup(root)
    expectStatus(run, 0)
    assert.ok(lines(run.stdout).includes("wrote       references/AGENTS.md"), run.stdout)
    assert.equal(
      read(root, "references/AGENTS.md"),
      routerWith(
        ROUTER,
        table(
          "| `kody` | agent instructions for a large repo, or `a \\| b` in a code span |",
          "| `dw-mc` | a CLI over `gh` |"
        )
      )
    )
  })

  it("writes nothing on a second run, and nothing when a formatter padded the table and spaced the block", () => {
    const root = initRepo(scratch("repo"))
    writeJson(join(root, ".ai/agentic.config.json"), {
      references: [
        reference("kody", "agent instructions for a large repo, or `a | b` in a code span"),
        reference("dw-mc", "a CLI over `gh`")
      ]
    })
    expectStatus(setup(root), 0)
    const written = read(root, "references/AGENTS.md")
    const again = setup(root)
    expectStatus(again, 0)
    assert.ok(lines(again.stdout).includes("unchanged   references/AGENTS.md"), again.stdout)
    assert.equal(read(root, "references/AGENTS.md"), written)

    // What oxfmt or Prettier makes of the block: columns padded to the widest cell, a blank line
    // after the start marker and one before the end marker.
    const padded = routerWith(
      ROUTER,
      [
        START,
        "",
        "| dir     | reach for it when                                                |",
        "| ------- | ---------------------------------------------------------------- |",
        "| `kody`  | agent instructions for a large repo, or `a \\| b` in a code span |",
        "| `dw-mc` | a CLI over `gh`                                                  |",
        "",
        END
      ].join("\n")
    )
    write(join(root, "references/AGENTS.md"), padded)
    const formatted = setup(root)
    expectStatus(formatted, 0)
    assert.ok(lines(formatted.stdout).includes("unchanged   references/AGENTS.md"), formatted.stdout)
    assert.equal(read(root, "references/AGENTS.md"), padded)
  })

  it("rewrites only the block when the table falls behind the key, the text around it byte for byte", () => {
    const root = initRepo(scratch("repo"))
    writeJson(join(root, ".ai/agentic.config.json"), {
      references: [reference("kody", "a large repo"), reference("dw-mc", "a CLI over `gh`")]
    })
    const before = "# mine\n\nMy own words, kept as they are.\n\n"
    const after = "\n\n## My rules\n\n- mine too\n"
    write(join(root, "references/AGENTS.md"), `${before}${table("| `kody` | a large repo |")}${after}`)
    const run = setup(root)
    expectStatus(run, 0)
    assert.ok(lines(run.stdout).includes("wrote       references/AGENTS.md"), run.stdout)
    assert.equal(
      read(root, "references/AGENTS.md"),
      `${before}${table("| `kody` | a large repo |", "| `dw-mc` | a CLI over `gh` |")}${after}`
    )
  })

  it("sees a when that changed inside its cell as behind the key, the spaces at the cell's edges aside", () => {
    const root = initRepo(scratch("repo"))
    writeJson(join(root, ".ai/agentic.config.json"), { references: [reference("kody", "a large repo")] })
    write(join(root, "references/AGENTS.md"), routerWith(ROUTER, table("| `kody`    | a  large repo   |")))
    const run = setup(root)
    expectStatus(run, 0)
    assert.ok(lines(run.stdout).includes("wrote       references/AGENTS.md"), run.stdout)
    assert.equal(read(root, "references/AGENTS.md"), routerWith(ROUTER, table("| `kody` | a large repo |")))
  })

  it("refuses the Router when the key fails the parser, naming the entry, the field and the reason; exit 1", () => {
    const root = initRepo(scratch("repo"))
    writeJson(join(root, ".ai/agentic.config.json"), { references: [{ ...reference("kody", "a test"), ref: "" }] })
    const run = setup(root)
    expectStatus(run, 1)
    assert.deepEqual(lines(run.stdout), [
      "refused     references/AGENTS.md — .ai/agentic.config.json: references[0].ref: must not be empty; the table comes from the key, so fix it first",
      "wrote       references/CLAUDE.md",
      "wrote       .claude/settings.json",
      "wrote       .gitignore",
      "unchanged   .ai/agentic.config.json"
    ])
    assert.ok(!existsSync(join(root, "references/AGENTS.md")))
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

describe("--check", () => {
  it("writes nothing, and exits 1 when any file would change: a missing Router, a block behind the key, one without markers", () => {
    const root = initRepo(scratch("repo"))
    const fresh = setup(root, "--check")
    expectStatus(fresh, 1)
    assert.deepEqual(lines(fresh.stdout), [
      "would write references/AGENTS.md",
      "would write references/CLAUDE.md",
      "would write .claude/settings.json",
      "would write .gitignore",
      "would write .ai/agentic.config.json"
    ])
    assert.ok(!existsSync(join(root, "references")), "a check wrote the Router")

    expectStatus(setup(root), 0)
    const inStep = setup(root, "--check")
    expectStatus(inStep, 0)
    assert.ok(
      lines(inStep.stdout).every((line) => line.startsWith("unchanged   ")),
      inStep.stdout
    )

    const config = {
      references: [
        { dir: "kody", repository: "https://github.com/kody-hq/kody", ref: "main", what: "Kody", when: "a test" }
      ]
    }
    writeJson(join(root, ".ai/agentic.config.json"), config)
    const router = read(root, "references/AGENTS.md")
    const behind = setup(root, "--check")
    expectStatus(behind, 1)
    assert.ok(lines(behind.stdout).includes("would write references/AGENTS.md"), behind.stdout)
    assert.ok(lines(behind.stdout).includes("unchanged   .ai/agentic.config.json"), behind.stdout)
    assert.equal(read(root, "references/AGENTS.md"), router, "a check rewrote the table")

    write(join(root, "references/AGENTS.md"), "# mine\n")
    const unmarked = setup(root, "--check")
    expectStatus(unmarked, 1)
    assert.ok(lines(unmarked.stdout).includes("would write references/AGENTS.md"), unmarked.stdout)
    assert.equal(read(root, "references/AGENTS.md"), "# mine\n")
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
      "refused     references/AGENTS.md — .ai/agentic.config.json: not a JSON object; the table comes from the key, so fix it first",
      "wrote       references/CLAUDE.md",
      "refused     .claude/settings.json — is not a JSON object; fix it by hand first",
      "wrote       .gitignore",
      "refused     .ai/agentic.config.json — is not a JSON object; fix it by hand first"
    ])
    assert.ok(!existsSync(join(root, "references/AGENTS.md")), "a Router whose table has no key to come from")
    assert.equal(read(root, ".claude/settings.json"), "{ not json")
    assert.equal(read(root, ".ai/agentic.config.json"), "[]\n")
  })

  it("an ignore file that ignores references/ itself, where no exception can track the Router", () => {
    for (const line of ["references/", "/references"]) {
      const root = initRepo(scratch("repo"))
      write(join(root, ".gitignore"), `dist/\n${line}\n`)
      for (const flags of [["--dry-run"], []]) {
        const run = setup(root, ...flags)
        expectStatus(run, 1)
        assert.ok(
          lines(run.stdout).includes(
            "refused     .gitignore — ignores references/ itself, so no exception tracks the Router; ignore references/* instead"
          ),
          run.stdout
        )
      }
      assert.equal(read(root, ".gitignore"), `dist/\n${line}\n`)
    }
  })

  it("a Router with one marker and not the other, left as it is", () => {
    const start = "<!-- references:start — written from .ai/agentic.config.json by the setup; edit the key -->"
    const cases: [router: string, problem: string][] = [
      [`# mine\n\n${start}\n| dir | reach for it when |\n`, "has a references:start marker without a references:end"],
      ["# mine\n\n<!-- references:end -->\n", "has a references:end marker without a references:start"],
      [`# mine\n\n<!-- references:end -->\n${start}\n`, "has its references:end marker before references:start"]
    ]
    for (const [router, problem] of cases) {
      const root = initRepo(scratch("repo"))
      write(join(root, "references/AGENTS.md"), router)
      const run = setup(root)
      expectStatus(run, 1)
      assert.ok(
        lines(run.stdout).includes(`refused     references/AGENTS.md — ${problem}; fix the pair by hand first`),
        run.stdout
      )
      assert.equal(read(root, "references/AGENTS.md"), router)
    }
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
    assert.match(run.stderr, /Usage: dw-sdlc references setup/)
    assert.equal(run.stdout, "")
  })
})
