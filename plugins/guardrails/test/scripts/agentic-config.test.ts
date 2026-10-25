// The guards' copy of the config contract, `hooks/lib.sh` over `hooks/config.jq`, against the dw-sdlc
// package's resolver, which is the reference; and the config check the plugin runs from
// `scripts/agentic-config.ts`.

import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"

import { COMMITTED_FILE, LOCAL_FILE, type Problem, resolveConfig } from "../../dw-sdlc/src/agentic-config.ts"
import { commit, git, initRepo, REPO_ROOT, runBash, runScript, scratch, write } from "../harness.ts"

const LIB = join(import.meta.dirname, "..", "..", "hooks", "lib.sh")
const ORG_REMOTE = "git@github.com:acme/app.git"
/** A document no layer may carry: `forcePush` knows `deny`, `ask` and `lease`, never `allow`. */
const FORCE_PUSH_ALLOWED = { version: 1, guardrails: { forcePush: "allow" } }
/** This repository's committed config, its `references` key included. */
const OWN_CONFIG = readFileSync(join(REPO_ROOT, COMMITTED_FILE), "utf8")
/** A `references` key the references plugin refuses, which the guardrails schema never names (ADR 0007). */
const MALFORMED_REFERENCES = {
  guardrails: { protectedBranches: ["main"] },
  references: [{ dir: "../x", branch: "main" }, "kody"]
}

/** A throwaway repository; `files` maps a relative path to its text, an object is written as JSON. */
function repo(options: { git?: false; remote?: string; files?: Record<string, string | object> } = {}): string {
  const root = scratch("config")
  if (options.git !== false) {
    initRepo(root, options.remote === undefined ? {} : { remote: options.remote })
  }
  for (const [file, content] of Object.entries(options.files ?? {})) {
    write(join(root, file), typeof content === "string" ? content : JSON.stringify(content))
  }
  return root
}

/** The same resolution through hooks/lib.sh, the copy the guards run. */
function libResolve(root: string): { config: unknown; problems: string[] } {
  const script = `source "$1"; guard_config_load "$2" || exit 9; printf '%s\\n' "$GUARD_CONFIG"; printf '%s' "$GUARD_CONFIG_PROBLEMS"`
  const result = runBash(["-c", script, "lib", LIB, root], "")
  assert.equal(result.status, 0, result.stderr)
  const [first, ...rest] = result.stdout.split("\n")
  return { config: JSON.parse(first ?? ""), problems: rest.filter((line) => line !== "") }
}

function reportLines(problems: Problem[]): string[] {
  return problems.map(({ file, path, message }) =>
    path === "" ? `${file}: ${message}` : `${file}: ${path}: ${message}`
  )
}

