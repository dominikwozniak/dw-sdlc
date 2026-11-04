// What `dw-sdlc references setup` does, run with --root from another directory on a throwaway
// repository: the files a first run writes, a repeat that writes nothing, what it never overwrites or
// removes, the dry run, and the files it refuses.

import assert from "node:assert/strict"
import { existsSync, readFileSync, readlinkSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"

import { REPO_ROOT } from "../harness.ts"
import {
  git,
  initRepo,
  runReferences,
  scratch,
  spawnIsolated,
  write,
  writeJson,
  type Run
} from "../references-harness.ts"

const ROUTER = readFileSync(join(import.meta.dirname, "..", "..", "templates", "router.md"), "utf8")
/** The formatter this repository's Gate runs: oxfmt, through Vite+. */
const VP = join(REPO_ROOT, "node_modules", ".bin", "vp")
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

const SCHEMA = "../node_modules/dw-sdlc/config/references.schema.json"

/** An entry of the file for a GitHub repository named `dir`. */
function reference(dir: string, when: string): Record<string, unknown> {
  return { dir, repository: `https://github.com/o/${dir}`, ref: "main", what: `the ${dir} repository`, when }
}

/** `.ai/references.json` at `root`, declaring `references`. */
function declare(root: string, ...references: Record<string, unknown>[]): void {
  writeJson(join(root, ".ai/references.json"), { version: 1, references })
}

describe("a first run", () => {
  const root = initRepo(scratch("repo"))
  const run = setup(root)

  it("writes the Router and its symlink, the exclusion globs, the ignore lines and a file with no References", () => {
    expectStatus(run, 0)
    assert.deepEqual(lines(run.stdout), [
      "wrote       references/AGENTS.md",
      "wrote       references/CLAUDE.md",
      "wrote       .claude/settings.json",
      "wrote       .gitignore",
      "wrote       .ai/references.json"
    ])
    assert.equal(run.stderr, "")
    assert.equal(read(root, "references/AGENTS.md"), ROUTER)
    assert.equal(readlinkSync(join(root, "references/CLAUDE.md")), "AGENTS.md")
    assert.deepEqual(json(root, ".claude/settings.json"), { claudeMdExcludes: EXCLUDES })
    assert.deepEqual(json(root, ".ai/references.json"), { $schema: SCHEMA, version: 1, references: [] })
    assert.ok(!existsSync(join(root, ".ai/agentic.config.json")), "the setup wrote the agentic config")
  })

  it("gives the Router a block under The list that says how the first Reference is added", () => {
    const router = read(root, "references/AGENTS.md")
    const block = router.indexOf(
      "<!-- references:start — written from .ai/references.json by the setup; edit the file -->"
    )
    assert.ok(block > router.indexOf("## The list"), "the block sits under The list")
    assert.ok(block < router.indexOf("## Rules"), "the block sits above Rules")
    assert.match(router, /^No Reference is declared yet: `\/sdlc-references-add <repository>` adds one\.$/m)
    assert.match(router, /^<!-- references:end -->$/m)
  })

  it("leaves a file the Sync reads as no References", () => {
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
    const files = ["references/AGENTS.md", ".claude/settings.json", ".gitignore", ".ai/references.json"]
    const before = files.map((file) => read(root, file))
    const run = setup(root)
    expectStatus(run, 0)
    assert.deepEqual(lines(run.stdout), [
      "unchanged   references/AGENTS.md",
      "unchanged   references/CLAUDE.md",
      "unchanged   .claude/settings.json",
      "unchanged   .gitignore",
      "unchanged   .ai/references.json"
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
      "<!-- references:start — written from .ai/references.json by the setup; edit the file -->\n\n" +
      "No Reference is declared yet: `/sdlc-references-add <repository>` adds one.\n\n" +
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

  it("an agentic config without a references key, never touched", () => {
    const root = initRepo(scratch("repo"))
    const config = '{\n  "version": 1,\n  "packageManagers": { "node": "pnpm" }\n}\n'
    write(join(root, ".ai/agentic.config.json"), config)
    const run = setup(root)
    expectStatus(run, 0)
    assert.ok(!run.stdout.includes(".ai/agentic.config.json"), run.stdout)
    assert.equal(read(root, ".ai/agentic.config.json"), config)
  })

  it("a file the repository already has, entries, layout and all", () => {
    const root = initRepo(scratch("repo"))
    const file =
      '{ "version": 1, "references": [{ "dir": "kody", "repository": "https://github.com/kody-hq/kody", "ref": "main", "what": "Kody", "when": "a test" }] }\n'
    write(join(root, ".ai/references.json"), file)
    const run = setup(root)
    expectStatus(run, 0)
    assert.ok(lines(run.stdout).includes("unchanged   .ai/references.json"), run.stdout)
    assert.equal(read(root, ".ai/references.json"), file)
  })
})

describe("a references key left in the agentic config", () => {
  it("moves into a new file and leaves the config, its other keys and their layout kept", () => {
    const root = initRepo(scratch("repo"))
    const kody = reference("kody", "a large repo")
    write(
      join(root, ".ai/agentic.config.json"),
      `{\n  "version": 1,\n  "references": [${JSON.stringify(kody)}],\n  "packageManagers": { "node": "pnpm" }\n}\n`
    )
    const run = setup(root)
    expectStatus(run, 0)
    assert.deepEqual(lines(run.stdout).slice(-2), [
      "wrote       .ai/references.json",
      "wrote       .ai/agentic.config.json"
    ])
    assert.equal(
      read(root, ".ai/agentic.config.json"),
      '{\n  "version": 1,\n  "packageManagers": { "node": "pnpm" }\n}\n'
    )
    assert.deepEqual(json(root, ".ai/references.json"), { $schema: SCHEMA, version: 1, references: [kody] })
    assert.match(read(root, "references/AGENTS.md"), /^\| `kody` \| a large repo {6}\|$/m)

    const again = setup(root)
    expectStatus(again, 0)
    assert.ok(
      lines(again.stdout).every((line) => line.startsWith("unchanged   ")),
      again.stdout
    )
  })

  it("is refused beside a file, both left as they are; exit 1", () => {
    const root = initRepo(scratch("repo"))
    const config = `${JSON.stringify({ version: 1, references: [reference("kody", "a large repo")] })}\n`
    write(join(root, ".ai/agentic.config.json"), config)
    declare(root, reference("dw-mc", "a CLI"))
    const file = read(root, ".ai/references.json")
    const run = setup(root)
    expectStatus(run, 1)
    const problem =
      ".ai/agentic.config.json has a references key beside .ai/references.json; merge it into the file and remove the key by hand"
    assert.ok(lines(run.stdout).includes(`refused     .ai/references.json — ${problem}`), run.stdout)
    assert.ok(!run.stdout.includes("wrote       .ai/agentic.config.json"), run.stdout)
    assert.equal(read(root, ".ai/agentic.config.json"), config)
    assert.equal(read(root, ".ai/references.json"), file)
  })

  it("is refused when the parser refuses it, naming the entry, the field and the reason; nothing moves", () => {
    const root = initRepo(scratch("repo"))
    const config = `${JSON.stringify({ references: [{ ...reference("kody", "a test"), ref: "" }] })}\n`
    write(join(root, ".ai/agentic.config.json"), config)
    const run = setup(root)
    expectStatus(run, 1)
    assert.ok(
      lines(run.stdout).includes(
        "refused     .ai/references.json — .ai/agentic.config.json: references[0].ref: must not be empty; fix it by hand first"
      ),
      run.stdout
    )
    assert.equal(read(root, ".ai/agentic.config.json"), config)
    assert.ok(!existsSync(join(root, ".ai/references.json")))
  })
})

describe("the Router's table", () => {
  const START = "<!-- references:start — written from .ai/references.json by the setup; edit the file -->"
  const END = "<!-- references:end -->"

  /** `text` with its block, the markers included, replaced by `block`. */
  function routerWith(text: string, block: string): string {
    return text.slice(0, text.indexOf(START)) + block + text.slice(text.indexOf(END) + END.length)
  }

  /** A block of `rows` unpadded, with no blank line inside its markers. */
  function compact(...rows: string[]): string {
    return [START, "| dir | reach for it when |", "| --- | --- |", ...rows, END].join("\n")
  }

  /** A block of `body` with a blank line inside each marker, the shape oxfmt leaves it in. */
  function formatted(...body: string[]): string {
    return [START, "", ...body, "", END].join("\n")
  }

  it("writes the block as a formatter leaves it: blank lines inside the markers, each column padded to its widest cell", () => {
    const root = initRepo(scratch("repo"))
    declare(
      root,
      reference("kody", "agent instructions for a large repo, or `a | b` in a code span"),
      reference("dw-mc", "a CLI over `gh` — and Effect")
    )
    const run = setup(root)
    expectStatus(run, 0)
    assert.ok(lines(run.stdout).includes("wrote       references/AGENTS.md"), run.stdout)
    assert.equal(
      read(root, "references/AGENTS.md"),
      routerWith(
        ROUTER,
        formatted(
          "| dir     | reach for it when                                               |",
          "| ------- | --------------------------------------------------------------- |",
          "| `kody`  | agent instructions for a large repo, or `a \\| b` in a code span |",
          "| `dw-mc` | a CLI over `gh` — and Effect                                    |"
        )
      )
    )

    declare(root, reference("ab", "a"))
    expectStatus(setup(root), 0)
    assert.equal(
      read(root, "references/AGENTS.md"),
      routerWith(
        ROUTER,
        formatted("| dir  | reach for it when |", "| ---- | ----------------- |", "| `ab` | a                 |")
      )
    )

    declare(root)
    expectStatus(setup(root), 0)
    assert.equal(
      read(root, "references/AGENTS.md"),
      routerWith(ROUTER, formatted("No Reference is declared yet: `/sdlc-references-add <repository>` adds one."))
    )
  })

  it("leaves a Router oxfmt does not change, each cell padded by the columns oxfmt draws its graphemes in", () => {
    const root = initRepo(scratch("repo"))
    declare(
      root,
      reference("wide", "漢字 한국어 ＡＢ, an emoji 🚀 \u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467} 🇵🇱 ❤\u{FE0F}"),
      reference("narrow", "cafe\u{301}, ｱｲ, © ❤ ↔ — and `a | b`")
    )
    expectStatus(setup(root), 0)
    const formatter = spawnIsolated(VP, ["fmt", "--check", join(root, "references/AGENTS.md")], REPO_ROOT, {})
    assert.equal(formatter.status, 0, `${formatter.stdout}${formatter.stderr}\n${read(root, "references/AGENTS.md")}`)
    expectStatus(setup(root, "--check"), 0)
  })

  it("writes nothing on a second run, nor on a block in another shape that holds the same rows", () => {
    const root = initRepo(scratch("repo"))
    declare(
      root,
      reference("kody", "agent instructions for a large repo, or `a | b` in a code span"),
      reference("dw-mc", "a CLI over `gh`")
    )
    expectStatus(setup(root), 0)
    const written = read(root, "references/AGENTS.md")
    const again = setup(root)
    expectStatus(again, 0)
    assert.ok(lines(again.stdout).includes("unchanged   references/AGENTS.md"), again.stdout)
    assert.equal(read(root, "references/AGENTS.md"), written)

    const unpadded = routerWith(
      ROUTER,
      compact(
        "| `kody` | agent instructions for a large repo, or `a \\| b` in a code span |",
        "| `dw-mc` | a CLI over `gh` |"
      )
    )
    write(join(root, "references/AGENTS.md"), unpadded)
    const reshaped = setup(root)
    expectStatus(reshaped, 0)
    assert.ok(lines(reshaped.stdout).includes("unchanged   references/AGENTS.md"), reshaped.stdout)
    assert.equal(read(root, "references/AGENTS.md"), unpadded)
  })

  it("rewrites only the block when the table falls behind the file, the text around it byte for byte", () => {
    const root = initRepo(scratch("repo"))
    declare(root, reference("kody", "a large repo"), reference("dw-mc", "a CLI over `gh`"))
    const before = "# mine\n\nMy own words, kept as they are.\n\n"
    const after = "\n\n## My rules\n\n- mine too\n"
    write(join(root, "references/AGENTS.md"), `${before}${compact("| `kody` | a large repo |")}${after}`)
    const run = setup(root)
    expectStatus(run, 0)
    assert.ok(lines(run.stdout).includes("wrote       references/AGENTS.md"), run.stdout)
    assert.equal(
      read(root, "references/AGENTS.md"),
      `${before}${formatted(
        "| dir     | reach for it when |",
        "| ------- | ----------------- |",
        "| `kody`  | a large repo      |",
        "| `dw-mc` | a CLI over `gh`   |"
      )}${after}`
    )
  })

  it("sees a when that changed inside its cell as behind the file, the spaces at the cell's edges aside", () => {
    const root = initRepo(scratch("repo"))
    declare(root, reference("kody", "a large repo"))
    write(join(root, "references/AGENTS.md"), routerWith(ROUTER, compact("| `kody`    | a  large repo   |")))
    const run = setup(root)
    expectStatus(run, 0)
    assert.ok(lines(run.stdout).includes("wrote       references/AGENTS.md"), run.stdout)
    assert.equal(
      read(root, "references/AGENTS.md"),
      routerWith(
        ROUTER,
        formatted("| dir    | reach for it when |", "| ------ | ----------------- |", "| `kody` | a large repo      |")
      )
    )
  })

  it("refuses the Router when the file fails the parser, naming the entry, the field and the reason; exit 1", () => {
    const root = initRepo(scratch("repo"))
    declare(root, { ...reference("kody", "a test"), ref: "" })
    const run = setup(root)
    expectStatus(run, 1)
    assert.deepEqual(lines(run.stdout), [
      "refused     references/AGENTS.md — .ai/references.json: references[0].ref: must not be empty; the table comes from .ai/references.json, so fix it first",
      "wrote       references/CLAUDE.md",
      "wrote       .claude/settings.json",
      "wrote       .gitignore",
      "unchanged   .ai/references.json"
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
      "would write .ai/references.json"
    ])
    for (const file of ["references", ".claude", ".gitignore", ".ai"]) {
      assert.ok(!existsSync(join(root, file)), `${file} written by a dry run`)
    }
  })
})

describe("--check", () => {
  it("writes nothing, and exits 1 when any file would change: a missing Router, a block behind the file, one without markers", () => {
    const root = initRepo(scratch("repo"))
    const fresh = setup(root, "--check")
    expectStatus(fresh, 1)
    assert.deepEqual(lines(fresh.stdout), [
      "would write references/AGENTS.md",
      "would write references/CLAUDE.md",
      "would write .claude/settings.json",
      "would write .gitignore",
      "would write .ai/references.json"
    ])
    assert.ok(!existsSync(join(root, "references")), "a check wrote the Router")

    expectStatus(setup(root), 0)
    const inStep = setup(root, "--check")
    expectStatus(inStep, 0)
    assert.ok(
      lines(inStep.stdout).every((line) => line.startsWith("unchanged   ")),
      inStep.stdout
    )

    declare(root, reference("kody", "a test"))
    const router = read(root, "references/AGENTS.md")
    const behind = setup(root, "--check")
    expectStatus(behind, 1)
    assert.ok(lines(behind.stdout).includes("would write references/AGENTS.md"), behind.stdout)
    assert.ok(lines(behind.stdout).includes("unchanged   .ai/references.json"), behind.stdout)

    const moved = initRepo(scratch("repo"))
    const config = `${JSON.stringify({ references: [reference("kody", "a test")] })}\n`
    write(join(moved, ".ai/agentic.config.json"), config)
    const pending = setup(moved, "--check")
    expectStatus(pending, 1)
    assert.deepEqual(lines(pending.stdout).slice(-2), [
      "would write .ai/references.json",
      "would write .ai/agentic.config.json"
    ])
    assert.equal(read(moved, ".ai/agentic.config.json"), config, "a check moved the key")
    assert.ok(!existsSync(join(moved, ".ai/references.json")), "a check wrote the file")
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
  it("a settings file or a References file that is not a JSON object, left as it is while the rest is written; exit 1", () => {
    const root = initRepo(scratch("repo"))
    write(join(root, ".claude/settings.json"), "{ not json")
    write(join(root, ".ai/references.json"), "[]\n")
    const run = setup(root)
    expectStatus(run, 1)
    assert.deepEqual(lines(run.stdout), [
      "refused     references/AGENTS.md — .ai/references.json: not a JSON object; the table comes from .ai/references.json, so fix it first",
      "wrote       references/CLAUDE.md",
      "refused     .claude/settings.json — is not a JSON object; fix it by hand first",
      "wrote       .gitignore",
      "unchanged   .ai/references.json"
    ])
    assert.ok(!existsSync(join(root, "references/AGENTS.md")), "a Router whose table has no file to come from")
    assert.equal(read(root, ".claude/settings.json"), "{ not json")
    assert.equal(read(root, ".ai/references.json"), "[]\n")
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
    const start = "<!-- references:start — written from .ai/references.json by the setup; edit the file -->"
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
