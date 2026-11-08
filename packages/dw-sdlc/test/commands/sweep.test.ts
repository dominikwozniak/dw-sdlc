// `dw-sdlc sweep` spawned on throwaway clones of a bare origin: the branches left after the run, the lines
// or the document, the exit code and what origin holds. Never on this repository: its branches are other
// sessions' work.

import assert from "node:assert/strict"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { before, describe, it } from "node:test"

import {
  buildLandedRepo,
  LANDED_SCENARIOS,
  type LandedScenario
} from "../../../../plugins/sdlc/test/landed-scenarios.ts"
import { git, lines, runBin, scratch, writeJson } from "../harness.ts"

/** The line of a Sweep outside herdr, where no terminal is read. */
const NOT_READ = "terminals not read — outside herdr, $HC_TERMINAL_ID is not set"

type Item = { kind: string; name: string; reason: string; command?: string | null }
type Document = { dryRun: boolean; base: string; removed: Item[]; kept: Item[] }

/** A clone of a new bare origin, on main, with a branch for each scenario given. */
function clone(scenarios = LANDED_SCENARIOS): { root: string; origin: string } {
  const dir = scratch("sweep")
  const origin = join(dir, "origin.git")
  return { root: buildLandedRepo(join(dir, "clone"), origin, scenarios), origin }
}

/** Whether the row's branch is Landed once the Sweep has fetched. */
function landedOnceFetched({ landed, landedAfterFetch }: LandedScenario): boolean {
  return landedAfterFetch ?? landed
}

function branches(root: string): string[] {
  return lines(git(root, "for-each-ref", "--format=%(refname:short)", "refs/heads"))
}

function documentOf(stdout: string): Document {
  return JSON.parse(stdout) as Document
}

function refsOf(origin: string): string {
  return git(origin, "for-each-ref")
}

describe("every row of the shared table of Landed scenarios", () => {
  let root: string
  let origin: string
  let refsBefore: string
  let refsAfter: string
  let run: ReturnType<typeof runBin>
  let remaining: string[]

  before(() => {
    ;({ root, origin } = clone())
    refsBefore = refsOf(origin)
    run = runBin(["sweep", "--json"], root)
    refsAfter = refsOf(origin)
    remaining = branches(root)
  })

  for (const scenario of LANDED_SCENARIOS) {
    const { name, branch } = scenario
    const goes = landedOnceFetched(scenario)
    it(`${name}: the branch ${goes ? "is removed" : "is kept"}`, () => {
      assert.equal(remaining.includes(branch), !goes, run.stderr)
    })
  }

  it("names each branch it keeps with a reason, and the forced delete for one that is not Landed", () => {
    const { removed, kept } = documentOf(run.stdout)
    const notLanded = LANDED_SCENARIOS.filter((scenario) => !landedOnceFetched(scenario))
    for (const { branch } of notLanded) {
      const item = kept.find(({ name }) => name === branch)
      assert.equal(item?.command, `git branch -D ${branch}`)
      assert.match(item?.reason ?? "", /on no commit of origin\/main/)
    }
    const main = kept.find(({ name }) => name === "main")
    assert.deepEqual(main, { kind: "branch", name: "main", reason: "the default branch", command: null })
    assert.deepEqual(
      removed.map(({ name }) => name).toSorted(),
      LANDED_SCENARIOS.filter(landedOnceFetched)
        .map(({ branch }) => branch)
        .toSorted()
    )
    assert.equal(run.status, 1)
  })

  it("changes no ref of origin", () => {
    assert.equal(refsAfter, refsBefore)
  })
})

