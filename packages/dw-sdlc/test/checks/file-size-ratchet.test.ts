// The `file-size-ratchet` Check through `dw-sdlc gate`, on a throwaway repository whose files and
// baseline break one rule at a time: the exit code, each failure line word for word, and the baseline
// `--update-baseline` leaves behind.

import assert from "node:assert/strict"
import { existsSync, readFileSync, rmSync, symlinkSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"

import { commit, git, lines, repo, runBin, timed } from "../harness.ts"

const CONFIG = ".ai/agentic.config.json"
const BASELINE = ".ai/file-size-ratchet.baseline.json"

/** `count` lines of text. */
function text(count: number): string {
  return "x\n".repeat(count)
}

type Gate = { steps?: string[]; checks?: Record<string, unknown> }

/** A repository with `files`, `baseline` recorded unless null, and the Ratchet set to `setting` in `gate`. */
function withRatchet(
  files: Record<string, string | object>,
  baseline: Record<string, unknown> | string | null = {},
  setting: unknown = true,
  gate: Gate = {}
): string {
  const config = { version: 1, gate: { ...gate, checks: { ...gate.checks, "file-size-ratchet": setting } } }
  const recorded = baseline === null ? {} : { [BASELINE]: baseline }
  return repo({ files: { [CONFIG]: config, ...recorded, ...files } })
}

function readBaseline(root: string): string {
  return readFileSync(join(root, BASELINE), "utf8")
}

/** The failure lines of a Gate run: its `gate:` log lines and the verdict cut. */
function failures(stdout: string): string[] {
  return lines(stdout).filter((line) => !line.startsWith("gate: "))
}

describe("the file-size-ratchet Check", () => {
  it("passes files within their group's limit and a listed file within its recorded count", () => {
    const root = withRatchet(
      { "src/small.ts": text(500), "src/legacy.ts": text(600), "test/big.test.ts": text(2000) },
      { "src/legacy.ts": 600 }
    )
    const run = runBin(["gate"], root)
    assert.equal(run.status, 0, run.stdout)
    assert.deepEqual(lines(run.stdout), ["gate: check file-size-ratchet — pass", "gate: green — 0 steps, 1 check"])
  })

  it("fails a file grown past its group's limit, by default source 500 and tests 2000", () => {
    const root = withRatchet({
      "src/big.ts": text(501),
      "plugins/demo/hooks/run.sh": text(501),
      "packages/demo/test/big.test.ts": text(2001)
    })
    const run = runBin(["gate"], root)
    assert.equal(run.status, 1)
    assert.deepEqual(failures(run.stdout), [
      "packages/demo/test/big.test.ts: file-size-ratchet: 2001 lines, over the 2000-line limit of the tests group — split it, or cut it to 2000 lines",
      "plugins/demo/hooks/run.sh: file-size-ratchet: 501 lines, over the 500-line limit of the source group — split it, or cut it to 500 lines",
      "src/big.ts: file-size-ratchet: 501 lines, over the 500-line limit of the source group — split it, or cut it to 500 lines"
    ])
  })

  it("fails a listed file grown past the count the baseline holds it to", () => {
    const root = withRatchet({ "src/legacy.ts": text(601) }, { "src/legacy.ts": 600 })
    const run = runBin(["gate"], root)
    assert.equal(run.status, 1)
    assert.deepEqual(failures(run.stdout), [
      "src/legacy.ts: file-size-ratchet: 601 lines, over the 600 the baseline holds it to — cut it back to 600 lines or fewer"
    ])
  })

  it("judges no markdown file by default: the map, the glossary and the agent docs pass at any length", () => {
    const root = withRatchet({
      "AGENTS.md": text(5000),
      "GLOSSARY.md": text(5000),
      "docs/agents/domain.md": text(5000),
      "packages/demo/README.md": text(5000)
    })
    const run = runBin(["gate"], root)
    assert.equal(run.status, 0, run.stdout)
  })

  it("judges no file outside every group, no symbolic link and no file git ignores", () => {
    const root = withRatchet(
      {
        "data/fixture.json": text(5000),
        "dist/bundle.js": text(5000),
        ".gitignore": "dist/\n",
        "src/legacy.ts": text(600)
      },
      { "src/legacy.ts": 600 }
    )
    symlinkSync("legacy.ts", join(root, "src/link.ts"))
    const run = runBin(["gate"], root)
    assert.equal(run.status, 0, run.stdout)
  })

  it("exits 2 when the baseline does not exist", () => {
    const run = runBin(["gate"], withRatchet({ "src/small.ts": text(1) }, null))
    assert.equal(run.status, 2)
    assert.deepEqual(failures(run.stdout), [
      `${BASELINE}: file-size-ratchet: the baseline does not exist — record it with dw-sdlc gate --update-baseline`
    ])
  })
})

describe("the file-size-ratchet Check on a baseline that disagrees with itself", () => {
  it("fails a file listed twice, since JSON keeps the last entry", () => {
    const root = withRatchet({ "src/legacy.ts": text(600) }, '{\n  "src/legacy.ts": 600,\n  "src/legacy.ts": 900\n}\n')
    const run = runBin(["gate"], root)
    assert.equal(run.status, 1)
    assert.deepEqual(failures(run.stdout), [
      `${BASELINE}:3: file-size-ratchet: lists "src/legacy.ts" twice — keep one entry for it, the lower count`
    ])
  })

  it("fails an entry within its group's limit and an entry no group holds", () => {
    const root = withRatchet(
      { "src/small.ts": text(10), "notes.txt": text(900) },
      '{\n  "notes.txt": 900,\n  "src/small.ts": 500\n}\n'
    )
    const run = runBin(["gate"], root)
    assert.equal(run.status, 1)
    assert.deepEqual(failures(run.stdout), [
      `${BASELINE}:2: file-size-ratchet: lists "notes.txt", which no group holds — run dw-sdlc gate --update-baseline, which drops it`,
      `${BASELINE}:3: file-size-ratchet: lists "src/small.ts" at 500 lines, within the 500-line limit of the source group — run dw-sdlc gate --update-baseline, which drops it`
    ])
  })

  it("fails a baseline that is not an object of paths and line counts, and judges no file by it", () => {
    const shape = "make it an object of file paths and line counts, as dw-sdlc gate --update-baseline writes it"
    const notJson = runBin(["gate"], withRatchet({ "src/big.ts": text(900) }, "{ src"))
    assert.equal(notJson.status, 1)
    assert.deepEqual(failures(notJson.stdout), [
      `${BASELINE}: file-size-ratchet: not JSON: Expected property name or '}' in JSON at position 2 (line 1 column 3) — ${shape}`
    ])
    const list = runBin(["gate"], withRatchet({ "src/big.ts": text(900) }, '["src/big.ts"]\n'))
    assert.deepEqual(failures(list.stdout), [`${BASELINE}: file-size-ratchet: not an object — ${shape}`])
    const counts = runBin(
      ["gate"],
      withRatchet({ "src/big.ts": text(900) }, '{\n  "src/big.ts": "900",\n  "src/b.ts": 0.5\n}\n')
    )
    assert.deepEqual(failures(counts.stdout), [
      `${BASELINE}:2: file-size-ratchet: "src/big.ts" is at "900", not a line count — ${shape}`,
      `${BASELINE}:3: file-size-ratchet: "src/b.ts" is at 0.5, not a line count — ${shape}`
    ])
  })
})

describe("dw-sdlc gate --update-baseline", () => {
  it("lowers a listed file that shrank, drops one now within its limit or gone, and adds no file", () => {
    const root = withRatchet(
      { "src/shrank.ts": text(550), "src/fixed.ts": text(400), "src/new.ts": text(700) },
      { "src/fixed.ts": 600, "src/gone.ts": 800, "src/shrank.ts": 600 }
    )
    assert.equal(runBin(["gate"], root).status, 1, "the new file over its limit passed")
    const run = runBin(["gate", "--update-baseline"], root)
    assert.equal(run.status, 1)
    assert.ok(
      lines(run.stdout).includes(`gate: baseline ${BASELINE} tightened — 2 files dropped, 1 count lowered`),
      run.stdout
    )
    assert.deepEqual(failures(run.stdout), [
      "src/new.ts: file-size-ratchet: 700 lines, over the 500-line limit of the source group — split it, or cut it to 500 lines"
    ])
    assert.equal(readBaseline(root), '{\n  "src/shrank.ts": 550\n}\n')
  })

  it("never raises a count: a listed file that grew keeps the count it had", () => {
    const root = withRatchet({ "src/legacy.ts": text(700) }, { "src/legacy.ts": 600 })
    const run = runBin(["gate", "--update-baseline"], root)
    assert.equal(run.status, 1)
    assert.ok(lines(run.stdout).includes(`gate: baseline ${BASELINE} unchanged`), run.stdout)
    assert.equal(readBaseline(root), '{"src/legacy.ts":600}')
  })

  it("passes once a listed file shrank below its limit, and refreshing then drops it", () => {
    const root = withRatchet({ "src/legacy.ts": text(450) }, { "src/legacy.ts": 600 })
    assert.equal(runBin(["gate"], root).status, 0)
    const run = runBin(["gate", "--update-baseline"], root)
    assert.equal(run.status, 0, run.stdout)
    assert.deepEqual(lines(run.stdout), [
      "gate: check file-size-ratchet — pass",
      `gate: baseline ${BASELINE} tightened — 1 file dropped`,
      "gate: green — 0 steps, 1 check"
    ])
    assert.equal(readBaseline(root), "{}\n")
  })

  it("records the baseline where there is none: every file over its limit, and the Gate then passes", () => {
    const root = withRatchet(
      { "src/big.ts": text(501), "test/big.test.ts": text(2001), "src/small.ts": text(3), "AGENTS.md": text(900) },
      null
    )
    const run = runBin(["gate", "--update-baseline"], root)
    assert.equal(run.status, 0, run.stdout)
    assert.deepEqual(lines(run.stdout), [
      "gate: check file-size-ratchet — pass",
      `gate: baseline ${BASELINE} recorded — 2 files over their limit`,
      "gate: green — 0 steps, 1 check"
    ])
    assert.equal(readBaseline(root), '{\n  "src/big.ts": 501,\n  "test/big.test.ts": 2001\n}\n')
    assert.equal(runBin(["gate"], root).status, 0)
  })

  it("drops a markdown file's entry, which no group holds by default, and the Gate then passes", () => {
    const root = withRatchet(
      { "AGENTS.md": text(127), "GLOSSARY.md": text(140), "src/legacy.ts": text(600) },
      '{\n  "AGENTS.md": 127,\n  "GLOSSARY.md": 132,\n  "src/legacy.ts": 600\n}\n'
    )
    const stale = "which no group holds — run dw-sdlc gate --update-baseline, which drops it"
    assert.deepEqual(failures(runBin(["gate"], root).stdout), [
      `${BASELINE}:2: file-size-ratchet: lists "AGENTS.md", ${stale}`,
      `${BASELINE}:3: file-size-ratchet: lists "GLOSSARY.md", ${stale}`
    ])
    const run = runBin(["gate", "--update-baseline"], root)
    assert.equal(run.status, 0, run.stdout)
    assert.ok(lines(run.stdout).includes(`gate: baseline ${BASELINE} tightened — 2 files dropped`), run.stdout)
    assert.equal(readBaseline(root), '{\n  "src/legacy.ts": 600\n}\n')
    assert.equal(runBin(["gate"], root).status, 0)
  })

  it("drops the entries that disagree with the groups", () => {
    const root = withRatchet(
      { "src/small.ts": text(10), "notes.txt": text(900) },
      { "notes.txt": 900, "src/small.ts": 500 }
    )
    const run = runBin(["gate", "--update-baseline"], root)
    assert.equal(run.status, 0, run.stdout)
    assert.equal(readBaseline(root), "{}\n")
  })

  it("refuses while another Check fails, and leaves the baseline byte for byte as it was", () => {
    const recorded = '{ "src/fixed.ts": 600,\n"src/legacy.ts":   700 }'
    const root = withRatchet({ "src/fixed.ts": text(10), "src/legacy.ts": text(650) }, recorded, true, {
      checks: { run: [{ name: "docs", command: "exit 1" }] }
    })
    const run = runBin(["gate", "--update-baseline"], root)
    assert.equal(run.status, 1)
    assert.ok(
      lines(run.stdout).includes(`gate: baseline ${BASELINE} not refreshed — a Step or another Check did not pass`),
      run.stdout
    )
    assert.equal(readBaseline(root), recorded)
  })

  it("records no new baseline over a committed one gone from the tree, so no grown file gets back in", () => {
    const root = withRatchet({ "src/legacy.ts": text(700) }, { "src/legacy.ts": 600 })
    git(root, "add", "-A")
    commit(root, "-m", "baseline")
    rmSync(join(root, BASELINE))
    const deleted = `${BASELINE}: file-size-ratchet: the baseline is committed but gone from the tree — restore it with git restore ${BASELINE}`
    assert.deepEqual(failures(runBin(["gate"], root).stdout), [deleted])
    const run = runBin(["gate", "--update-baseline"], root)
    assert.equal(run.status, 2)
    assert.ok(
      lines(run.stdout).includes(
        `gate: baseline ${BASELINE} not refreshed — the baseline is committed but gone from the tree; restore it with git restore ${BASELINE}`
      ),
      run.stdout
    )
    assert.ok(!existsSync(join(root, BASELINE)), "a baseline was recorded over the committed one")
  })

  it("refuses while a Step fails, and records no baseline where there is none", () => {
    const root = withRatchet({ "src/big.ts": text(501) }, null, true, { steps: ["exit 1"] })
    const run = runBin(["gate", "--update-baseline"], root)
    assert.equal(run.status, 1)
    assert.ok(
      lines(run.stdout).includes(`gate: baseline ${BASELINE} not refreshed — a Step or another Check did not pass`),
      run.stdout
    )
    assert.throws(() => readBaseline(root), { code: "ENOENT" })
  })

  it("refuses a baseline it cannot read, and leaves it byte for byte as it was", () => {
    const root = withRatchet({ "src/big.ts": text(501) }, '{\n  "src/big.ts": 501,\n  "src/big.ts": 900\n}\n')
    const run = runBin(["gate", "--update-baseline"], root)
    assert.equal(run.status, 1)
    assert.ok(
      lines(run.stdout).includes(
        `gate: baseline ${BASELINE} not refreshed — it is not a baseline the Ratchet can read; fix the failures it names`
      ),
      run.stdout
    )
    assert.equal(readBaseline(root), '{\n  "src/big.ts": 501,\n  "src/big.ts": 900\n}\n')
  })

  it("says so when no Ratchet is turned on, and keeps the Gate's verdict", () => {
    const root = repo({ files: { [CONFIG]: { version: 1, gate: { steps: ["true"] } } } })
    const run = runBin(["gate", "--update-baseline"], root)
    assert.equal(run.status, 0, run.stdout)
    assert.deepEqual(timed(run.stdout), [
      "gate: step true — pass (N s)",
      "gate: no Ratchet is turned on, so no baseline to refresh",
      "gate: green — 1 step, 0 checks"
    ])
  })

  it("keeps stdout one document under --json and reports the refresh on stderr", () => {
    const root = withRatchet({ "src/legacy.ts": text(450) }, { "src/legacy.ts": 600 })
    const run = runBin(["gate", "--json", "--update-baseline"], root)
    assert.equal(run.status, 0, run.stderr)
    assert.equal(JSON.parse(run.stdout).status, "pass")
    assert.ok(lines(run.stderr).includes(`gate: baseline ${BASELINE} tightened — 1 file dropped`), run.stderr)
  })
})

describe("the file-size-ratchet Check's options", () => {
  it("puts a file in the first group with a glob that matches it, held to that group's maxLines", () => {
    const groups = [
      { name: "generated", maxLines: 5000, files: ["src/generated/**"] },
      { name: "code", maxLines: 10, files: ["**/*.ts"] }
    ]
    const root = withRatchet(
      { "src/generated/api.ts": text(4000), "src/app.ts": text(11), "test/app.test.ts": text(9) },
      {},
      {
        groups
      }
    )
    const run = runBin(["gate"], root)
    assert.equal(run.status, 1)
    assert.deepEqual(failures(run.stdout), [
      "src/app.ts: file-size-ratchet: 11 lines, over the 10-line limit of the code group — split it, or cut it to 10 lines"
    ])
  })

  it("counts a last line without its newline", () => {
    const groups = [{ name: "code", maxLines: 2, files: ["**/*.ts"] }]
    const root = withRatchet({ "a.ts": "1\n2\n3", "b.ts": "", "c.ts": "1\n2" }, {}, { groups })
    const run = runBin(["gate"], root)
    assert.deepEqual(failures(run.stdout), [
      "a.ts: file-size-ratchet: 3 lines, over the 2-line limit of the code group — split it, or cut it to 2 lines"
    ])
  })

  it("exits 2 outside a git repository", () => {
    const config = { version: 1, gate: { checks: { "file-size-ratchet": true } } }
    const run = runBin(["gate"], repo({ git: false, files: { [CONFIG]: config, [BASELINE]: {} } }))
    assert.equal(run.status, 2)
    assert.deepEqual(failures(run.stdout), [
      "file-size-ratchet: cannot list the files: not a git repository — run the Gate inside a git repository"
    ])
  })
})
