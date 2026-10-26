// The `comment-budget` Check through `dw-sdlc gate`, on a throwaway repository whose source carries
// one comment block at a time: the exit code and each failure line word for word.

import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { lines, repo, runBin } from "../harness.ts"

const CONFIG = ".ai/agentic.config.json"

/** A repository with `files` and the Check set to `setting`. */
function withBudget(files: Record<string, string>, setting: unknown = true): string {
  return repo({ files: { [CONFIG]: { version: 1, gate: { checks: { "comment-budget": setting } } }, ...files } })
}

/** The failure lines of a Gate run that ran the one Check, its own `gate: check` line and the verdict cut. */
function failures(stdout: string): string[] {
  return lines(stdout).slice(1, -1)
}

/** `count` lines of `//` prose. */
function slashes(count: number): string {
  return Array.from({ length: count }, (_, index) => `// prose line ${index + 1}\n`).join("")
}

const OVER = "cut it to what the code cannot say, or move the reasoning into a doc and point at it"

describe("the comment-budget Check", () => {
  it("passes a block of three prose lines", () => {
    const run = runBin(["gate"], withBudget({ "src/a.ts": `${slashes(3)}export const a = 1\n` }))
    assert.equal(run.status, 0, run.stdout)
    assert.deepEqual(lines(run.stdout), ["gate: check comment-budget", "gate: green — 0 steps, 1 check"])
  })

  it("fails a block of four prose lines with the file, the line it starts on and the count", () => {
    const run = runBin(["gate"], withBudget({ "src/a.ts": `export const a = 1\n\n${slashes(4)}export const b = 2\n` }))
    assert.equal(run.status, 1)
    assert.deepEqual(failures(run.stdout), [
      `src/a.ts:3: comment-budget: a comment block of 4 prose lines, over the 3-line budget — ${OVER}`
    ])
  })

  it("counts the prose of a /* */ block, not its delimiters or its blank lines", () => {
    const doc = "/**\n * One.\n *\n * Two.\n * Three.\n */\nexport const a = 1\n"
    const long = "  /* One.\n     Two.\n     Three.\n     Four. */\n"
    const run = runBin(["gate"], withBudget({ "src/doc.ts": doc, "src/long.js": `function f() {\n${long}}\n` }))
    assert.equal(run.status, 1)
    assert.deepEqual(failures(run.stdout), [
      `src/long.js:2: comment-budget: a comment block of 4 prose lines, over the 3-line budget — ${OVER}`
    ])
  })

  it("splits // lines at a blank line or a line of code, and leaves a comment after code out", () => {
    const source = [
      "// one",
      "// two",
      "",
      "// three",
      "// four",
      "const a = 1 // trailing",
      "// five",
      "// six",
      "const b = 2",
      "// seven",
      "//",
      "// eight",
      "// nine",
      ""
    ].join("\n")
    const run = runBin(["gate"], withBudget({ "src/a.ts": source }))
    assert.equal(run.status, 0, run.stdout)
  })

  it("reads no comment inside a string, a template literal or a regular expression", () => {
    const source = [
      'const url = "https://example.com/a"',
      "const glob = '/* not a comment */'",
      "const template = `${url}//${glob ? `//${1}` : '/*'}`",
      "const doc = `",
      slashes(4).trimEnd(),
      "`",
      "const quote = /[\"'`]/g",
      "const slashes = /\\/\\/[/*]/",
      "const ratio = 4 / 2 / 1",
      slashes(4).trimEnd(),
      "export { doc, quote, ratio, slashes, template }",
      ""
    ].join("\n")
    const run = runBin(["gate"], withBudget({ "src/a.ts": source }))
    assert.equal(run.status, 1)
    assert.deepEqual(failures(run.stdout), [
      `src/a.ts:13: comment-budget: a comment block of 4 prose lines, over the 3-line budget — ${OVER}`
    ])
  })

  it("judges only JavaScript and TypeScript under the roots, by default packages, plugins, scripts and src", () => {
    const run = runBin(
      ["gate"],
      withBudget({
        "packages/a/index.mts": slashes(4),
        "plugins/b/hook.cjs": slashes(4),
        "scripts/c.tsx": slashes(4),
        "plugins/b/hook.sh": "# one\n# two\n# three\n# four\n",
        "docs/d.ts": slashes(9),
        "notes.md": slashes(9)
      })
    )
    assert.equal(run.status, 1)
    assert.deepEqual(failures(run.stdout), [
      `packages/a/index.mts:1: comment-budget: a comment block of 4 prose lines, over the 3-line budget — ${OVER}`,
      `plugins/b/hook.cjs:1: comment-budget: a comment block of 4 prose lines, over the 3-line budget — ${OVER}`,
      `scripts/c.tsx:1: comment-budget: a comment block of 4 prose lines, over the 3-line budget — ${OVER}`
    ])
  })
})

describe("the comment-budget Check's options", () => {
  it("holds each block under roots to maxProseLines", () => {
    const files = { "lib/a.ts": slashes(2), "lib/b.ts": slashes(1), "src/c.ts": slashes(9) }
    const run = runBin(["gate"], withBudget(files, { maxProseLines: 1, roots: ["lib"] }))
    assert.equal(run.status, 1)
    assert.deepEqual(failures(run.stdout), [
      `lib/a.ts:1: comment-budget: a comment block of 2 prose lines, over the 1-line budget — ${OVER}`
    ])
  })
})