describe("what stays whatever its work", () => {
  it("keeps the default branch, a protected branch and a branch a worktree has checked out, each with its reason", () => {
    const { root } = clone([])
    git(root, "branch", "release")
    git(root, "branch", "held")
    const held = join(scratch("held"), "tree")
    git(root, "worktree", "add", "-q", held, "held")
    writeFileSync(join(held, "wip.txt"), "wip\n")
    git(root, "branch", "plain")
    writeJson(join(root, ".ai/agentic.config.json"), { version: 1, guardrails: { protectedBranches: ["release"] } })
    const run = runBin(["sweep", "--json"], root)
    const { removed, kept } = documentOf(run.stdout)
    assert.deepEqual(
      removed.map(({ name }) => name),
      ["plain"]
    )
    const reasons = Object.fromEntries(kept.map(({ name, reason }) => [name, reason]))
    assert.deepEqual(reasons, {
      [held]: "modified or untracked: wip.txt",
      main: "the default branch",
      release: "a protected branch",
      held: `checked out in the worktree at ${held}`
    })
    assert.deepEqual(branches(root).toSorted(), ["held", "main", "release"])
    assert.equal(run.status, 1)
  })

  it("reads the base from baseBranch of the config, which then stays as well", () => {
    const { root } = clone([])
    git(root, "push", "-q", "origin", "main:develop")
    git(root, "remote", "set-head", "origin", "main")
    git(root, "branch", "develop", "origin/develop")
    git(root, "branch", "plain")
    writeJson(join(root, ".ai/agentic.config.json"), { version: 1, baseBranch: "develop" })
    const run = runBin(["sweep", "--json"], root)
    const { removed, kept, base } = documentOf(run.stdout)
    assert.equal(run.status, 0)
    assert.equal(base, "origin/develop")
    assert.deepEqual(
      removed.map(({ name }) => name),
      ["plain"]
    )
    assert.deepEqual(
      kept.map(({ name, reason }) => [name, reason]),
      [
        ["develop", "the base branch"],
        ["main", "the default branch"]
      ]
    )
  })
})

describe("what the dev sees", () => {
  it("prints a line an item, and the command beside a branch kept for its work", () => {
    const { root } = clone(LANDED_SCENARIOS.filter(({ branch }) => ["merged", "never"].includes(branch)))
    const run = runBin(["sweep"], root)
    assert.deepEqual(lines(run.stdout), [
      "removed branch merged — Landed on origin/main",
      "kept branch main — the default branch",
      "kept branch never — its work is on no commit of origin/main since it forked; to remove it yourself: git branch -D never",
      NOT_READ
    ])
    assert.equal(run.status, 1)
  })

  it("exits 0 when nothing is kept", () => {
    const { root } = clone(LANDED_SCENARIOS.filter(({ branch }) => branch === "merged"))
    git(root, "switch", "-q", "--detach")
    git(root, "branch", "-D", "main")
    const run = runBin(["sweep"], root)
    assert.deepEqual(lines(run.stdout), ["removed branch merged — Landed on origin/main", NOT_READ])
    assert.equal(run.status, 0)
    assert.deepEqual(branches(root), [])
  })

  it("--dry-run removes nothing and answers the same items", () => {
    const { root } = clone()
    const first = documentOf(runBin(["sweep", "--dry-run", "--json"], root).stdout)
    assert.equal(first.dryRun, true)
    const kept = branches(root)
    assert.deepEqual(kept.toSorted(), ["main", ...LANDED_SCENARIOS.map(({ branch }) => branch)].toSorted())
    const real = documentOf(runBin(["sweep", "--json"], root).stdout)
    assert.deepEqual({ ...first, dryRun: false }, real)
    assert.match(runBin(["sweep", "--dry-run"], root).stdout, /^kept branch main/m)
  })

  it("--dry-run says it would remove, and exits as the real run would", () => {
    const { root } = clone(LANDED_SCENARIOS.filter(({ branch }) => branch === "merged"))
    const run = runBin(["sweep", "--dry-run"], root)
    assert.deepEqual(lines(run.stdout), [
      "would remove branch merged — Landed on origin/main",
      "kept branch main — the default branch",
      NOT_READ
    ])
    assert.equal(run.status, 0)
  })

  it("keeps a branch git refuses to delete, with git's words, and goes on", () => {
    const { root } = clone(LANDED_SCENARIOS.filter(({ branch }) => ["merged", "ff"].includes(branch)))
    writeFileSync(join(root, ".git/refs/heads/ff.lock"), "")
    const { removed, kept } = documentOf(runBin(["sweep", "--json"], root).stdout)
    assert.deepEqual(
      removed.map(({ name }) => name),
      ["merged"]
    )
    const refused = kept.find(({ name }) => name === "ff")
    assert.match(refused?.reason ?? "", /ff\.lock/)
    assert.equal(refused?.command, "git branch -D ff")
    assert.ok(branches(root).includes("ff"))
  })

  it("rejects an argument", () => {
    const run = runBin(["sweep", "merged"], clone([]).root)
    assert.equal(run.status, 2)
    assert.match(run.stderr, /takes no argument/)
  })
})

