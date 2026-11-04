// The `decision-records` Check through `dw-sdlc gate`, on a throwaway repository whose records break one
// rule at a time: the exit code and each failure line word for word.

import assert from "node:assert/strict"
import { rmSync, symlinkSync } from "node:fs"
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
    assert.deepEqual(lines(run.stdout), ["gate: check decision-records — pass", "gate: green — 0 steps, 1 check"])
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

  it("leaves a record git ignores alone, and a link to no file", () => {
    const root = withRecords({ ".gitignore": "docs/adr/0004-draft.md\n", "docs/adr/0004-draft.md": "a draft\n" })
    symlinkSync("gone.md", join(root, "docs/adr/0005-dangling.md"))
    const run = runBin(["gate"], root)
    assert.equal(run.status, 0, run.stdout)
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

  it("judges no field beyond status unless fields names it, by default or under an empty list", () => {
    const files = {
      "docs/adr/0001-guards-ship-here.md": recordWith("accepted", ["date: 17-10-2026", "amended-by: 0009"]),
      "docs/adr/0002-the-sync-is-a-plugin.md": recordWith("superseded", ["touches:", "  - src/gone.ts"]),
      "docs/adr/0003-one-plugin.md": recordWith("active", ["superseded-by: 0009"])
    }
    for (const setting of [true, { fields: [] }]) {
      const run = runBin(["gate"], withRecords(files, setting))
      assert.equal(run.status, 0, run.stdout)
    }
  })

  it("reads the first status that has a value", () => {
    const run = runBin(
      ["gate"],
      withRecords({ "docs/adr/0001-guards-ship-here.md": recordWith("", ["status: accepted"]) })
    )
    assert.equal(run.status, 0, run.stdout)
  })

  it("stays off under false", () => {
    const run = runBin(["gate"], withRecords({ "docs/adr/0009-far.md": record("approved", "Far") }, false))
    assert.equal(run.status, 0, run.stdout)
    assert.deepEqual(lines(run.stdout), ["gate: green — 0 steps, 0 checks"])
  })
})

/** A record whose frontmatter is `fields`, one line each, under the status `status`. */
function recordWith(status: string, fields: string[], title = "A decision"): string {
  return `---\nstatus: ${status}\n${fields.map((line) => `${line}\n`).join("")}---\n\n# ${title}\n`
}

describe("the decision-records Check's date field", () => {
  const DATED = { fields: ["date"] }

  it("passes a record dated YYYY-MM-DD, a comment after the date left out", () => {
    const run = runBin(
      ["gate"],
      withRecords(
        {
          "docs/adr/0001-guards-ship-here.md": recordWith("accepted", ["date: 2026-10-17"]),
          "docs/adr/0002-the-sync-is-a-plugin.md": recordWith("superseded", ['date: "2026-02-28"']),
          "docs/adr/0003-one-plugin.md": recordWith("proposed", ["date: 2024-02-29 # the day it was decided"])
        },
        DATED
      )
    )
    assert.equal(run.status, 0, run.stdout)
  })

  it("fails a record with no date, and a date that is not a YYYY-MM-DD day", () => {
    const run = runBin(
      ["gate"],
      withRecords(
        {
          "docs/adr/0001-guards-ship-here.md": recordWith("accepted", ["date: 17-10-2026"]),
          "docs/adr/0003-one-plugin.md": recordWith("proposed", ["date: 2026-02-30"])
        },
        DATED
      )
    )
    assert.equal(run.status, 1)
    assert.deepEqual(failures(run.stdout), [
      'docs/adr/0001-guards-ship-here.md:3: decision-records: the date "17-10-2026" is not a YYYY-MM-DD day — write the day the decision was made as YYYY-MM-DD',
      "docs/adr/0002-the-sync-is-a-plugin.md: decision-records: has no date — give its frontmatter the day the decision was made, as date: YYYY-MM-DD",
      'docs/adr/0003-one-plugin.md:3: decision-records: the date "2026-02-30" is not a YYYY-MM-DD day — write the day the decision was made as YYYY-MM-DD'
    ])
  })
})

