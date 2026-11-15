// The tests a content-only pull request runs in place of `pnpm test`: the awk in the quality-gate workflow
// exempts the test files `package.json` lists under `test:content`, and no others.

import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, it } from "node:test"

const ROOT = join(import.meta.dirname, "..", "..", "..")

/** The awk patterns of the workflow that exempt a file under a plugin's `test/` directory, as regular expressions. */
function exemptedTests(): RegExp[] {
  const workflow = readFileSync(join(ROOT, ".github", "workflows", "quality-gate.yaml"), "utf8")
  return Array.from(
    workflow.matchAll(/^\s*\/(\^plugins\\\/[^\n]*\\\/test\\\/[^\n]*)\/ \{ next \}$/gm),
    (match) =>
      // awk and JavaScript read these patterns alike: escaped slashes and dots, groups, alternation.
      new RegExp((match[1] ?? "").replaceAll("\\/", "/"))
  )
}

/** The files `test:content` runs, from its `node --test <file>...` line. */
function contentTests(): string[] {
  const manifest: unknown = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"))
  const scripts = (manifest as { scripts: Record<string, string> }).scripts
  return (scripts["test:content"] ?? "").split(/\s+/).filter((word) => word.endsWith(".test.ts"))
}

function testFilesUnder(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".test.ts"))
    .map((entry) => relative(ROOT, join(entry.parentPath, entry.name)))
}

describe("the content-only test run", () => {
  it("exempts the test files test:content runs, and no other test file", () => {
    const patterns = exemptedTests()
    assert.ok(patterns.length > 0, "the workflow's awk lists the exempt tests")
    const exempt = (path: string) => patterns.some((pattern) => pattern.test(path))
    const listed = contentTests()
    assert.ok(listed.length > 0, "package.json lists test:content")
    assert.deepEqual(
      listed.filter((path) => !exempt(path)),
      [],
      "a test:content file the awk does not exempt"
    )
    const exempted = testFilesUnder("plugins").filter(exempt)
    assert.deepEqual(
      exempted.filter((path) => !listed.includes(path)),
      [],
      "a test the awk exempts that test:content does not run"
    )
  })
})
