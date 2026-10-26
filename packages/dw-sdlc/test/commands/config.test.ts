// What `dw-sdlc config` prints and exits with: one file validated against the schema, or the layers of
// a repository resolved, a linked worktree's main checkout named as a layer's source.

import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"

import { COMMITTED_FILE, LOCAL_FILE } from "../../src/agentic-config.ts"
import { commit, git, REPO_ROOT, repo, runBin, scratch, write } from "../harness.ts"

/** A document no layer may carry: `forcePush` knows `deny`, `ask` and `lease`, never `allow`. */
const FORCE_PUSH_ALLOWED = { version: 1, guardrails: { forcePush: "allow" } }
/** This repository's committed config, its `references` key included. */
const OWN_CONFIG = readFileSync(join(REPO_ROOT, COMMITTED_FILE), "utf8")

/**
 * A main checkout holding `files` untracked, the way a repository keeps `.ai/` out of git, and a
 * linked worktree of it in a sibling directory holding `own`.
 */
function withWorktree(
  files: Record<string, object>,
  own: Record<string, object> = {}
): { main: string; worktree: string } {
  const main = repo({ files: { ...files, "README.md": "" } })
  git(main, "add", "README.md")
  commit(main, "-m", "init")
  const worktree = join(scratch("config-wt"), "wt")
  git(main, "worktree", "add", "-q", worktree, "-b", "wt")
  for (const [file, content] of Object.entries(own)) {
    write(join(worktree, file), JSON.stringify(content))
  }
  return { main, worktree }
}

function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

describe("a linked worktree", () => {
  const MAIN_LAYERS = {
    [COMMITTED_FILE]: { guardrails: { envFiles: { allow: [".env.test.local"] } } },
    [LOCAL_FILE]: { commit: { convention: "ticket-key" } }
  }

  it("gets the main checkout named as a layer's source by agentic:check", () => {
    const { main, worktree } = withWorktree(MAIN_LAYERS)
    const verdict = runBin(["config", "--root", worktree], REPO_ROOT)
    assert.equal(verdict.status, 0, verdict.stderr)
    const line = `^local {6}\\.ai/agentic\\.config\\.local\\.json {2}valid, from ${escaped(main)}$`
    assert.match(verdict.stdout, new RegExp(line, "m"))
  })
})

describe("the agentic:check command", () => {
  it("validates this repository's committed file and exits 0", () => {
    const verdict = runBin(["config", COMMITTED_FILE], REPO_ROOT)
    assert.equal(verdict.status, 0, verdict.stderr)
    assert.equal(verdict.stdout, `${COMMITTED_FILE}: valid\n`)
  })

  it("resolves a repository holding this one's config and its references key off the strictest set, exit 0", () => {
    assert.ok(Array.isArray(JSON.parse(OWN_CONFIG).references), "the committed config declares References")
    const root = repo({ files: { [COMMITTED_FILE]: OWN_CONFIG } })
    const verdict = runBin(["config", "--root", root], REPO_ROOT)
    assert.equal(verdict.status, 0, verdict.stderr)
    assert.match(verdict.stdout, /^committed {2}\.ai\/agentic\.config\.json {2}valid$/m)
    assert.match(verdict.stdout, /"forcePush": "lease"/)
    assert.equal(verdict.stderr, "")
  })

  it("names the problem in a file that allows a force push and exits 1", () => {
    const root = repo({ git: false, files: { "agentic.config.json": FORCE_PUSH_ALLOWED } })
    const verdict = runBin(["config", join(root, "agentic.config.json")], REPO_ROOT)
    assert.equal(verdict.status, 1)
    assert.match(verdict.stderr, /guardrails\.forcePush: "allow" is not one of "deny", "ask", "lease"/)
  })

  it("exits 1 when the repository's config is invalid, after printing what the guards see", () => {
    const root = repo({ files: { [COMMITTED_FILE]: "{ not json" } })
    const verdict = runBin(["config", "--root", root], REPO_ROOT)
    assert.equal(verdict.status, 1)
    assert.match(verdict.stdout, /"forcePush": "deny"/)
    assert.match(verdict.stderr, /the guards run on the strictest defaults/)
  })

  it("--root inside a repository resolves the repository's top level", () => {
    const root = repo({ files: { [COMMITTED_FILE]: { baseBranch: "develop" }, "sub/x.txt": "" } })
    const verdict = runBin(["config", "--root", join(root, "sub")], REPO_ROOT)
    assert.equal(verdict.status, 0, verdict.stderr)
    assert.match(verdict.stdout, /^committed {2}\.ai\/agentic\.config\.json {2}valid$/m)
    assert.match(verdict.stdout, /"baseBranch": "develop"/)
  })
})
