// What references-sync.ts does against a throwaway upstream served over file://, so `--depth` and the
// partial clone behave as they do against GitHub: a first run clones, a sparse row leaves its skipped
// paths out, a second run moves a clone to the new head, and a bad table or a foreign directory fails.

import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"
import { pathToFileURL } from "node:url"

import { commit, git, initRepo, scratch, write } from "../plugins/guardrails/test/harness.ts"
import { parseReferences } from "./references-sync.ts"

const SCRIPT = join(import.meta.dirname, "references-sync.ts")

function upstream(): { dir: string; url: string } {
  const dir = initRepo(scratch("upstream"), { branch: "main" })
  write(join(dir, "README.md"), "one\n")
  write(join(dir, "repos", "vendored.txt"), "heavy\n")
  git(dir, "add", ".")
  commit(dir, "-m", "one")
  return { dir, url: pathToFileURL(dir).href }
}

function router(rows: string[]): string {
  return [
    "# references/ — router",
    "",
    "## Repositories",
    "",
    "| dir | repository | branch | skip | what it is |",
    "| --- | --- | --- | --- | --- |",
    ...rows,
    ""
  ].join("\n")
}

function consumer(rows: string[]): string {
  const dir = initRepo(scratch("consumer"), { branch: "main" })
  write(join(dir, "references", "AGENTS.md"), router(rows))
  return dir
}

function sync(cwd: string, ...dirs: string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync("node", [SCRIPT, ...dirs], { cwd, encoding: "utf8" })
  return { status: result.status ?? -1, stdout: result.stdout, stderr: result.stderr }
}

describe("parseReferences", () => {
  it("reads the four cells and every backticked skip path", () => {
    const rows = parseReferences(
      router(["| `a` | `https://x/a` | `main` |  | A |", "| `b` | `https://x/b` | `dev` | `repos/` `dist/` | B |"])
    )
    assert.deepEqual(rows, [
      { dir: "a", repository: "https://x/a", branch: "main", skip: [] },
      { dir: "b", repository: "https://x/b", branch: "dev", skip: ["repos/", "dist/"] }
    ])
  })

  it("refuses a table without the skip column and a skip path that leaves the clone", () => {
    const noSkip = "## Repositories\n\n| dir | repository | branch |\n| --- | --- | --- |\n| `a` | `u` | `main` |\n"
    assert.throws(() => parseReferences(noSkip), /no "skip" column/)
    assert.throws(() => parseReferences(router(["| `a` | `u` | `main` | `../x` | A |"])), /stay inside it/)
  })
})

describe("references:sync", () => {
  const source = upstream()
  const root = consumer([
    `| \`full\` | \`${source.url}\` | \`main\` |  | everything |`,
    `| \`slim\` | \`${source.url}\` | \`main\` | \`repos/\` | without the vendored tree |`
  ])

  it("clones every row, leaving a row's skipped paths out", () => {
    const first = sync(root)
    assert.equal(first.status, 0, first.stderr)
    assert.ok(existsSync(join(root, "references", "full", "repos", "vendored.txt")))
    assert.ok(existsSync(join(root, "references", "slim", "README.md")))
    assert.ok(!existsSync(join(root, "references", "slim", "repos")))
    assert.equal(git(join(root, "references", "full"), "rev-parse", "--is-shallow-repository").trim(), "true")
  })

  it("moves only the named clone to the new head", () => {
    write(join(source.dir, "NEW.md"), "two\n")
    git(source.dir, "add", "NEW.md")
    commit(source.dir, "-m", "two")
    const second = sync(root, "slim")
    assert.equal(second.status, 0, second.stderr)
    assert.ok(existsSync(join(root, "references", "slim", "NEW.md")))
    assert.ok(!existsSync(join(root, "references", "full", "NEW.md")))
    assert.ok(!existsSync(join(root, "references", "slim", "repos")), "the sparse checkout survives an update")
  })

  it("names a directory the table no longer lists and leaves it alone", () => {
    write(join(root, "references", "old", "x.txt"), "")
    const run = sync(root, "full")
    assert.equal(run.status, 0, run.stderr)
    assert.match(run.stdout, /left alone: references\/old/)
    assert.ok(existsSync(join(root, "references", "old", "x.txt")))
  })

  it("exits 2 on a dir the table does not list", () => {
    const run = sync(root, "nope")
    assert.equal(run.status, 2)
    assert.match(run.stderr, /not listed in references\/AGENTS\.md: nope/)
  })

  it("fails a row whose directory is not a clone of its repository, and still runs the others", () => {
    const other = consumer([
      `| \`taken\` | \`${source.url}\` | \`main\` |  | taken |`,
      `| \`fine\` | \`${source.url}\` | \`main\` |  | fine |`
    ])
    write(join(other, "references", "taken", "mine.txt"), "")
    const run = sync(other)
    assert.equal(run.status, 1)
    assert.match(run.stderr, /references\/taken exists and is not a clone of/)
    assert.ok(existsSync(join(other, "references", "fine", "README.md")))
    assert.ok(existsSync(join(other, "references", "taken", "mine.txt")))
  })
})