describe("hooks/lib.sh agrees with resolveConfig", () => {
  const cases: [string, () => string][] = [
    [
      "on inference alone",
      () => repo({ remote: ORG_REMOTE, files: { ".ruby-version": "4.0.5\n", Gemfile: "", "pnpm-lock.yaml": "" } })
    ],
    [
      "on a committed file over inference",
      () =>
        repo({
          remote: ORG_REMOTE,
          files: {
            "package.json": "{}",
            [COMMITTED_FILE]: {
              baseBranch: "develop",
              guardrails: { forcePush: "deny" },
              commit: { trailer: "Co-Authored-By" }
            }
          }
        })
    ],
    [
      "on a committed convention",
      () => repo({ remote: ORG_REMOTE, files: { [COMMITTED_FILE]: { commit: { convention: "ticket-key" } } } })
    ],
    [
      "on a local convention under a committed pattern",
      () =>
        repo({
          remote: ORG_REMOTE,
          files: {
            [COMMITTED_FILE]: { commit: { pattern: "^x: .+" } },
            [LOCAL_FILE]: { commit: { convention: "conventional" } }
          }
        })
    ],
    [
      "on a malformed references key, left to its plugin",
      () => repo({ files: { [COMMITTED_FILE]: MALFORMED_REFERENCES } })
    ],
    [
      "on this repository's committed file and its references key",
      () => repo({ files: { [COMMITTED_FILE]: OWN_CONFIG } })
    ],
    [
      "on a committed file with schema violations",
      () => repo({ files: { [COMMITTED_FILE]: { version: 2, guardrails: { forcePush: "allow", extra: 1 } } } })
    ],
    [
      "on a loosening local file",
      () =>
        repo({
          files: {
            [COMMITTED_FILE]: { guardrails: { forcePush: "deny", protectedBranches: ["master", "production"] } },
            [LOCAL_FILE]: { baseBranch: "develop", guardrails: { forcePush: "lease", protectedBranches: ["master"] } }
          }
        })
    ],
    [
      "on a local lease under a committed ask",
      () =>
        repo({
          files: {
            [COMMITTED_FILE]: { guardrails: { forcePush: "ask" } },
            [LOCAL_FILE]: { guardrails: { forcePush: "lease" } }
          }
        })
    ],
    [
      "on a local ask over the default lease",
      () => repo({ files: { [LOCAL_FILE]: { guardrails: { forcePush: "ask" } } } })
    ],
    [
      "on a committed commitOnProtected deny",
      () => repo({ files: { [COMMITTED_FILE]: { guardrails: { commitOnProtected: "deny" } } } })
    ],
    [
      "on a local commitOnProtected deny over the default allow",
      () => repo({ files: { [LOCAL_FILE]: { guardrails: { commitOnProtected: "deny" } } } })
    ],
    [
      "on a local commitOnProtected allow under a committed deny",
      () =>
        repo({
          files: {
            [COMMITTED_FILE]: { guardrails: { commitOnProtected: "deny" } },
            [LOCAL_FILE]: { guardrails: { commitOnProtected: "allow" } }
          }
        })
    ],
    [
      "on a tightening local file",
      () =>
        repo({
          files: {
            [COMMITTED_FILE]: { guardrails: { protectedBranches: ["master"] } },
            [LOCAL_FILE]: { guardrails: { envFiles: { policy: "deny" }, protectedBranches: ["master", "staging"] } }
          }
        })
    ],
    [
      "on envFiles lists merged key by key",
      () =>
        repo({
          files: {
            [COMMITTED_FILE]: {
              guardrails: { envFiles: { allow: [".env", "**/.env.example"], deny: [".env.local"] } }
            },
            [LOCAL_FILE]: { guardrails: { envFiles: { allow: [".env"], deny: [".env.local", ".env.test"] } } }
          }
        })
    ],
    [
      "on a local file adding an allowed env file and dropping a denied one",
      () =>
        repo({
          files: {
            [COMMITTED_FILE]: { guardrails: { envFiles: { policy: "deny", deny: [".env.local"] } } },
            [LOCAL_FILE]: { guardrails: { envFiles: { policy: "git", allow: ["**/.env.example", ".env"], deny: [] } } }
          }
        })
    ]
  ]
  for (const [name, make] of cases) {
    it(name, () => {
      const root = make()
      const expected = resolveConfig(root)
      const actual = libResolve(root)
      assert.deepEqual(actual.config, expected.config)
      assert.deepEqual(actual.problems, reportLines(expected.problems))
    })
  }

  it("on a file that is not JSON, up to the parser's own words", () => {
    const root = repo({ files: { [COMMITTED_FILE]: "{ not json" } })
    const expected = resolveConfig(root)
    const actual = libResolve(root)
    assert.deepEqual(actual.config, expected.config)
    assert.equal(actual.problems.length, 1)
    assert.match(actual.problems[0] ?? "", new RegExp(`^${COMMITTED_FILE}: not JSON: `))
  })
})

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

  it("resolves the same through hooks/lib.sh", () => {
    for (const own of [{}, { [COMMITTED_FILE]: { baseBranch: "develop" } }]) {
      const { worktree } = withWorktree(MAIN_LAYERS, own)
      const expected = resolveConfig(worktree)
      const actual = libResolve(worktree)
      assert.deepEqual(actual.config, expected.config)
      assert.deepEqual(actual.problems, reportLines(expected.problems))
    }
  })

  it("gets the main checkout named as a layer's source by agentic:check", () => {
    const { main, worktree } = withWorktree(MAIN_LAYERS)
    const verdict = runScript("agentic-config", ["--root", worktree])
    assert.equal(verdict.status, 0, verdict.stderr)
    const line = `^local {6}\\.ai/agentic\\.config\\.local\\.json {2}valid, from ${escaped(main)}$`
    assert.match(verdict.stdout, new RegExp(line, "m"))
  })
})

describe("the agentic:check command", () => {
  it("validates this repository's committed file and exits 0", () => {
    const verdict = runScript("agentic-config", [COMMITTED_FILE], { cwd: REPO_ROOT })
    assert.equal(verdict.status, 0, verdict.stderr)
    assert.equal(verdict.stdout, `${COMMITTED_FILE}: valid\n`)
  })

  it("resolves a repository holding this one's config and its references key off the strictest set, exit 0", () => {
    assert.ok(Array.isArray(JSON.parse(OWN_CONFIG).references), "the committed config declares References")
    const root = repo({ files: { [COMMITTED_FILE]: OWN_CONFIG } })
    const verdict = runScript("agentic-config", ["--root", root])
    assert.equal(verdict.status, 0, verdict.stderr)
    assert.match(verdict.stdout, /^committed {2}\.ai\/agentic\.config\.json {2}valid$/m)
    assert.match(verdict.stdout, /"forcePush": "lease"/)
    assert.equal(verdict.stderr, "")
  })

  it("names the problem in a file that allows a force push and exits 1", () => {
    const root = repo({ git: false, files: { "agentic.config.json": FORCE_PUSH_ALLOWED } })
    const verdict = runScript("agentic-config", [join(root, "agentic.config.json")], { cwd: REPO_ROOT })
    assert.equal(verdict.status, 1)
    assert.match(verdict.stderr, /guardrails\.forcePush: "allow" is not one of "deny", "ask", "lease"/)
  })

  it("exits 1 when the repository's config is invalid, after printing what the guards see", () => {
    const root = repo({ files: { [COMMITTED_FILE]: "{ not json" } })
    const verdict = runScript("agentic-config", ["--root", root])
    assert.equal(verdict.status, 1)
    assert.match(verdict.stdout, /"forcePush": "deny"/)
    assert.match(verdict.stderr, /the guards run on the strictest defaults/)
  })

  it("--root inside a repository resolves the repository's top level", () => {
    const root = repo({ files: { [COMMITTED_FILE]: { baseBranch: "develop" }, "sub/x.txt": "" } })
    const verdict = runScript("agentic-config", ["--root", join(root, "sub")])
    assert.equal(verdict.status, 0, verdict.stderr)
    assert.match(verdict.stdout, /^committed {2}\.ai\/agentic\.config\.json {2}valid$/m)
    assert.match(verdict.stdout, /"baseBranch": "develop"/)
  })
})