describe("the decision-records Check's touches field", () => {
  const TOUCHES = { fields: ["touches"] }
  const SOURCE = {
    "src/db/client.ts": "export {}\n",
    "src/ui/button.css": "a {}\n",
    "src/app/(app)/path/[id].tsx": "export {}\n"
  }

  it("passes a record in force that names files, directories and globs that exist, a route's brackets in a file's name, and a superseded one that names none", () => {
    const run = runBin(
      ["gate"],
      withRecords(
        {
          ...SOURCE,
          "docs/adr/0001-guards-ship-here.md": recordWith("accepted", [
            "touches:",
            "  - src/db/client.ts",
            '  - "src/ui/"',
            "  - src/app/(app)/path/[id].tsx"
          ]),
          "docs/adr/0002-the-sync-is-a-plugin.md": recordWith("superseded by ADR 0003", []),
          "docs/adr/0003-one-plugin.md": recordWith("active", [
            "touches: src/**/*.css, ./src/db, src/{db,ui}/*.{ts,css}"
          ])
        },
        TOUCHES
      )
    )
    assert.equal(run.status, 0, run.stdout)
  })

  it("fails a record in force that names no path, a path that is not in the tree and a glob that matches no file", () => {
    const run = runBin(
      ["gate"],
      withRecords(
        {
          ...SOURCE,
          ".gitignore": "src/secret.ts\n",
          "src/secret.ts": "export {}\n",
          "docs/adr/0001-guards-ship-here.md": recordWith("accepted", []),
          "docs/adr/0002-the-sync-is-a-plugin.md": recordWith("active", ["touches:"]),
          "docs/adr/0003-one-plugin.md": recordWith("accepted", [
            "touches:",
            "  - src/db/client.ts",
            "  - src/db/gone.ts",
            "  - src/secret.ts",
            "  - src/**/*.scss"
          ])
        },
        TOUCHES
      )
    )
    assert.equal(run.status, 1)
    assert.deepEqual(failures(run.stdout), [
      "docs/adr/0001-guards-ship-here.md: decision-records: names no path under touches — list under touches the paths it governs",
      "docs/adr/0002-the-sync-is-a-plugin.md: decision-records: names no path under touches — list under touches the paths it governs",
      'docs/adr/0003-one-plugin.md:5: decision-records: touches "src/db/gone.ts", which does not exist — fix the path or drop it from touches',
      'docs/adr/0003-one-plugin.md:6: decision-records: touches "src/secret.ts", which git ignores — name the paths git tracks that it governs, or drop it from touches',
      'docs/adr/0003-one-plugin.md:7: decision-records: touches "src/**/*.scss", which matches no file — fix the glob or drop it from touches'
    ])
  })

  it("fails a superseded record that still names a path under touches, and leaves a proposed or deprecated one free to name none", () => {
    const run = runBin(
      ["gate"],
      withRecords(
        {
          ...SOURCE,
          "docs/adr/0001-guards-ship-here.md": recordWith("deprecated", []),
          "docs/adr/0004-later.md": recordWith("superseded", ["touches: []"]),
          "docs/adr/0002-the-sync-is-a-plugin.md": recordWith("superseded by ADR 0003", [
            "touches:",
            "  - src/db/client.ts"
          ])
        },
        TOUCHES
      )
    )
    assert.equal(run.status, 1)
    assert.deepEqual(failures(run.stdout), [
      "docs/adr/0002-the-sync-is-a-plugin.md:3: decision-records: is superseded and still names touches — drop touches: the record that replaces it governs those paths"
    ])
  })
})

