// The `decision-records` Check through `dw-sdlc gate`, on a throwaway repository whose records break one
// rule at a time: the exit code and each failure line word for word.

import assert from "node:assert/strict"
import { rmSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"

import { lines, repo, runBin } from "../harness.ts"

const CONFIG = ".ai/agentic.config.json"
const STATUSES = "proposed, accepted, active, deprecated, superseded"

function record(status: string, title: string): string {
  return `---\nstatus: ${status}\n---\n\n# ${title}\n\nThe decision and why.\n`
}

/** Records numbered 0001 to 0003 the way this repository writes them, and an index that is not one. */
const TREE = {
  "docs/adr/0001-guards-ship-here.md": record("accepted", "Guards ship from this marketplace"),
  "docs/adr/0002-the-sync-is-a-plugin.md": record("superseded by ADR 0003", "The Sync ships as a plugin"),
  "docs/adr/0003-one-plugin.md": record("proposed", "One plugin carries everything"),
  "docs/adr/README.md": "# Decisions\n"
}

/** A repository with `decision-records` set to `setting` under gate.checks, `TREE` with `files` over it. */
function withRecords(files: Record<string, string | object> = {}, setting: unknown = true): string {
  const config = { version: 1, gate: { checks: { "decision-records": setting } } }
  return repo({ files: { [CONFIG]: config, ...TREE, ...files } })
}

/** The failure lines of a Gate run that ran the one Check, its own `gate: check` line and the verdict cut. */
function failures(stdout: string): string[] {
  return lines(stdout).slice(1, -1)
}

describe("the decision-records Check", () => {
  it("passes records numbered without a gap, each with a title and an allowed status", () => {
    const run = runBin(["gate"], withRecords())
    assert.equal(run.status, 0, run.stdout)
    assert.deepEqual(lines(run.stdout), ["gate: check decision-records", "gate: green — 0 steps, 1 check"])
  })

  it("passes the template's records under docs/decisions by default", () => {
    const root = withRecords({
      "docs/decisions/0001-vite-plus.md":
        "---\ndecision: 0001\nstatus: active\ndate: 2026-10-17\nrule: Vite+ runs it all\n---\n\n# 0001 — Vite+ is the one toolchain\n"
    })
    rmSync(join(root, "docs/adr"), { recursive: true })
    const run = runBin(["gate"], root)
    assert.equal(run.status, 0, run.stdout)
  })

  it("fails each number the records skip, a run of them as one range", () => {
    const root = withRecords({ "docs/adr/0007-later.md": record("accepted", "Later") })
    rmSync(join(root, "docs/adr/0001-guards-ship-here.md"))
    const run = runBin(["gate"], root)
    assert.equal(run.status, 1)
    assert.deepEqual(failures(run.stdout), [
      "docs/adr: decision-records: no record is numbered 0001 — restore the missing records, or renumber the ones after the gap",
      "docs/adr: decision-records: no record is numbered 0004 to 0006 — restore the missing records, or renumber the ones after the gap"
    ])
  })

  it("fails a number two records take", () => {
    const run = runBin(["gate"], withRecords({ "docs/adr/0002-another.md": record("accepted", "Another") }))
    assert.equal(run.status, 1)
    assert.deepEqual(failures(run.stdout), [
      "docs/adr/0002-the-sync-is-a-plugin.md: decision-records: 0002 is taken by docs/adr/0002-another.md — give each record a number of its own"
    ])
  })

  it("fails a record with no title, a heading inside a code fence not counted", () => {
    const untitled = "---\nstatus: accepted\n---\n\n```md\n# Not a title\n```\n\n## Context\n"
    const run = runBin(["gate"], withRecords({ "docs/adr/0003-one-plugin.md": untitled }))
    assert.equal(run.status, 1)
    assert.deepEqual(failures(run.stdout), [
      "docs/adr/0003-one-plugin.md: decision-records: has no title — start it with a level-1 heading that names the decision"
    ])
  })

  it("fails a record with no status in its frontmatter, and a status the allowed set does not hold", () => {
    const run = runBin(
      ["gate"],
      withRecords({
        "docs/adr/0002-the-sync-is-a-plugin.md": "# The Sync ships as a plugin\n\nstatus: accepted\n",
        "docs/adr/0003-one-plugin.md": record("approved", "One plugin carries everything")
      })
    )
    assert.equal(run.status, 1)
    assert.deepEqual(failures(run.stdout), [
      `docs/adr/0002-the-sync-is-a-plugin.md: decision-records: has no status — give its frontmatter a status, one of ${STATUSES}`,
      `docs/adr/0003-one-plugin.md:2: decision-records: the status "approved" is not allowed — set it to one of ${STATUSES}`
    ])
  })

  it("exits 2 when none of its directories exists", () => {
    const root = withRecords()
    rmSync(join(root, "docs"), { recursive: true })
    const run = runBin(["gate"], root)
    assert.equal(run.status, 2)
    assert.deepEqual(failures(run.stdout), [
      "decision-records: none of docs/adr, docs/decisions exists — create the records directory, or point gate.checks.decision-records.dirs at it"
    ])
  })
})

describe("the decision-records Check's options", () => {
  it("reads the records from dirs and holds them to statuses", () => {
    const files = {
      "records/0001-first.md": record("draft", "First"),
      "records/0002-second.md": record("accepted", "Second")
    }
    const run = runBin(["gate"], withRecords(files, { dirs: ["records"], statuses: ["draft", "final"] }))
    assert.equal(run.status, 1)
    assert.deepEqual(failures(run.stdout), [
      'records/0002-second.md:2: decision-records: the status "accepted" is not allowed — set it to one of draft, final'
    ])
  })

  it("stays off under false", () => {
    const run = runBin(["gate"], withRecords({ "docs/adr/0009-far.md": record("approved", "Far") }, false))
    assert.equal(run.status, 0, run.stdout)
    assert.deepEqual(lines(run.stdout), ["gate: green — 0 steps, 0 checks"])
  })
})