describe("what stops it before anything is removed", () => {
  const merged = LANDED_SCENARIOS.filter(({ branch }) => branch === "merged")

  it("exits 2 when origin/HEAD names no base", () => {
    const { root } = clone(merged)
    git(root, "remote", "set-head", "origin", "-d")
    // Since git 2.48 a fetch creates a missing origin/HEAD, unless the remote says otherwise.
    git(root, "config", "remote.origin.followRemoteHEAD", "never")
    const run = runBin(["sweep"], root)
    assert.equal(run.status, 2)
    assert.match(run.stderr, /no base branch is known/)
    assert.ok(branches(root).includes("merged"))
  })

  it("exits 2 when the repository has no origin", () => {
    const { root } = clone(merged)
    git(root, "remote", "remove", "origin")
    const run = runBin(["sweep"], root)
    assert.equal(run.status, 2)
    assert.match(run.stderr, /no base branch is known/)
    assert.ok(branches(root).includes("merged"))
  })

  it("exits 2 when baseBranch names a branch origin lacks", () => {
    const { root } = clone(merged)
    writeJson(join(root, ".ai/agentic.config.json"), { version: 1, baseBranch: "develop" })
    const run = runBin(["sweep"], root)
    assert.equal(run.status, 2)
    assert.match(run.stderr, /origin\/develop is not here/)
    assert.ok(branches(root).includes("merged"))
  })

  it("exits 2 when the fetch fails", () => {
    const { root } = clone(merged)
    git(root, "remote", "set-url", "origin", join(scratch("none"), "gone.git"))
    const run = runBin(["sweep"], root)
    assert.equal(run.status, 2)
    assert.match(run.stderr, /git fetch origin failed/)
    assert.ok(branches(root).includes("merged"))
  })

  it("exits 2 in a linked worktree, with the line to run it from the main checkout", () => {
    const { root } = clone(merged)
    const linked = join(scratch("linked"), "tree")
    git(root, "worktree", "add", "-q", "-b", "topic", linked)
    const run = runBin(["sweep"], linked)
    assert.equal(run.status, 2)
    assert.match(run.stderr, new RegExp(`run it from the main checkout: cd ${root} && dw-sdlc sweep`))
    assert.ok(branches(root).includes("merged"))
  })

  it("exits 2 outside a repository", () => {
    const run = runBin(["sweep"], scratch("plain"))
    assert.equal(run.status, 2)
    assert.match(run.stderr, /no git repository/)
  })
})

describe("the usage", () => {
  it("prints with --help", () => {
    const run = runBin(["sweep", "--help"], scratch("help"))
    assert.equal(run.status, 0)
    assert.match(run.stdout, /^Usage: dw-sdlc sweep \[--dry-run\] \[--json\]/)
  })

  it("sits in the bin's list of commands", () => {
    assert.match(
      runBin(["--help"], scratch("list")).stdout,
      /^ {2}sweep {2,}removes Landed branches and clean worktrees/m
    )
  })
})
