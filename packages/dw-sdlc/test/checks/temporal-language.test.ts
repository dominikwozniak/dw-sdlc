// The `temporal-language` Check through `dw-sdlc gate`, on a throwaway repository whose durable docs
// carry the changelog phrases kody's docs check lists: the exit code and each failure line word for word.

import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { lines, repo, runBin } from "../harness.ts"

const CONFIG = ".ai/agentic.config.json"

/** A durable doc in the present tense, a phrase only inside code, and the records that keep their history. */
const TREE = {
  "README.md": "# Demo\n\nThe Gate runs every Check, now and on every pull request.\n",
  "docs/guide.md":
    "# Guide\n\n`we now` in a span is code.\n\n```text\nwe now run it\n```\n\n~~~\nas before\n~~~\n\n- A step:\n\n    ```sh\n    we now run it\n    ```\n",
  "docs/adr/0001-the-gate.md": "# The Gate\n\nWe now run one Gate.\n",
  "docs/decisions/0001-the-gate.md": "# 0001 — The Gate\n\nIt was retired.\n",
  "docs/research/gate/kody.md": "# kody\n\nPreviously we read it.\n",
  "packages/demo/CHANGELOG.md": "# demo\n\n## 1.1.0\n\n- The bin is now the Gate.\n"
}

/** Every phrase kody's check lists, one to a line from line 3, and one that wraps from line 16. */
const PHRASES = `# Changes

Now we run it.
And we now run it.
We no longer run it.
Previously we ran it.
It runs as before.
The flags were **removed**.
The hook was retired.
It no longer supports npm.
It is now the Gate.
They are now Checks.
It was previously a script.
The schema was recently changed.
It used to require a flag.
The rule is
  now a Check.
`

/** A repository with `temporal-language` set to `setting` under gate.checks, `TREE` with `files` over it. */
function withDocs(files: Record<string, string | object> = {}, setting: unknown = true): string {
  const config = { version: 1, gate: { checks: { "temporal-language": setting } } }
  return repo({ files: { [CONFIG]: config, ...TREE, ...files } })
}

/** The failure lines of a Gate run that ran the one Check, its own `gate: check` line and the verdict cut. */
function failures(stdout: string): string[] {
  return lines(stdout).slice(1, -1)
}

const REMEDY = "describe what is true, in the present tense, as if written from scratch"

describe("the temporal-language Check", () => {
  it("passes durable docs in the present tense, a phrase inside code, and the records exempt by default", () => {
    const run = runBin(["gate"], withDocs())
    assert.equal(run.status, 0, run.stdout)
    assert.deepEqual(lines(run.stdout), ["gate: check temporal-language — pass", "gate: green — 0 steps, 1 check"])
  })

  it("fails each changelog phrase on the line it starts, one that wraps included", () => {
    const run = runBin(["gate"], withDocs({ "docs/changes.md": PHRASES }))
    assert.equal(run.status, 1)
    assert.deepEqual(
      failures(run.stdout),
      [
        [3, "Now we"],
        [4, "we now"],
        [5, "We no longer"],
        [6, "Previously we"],
        [7, "as before"],
        [8, "were **removed"],
        [9, "was retired"],
        [10, "no longer supports"],
        [11, "is now the"],
        [12, "are now"],
        [13, "previously a"],
        [14, "recently changed"],
        [15, "used to require"],
        [16, "is now a"]
      ].map(
        ([line, phrase]) => `docs/changes.md:${line}: temporal-language: "${phrase}" reads as a changelog — ${REMEDY}`
      )
    )
  })

  it("fails phrases that overlap once, as the first of them", () => {
    const run = runBin(["gate"], withDocs({ "docs/changes.md": "# Changes\n\nWe no longer support Node 20.\n" }))
    assert.equal(run.status, 1)
    assert.deepEqual(failures(run.stdout), [
      `docs/changes.md:3: temporal-language: "We no longer" reads as a changelog — ${REMEDY}`
    ])
  })
})

describe("the temporal-language Check's options", () => {
  it("judges the files a glob of files matches, and exempt replaces the default list", () => {
    const run = runBin(
      ["gate"],
      withDocs({ "docs/old/notes.md": "We now run it.\n" }, { files: ["docs/**/*.md"], exempt: ["docs/old/**"] })
    )
    assert.equal(run.status, 1)
    assert.deepEqual(failures(run.stdout), [
      `docs/adr/0001-the-gate.md:3: temporal-language: "We now" reads as a changelog — ${REMEDY}`,
      `docs/decisions/0001-the-gate.md:3: temporal-language: "was retired" reads as a changelog — ${REMEDY}`,
      `docs/research/gate/kody.md:3: temporal-language: "Previously we" reads as a changelog — ${REMEDY}`
    ])
  })

  it("stays off under false", () => {
    const run = runBin(["gate"], withDocs({ "docs/changes.md": PHRASES }, false))
    assert.equal(run.status, 0, run.stdout)
    assert.deepEqual(lines(run.stdout), ["gate: green — 0 steps, 0 checks"])
  })

  it("exits 2 outside a git repository, where it cannot list the files", () => {
    const config = { version: 1, gate: { checks: { "temporal-language": true } } }
    const run = runBin(["gate"], repo({ git: false, files: { [CONFIG]: config, ...TREE } }))
    assert.equal(run.status, 2)
    assert.deepEqual(failures(run.stdout), [
      "temporal-language: cannot list the files: not a git repository — run the Gate inside a git repository"
    ])
  })
})