describe("the decision-records Check's superseded-by field", () => {
  const SUCCESSORS = { fields: ["superseded-by"] }

  it("passes a superseded record that names each record replacing it, by its number padded or not", () => {
    const run = runBin(
      ["gate"],
      withRecords(
        {
          "docs/adr/0001-guards-ship-here.md": recordWith("superseded", ["superseded-by: 0003, 2"]),
          "docs/adr/0002-the-sync-is-a-plugin.md": recordWith("superseded by ADR 0003", ["superseded-by:", "  - 0003"])
        },
        SUCCESSORS
      )
    )
    assert.equal(run.status, 0, run.stdout)
  })

  it("fails a superseded record that names no successor, and a successor no record is numbered", () => {
    const run = runBin(
      ["gate"],
      withRecords(
        {
          "docs/adr/0001-guards-ship-here.md": recordWith("superseded", []),
          "docs/adr/0002-the-sync-is-a-plugin.md": recordWith("superseded by ADR 0003", ["superseded-by: 0003, 0009"]),
          "docs/adr/0003-one-plugin.md": recordWith("accepted", ["superseded-by:", "  - ADR 0004"])
        },
        SUCCESSORS
      )
    )
    assert.equal(run.status, 1)
    assert.deepEqual(failures(run.stdout), [
      "docs/adr/0001-guards-ship-here.md: decision-records: is superseded but names no successor under superseded-by — name under superseded-by the number of each record that replaces it",
      'docs/adr/0002-the-sync-is-a-plugin.md:3: decision-records: superseded-by names "0009", which is not the number of a record — name the number of each record that replaces it',
      'docs/adr/0003-one-plugin.md:4: decision-records: superseded-by names "ADR 0004", which is not the number of a record — name the number of each record that replaces it'
    ])
  })
})

describe("the decision-records Check's amended-by field", () => {
  const AMENDMENTS = { fields: ["amended-by"] }

  it("passes a record that names no amendment, or only records that exist", () => {
    const run = runBin(
      ["gate"],
      withRecords(
        { "docs/adr/0001-guards-ship-here.md": recordWith("accepted", ["amended-by: [0002, 0003]"]) },
        AMENDMENTS
      )
    )
    assert.equal(run.status, 0, run.stdout)
  })

  it("fails each amendment no record is numbered", () => {
    const run = runBin(
      ["gate"],
      withRecords(
        {
          "docs/adr/0001-guards-ship-here.md": recordWith("accepted", ["amended-by: 0003, 0012 # the later records"]),
          "docs/adr/0003-one-plugin.md": recordWith("proposed", ["amended-by:", "  - 0001", "  - next"])
        },
        AMENDMENTS
      )
    )
    assert.equal(run.status, 1)
    assert.deepEqual(failures(run.stdout), [
      'docs/adr/0001-guards-ship-here.md:3: decision-records: amended-by names "0012", which is not the number of a record — name the number of each record that amends it',
      'docs/adr/0003-one-plugin.md:5: decision-records: amended-by names "next", which is not the number of a record — name the number of each record that amends it'
    ])
  })
})

/** A record the way the template writes one: its number under `decision` and in its title. */
function template(number: string, status: string, fields: string[]): string {
  return recordWith(status, [`decision: ${number}`, ...fields], `${number} — A decision`)
}

describe("the decision-records Check's fields together", () => {
  it("judges every field it is given on the template's records", () => {
    const root = withRecords(
      {
        "src/db/client.ts": "export {}\n",
        "docs/decisions/0001-own-database.md": template("0001", "active # active | superseded", [
          "amended-by: 0003",
          "date: 2026-08-09",
          "touches:",
          "  - src/db/client.ts"
        ]),
        "docs/decisions/0002-old-areas.md": template("0002", "superseded", ["date: 2026-08-10", "superseded-by: 0003"]),
        "docs/decisions/0003-new-areas.md": template("0003", "active", ["date: 2026-08-11", "touches:", "  - src/db"])
      },
      {
        dirs: ["docs/decisions"],
        statuses: ["active", "superseded"],
        fields: ["date", "touches", "superseded-by", "amended-by"]
      }
    )
    rmSync(join(root, "docs/adr"), { recursive: true })
    const run = runBin(["gate"], root)
    assert.equal(run.status, 0, run.stdout)
  })
})
