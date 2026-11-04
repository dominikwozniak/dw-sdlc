// The `markdown-budget` Check through `dw-sdlc gate`, on a throwaway repository whose docs break one
// budget at a time: the exit code and each failure line word for word.

import assert from "node:assert/strict"
import { symlinkSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"

import { lines, repo, runBin } from "../harness.ts"

const CONFIG = ".ai/agentic.config.json"
const REMEDY = "cut it, or split a topic into a file of its own"

/** Two agent docs within the default budget of `docs/agents/*.md`, and a 7000-byte doc no budget names. */
const TREE = {
  "docs/agents/domain.md": "# Domain\n\nThe glossary first.\n",
  "docs/agents/issue-tracker.md": "# Issue tracker\n",
  "docs/overview.md": "a line\n".repeat(1000)
}

/** A repository with `markdown-budget` set to `setting` under gate.checks, `TREE` with `files` over it. */
function withDocs(files: Record<string, string | object> = {}, setting: unknown = true): string {
  const config = { version: 1, gate: { checks: { "markdown-budget": setting } } }
  return repo({ files: { [CONFIG]: config, ...TREE, ...files } })
}

/** The failure lines of a Gate run that ran the one Check, its own `gate: check` line and the verdict cut. */
function failures(stdout: string): string[] {
  return lines(stdout).slice(1, -1)
}

describe("the markdown-budget Check", () => {
  it("passes an agent doc within 6144 bytes however many lines it has, and leaves a file no glob matches alone", () => {
    const run = runBin(["gate"], withDocs({ "docs/agents/domain.md": "x\n".repeat(3000) }))
    assert.equal(run.status, 0, run.stdout)
    assert.deepEqual(lines(run.stdout), ["gate: check markdown-budget", "gate: green — 0 steps, 1 check"])
  })

  it("fails each agent doc over 6144 bytes, by default", () => {
    const run = runBin(
      ["gate"],
      withDocs({
        "docs/agents/domain.md": "x\n".repeat(3073),
        "docs/agents/issue-tracker.md": `${"x".repeat(6144)}\n`
      })
    )
    assert.equal(run.status, 1)
    assert.deepEqual(failures(run.stdout), [
      `docs/agents/domain.md: markdown-budget: 6146 bytes, over the 6144-byte budget of docs/agents/*.md — ${REMEDY}`,
      `docs/agents/issue-tracker.md: markdown-budget: 6145 bytes, over the 6144-byte budget of docs/agents/*.md — ${REMEDY}`
    ])
  })

  it("fails a glob that matches no file", () => {
    const run = runBin(["gate"], withDocs({}, { budgets: [{ glob: "docs/agent/*.md", maxBytes: 100 }] }))
    assert.equal(run.status, 1)
    assert.deepEqual(failures(run.stdout), [
      'markdown-budget: "docs/agent/*.md" matches no file — fix the glob, or drop its budget'
    ])
  })

  it("judges a file once when a link to it matches too, a link to a file no glob matches, and no file git ignores", () => {
    const root = withDocs({
      ".gitignore": "docs/agents/local.md\n",
      "docs/agents/local.md": "a line\n".repeat(2000),
      "docs/agents/domain.md": "a line\n".repeat(1000)
    })
    symlinkSync("domain.md", join(root, "docs/agents/CLAUDE.md"))
    symlinkSync("../overview.md", join(root, "docs/agents/overview.md"))
    const run = runBin(["gate"], root)
    assert.equal(run.status, 1)
    assert.deepEqual(failures(run.stdout), [
      `docs/agents/domain.md: markdown-budget: 7000 bytes, over the 6144-byte budget of docs/agents/*.md — ${REMEDY}`,
      `docs/agents/overview.md: markdown-budget: 7000 bytes, over the 6144-byte budget of docs/agents/*.md — ${REMEDY}`
    ])
  })
})

describe("the markdown-budget Check's options", () => {
  it("holds the files of each glob in budgets to its own maxBytes", () => {
    const budgets = [
      { glob: "docs/**/*.md", maxBytes: 4096 },
      { glob: "docs/agents/*.md", maxBytes: 20 }
    ]
    const run = runBin(["gate"], withDocs({}, { budgets }))
    assert.equal(run.status, 1)
    assert.deepEqual(failures(run.stdout), [
      `docs/overview.md: markdown-budget: 7000 bytes, over the 4096-byte budget of docs/**/*.md — ${REMEDY}`,
      `docs/agents/domain.md: markdown-budget: 30 bytes, over the 20-byte budget of docs/agents/*.md — ${REMEDY}`
    ])
  })

  it("refuses a budget's maxLines: the Gate exits 2 naming the key and runs nothing", () => {
    const budgets = [{ glob: "docs/agents/*.md", maxLines: 100, maxBytes: 6144 }]
    const run = runBin(["gate"], withDocs({}, { budgets }))
    assert.equal(run.status, 2)
    assert.deepEqual(lines(run.stdout), [
      `${CONFIG}: config: gate.checks.markdown-budget.budgets[0]: unknown key "maxLines" — fix the file; the Gate runs once every layer is valid`,
      "gate: cannot run — 1 failure"
    ])
  })

  it("stays off under false", () => {
    const run = runBin(["gate"], withDocs({ "docs/agents/domain.md": "a line\n".repeat(1000) }, false))
    assert.equal(run.status, 0, run.stdout)
    assert.deepEqual(lines(run.stdout), ["gate: green — 0 steps, 0 checks"])
  })

  it("exits 2 outside a git repository, where it cannot list the files", () => {
    const config = { version: 1, gate: { checks: { "markdown-budget": true } } }
    const run = runBin(["gate"], repo({ git: false, files: { [CONFIG]: config, ...TREE } }))
    assert.equal(run.status, 2)
    assert.deepEqual(failures(run.stdout), [
      "markdown-budget: cannot list the files: not a git repository — run the Gate inside a git repository"
    ])
  })
})
