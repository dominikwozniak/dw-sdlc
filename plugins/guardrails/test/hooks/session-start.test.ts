// What session-start.sh tells a fresh session, fed the real SessionStart payload against a throwaway
// repository with a linked worktree: the .worktreeinclude files the worktree still lacks, the
// worktree.setup commands, an invalid config, a missing jq — and nothing at all
// from a main checkout that is in order.

import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmodSync, copyFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { before, describe, it } from "node:test"

import { commit, expectExit, git, initRepo, runHook, scratch, write, writeJson } from "../harness.ts"

const TMP = scratch("session")

// The main checkout: two ignored files .worktreeinclude names, and setup commands in the committed
// config.
const MAIN = initRepo(join(TMP, "main"), { branch: "main" })
write(join(MAIN, ".gitignore"), ".env.development\nconfig/local.json\n.claude/worktrees/\n")
write(join(MAIN, ".worktreeinclude"), ".env.development\nconfig/local.json\n")
writeJson(join(MAIN, ".ai", "agentic.config.json"), {
  worktree: { setup: ["pnpm install --frozen-lockfile", "pnpm build"] }
})
write(join(MAIN, "README.md"), "")
write(join(MAIN, ".env.development"), "SECRET=1\n")
write(join(MAIN, "config", "local.json"), "")
git(MAIN, "add", ".gitignore", ".worktreeinclude", ".ai/agentic.config.json", "README.md")
commit(MAIN, "-m", "init")
const WT = join(MAIN, ".claude", "worktrees", "wt")
git(MAIN, "worktree", "add", "-q", WT, "-b", "wt")

function payload(cwd: string): object {
  return { hook_event_name: "SessionStart", source: "startup", cwd }
}
/** The hook's stdout for a session starting at `cwd`, with PATH replaced when given. A report never blocks: exit 0. */
function stdoutOf(cwd: string, path?: string): string {
  const verdict = runHook("session-start", payload(cwd), { env: path === undefined ? undefined : { PATH: path } })
  expectExit(verdict, 0)
  return verdict.stdout
}
/** The additionalContext the hook returns, trailing newlines dropped as `$(…)` drops them. */
function report(cwd: string, path?: string): string {
  const out = stdoutOf(cwd, path)
  if (out.trim() === "") {
    return ""
  }
  const parsed = JSON.parse(out) as { hookSpecificOutput?: { additionalContext?: string } }
  return (parsed.hookSpecificOutput?.additionalContext ?? "").replace(/\n+$/, "")
}
function has(haystack: string, needle: string): void {
  assert.ok(haystack.includes(needle), `[${needle}] not in [${haystack}]`)
}
function lacks(haystack: string, needle: string): void {
  assert.ok(!haystack.includes(needle), `[${needle}] found in [${haystack}]`)
}
function lineCount(text: string): number {
  return text.split("\n").length
}
/** A PATH holding wrappers for the named tools and nothing else. */
function sandbox(dir: string, tools: string[]): string {
  mkdirSync(dir, { recursive: true })
  for (const tool of tools) {
    const found = spawnSync("bash", ["-c", 'command -v "$1"', "which", tool], { encoding: "utf8" })
    if (found.status !== 0) {
      continue
    }
    write(join(dir, tool), `#!/bin/sh\nexec ${found.stdout.trim()} "$@"\n`)
    chmodSync(join(dir, tool), 0o755)
  }
  return dir
}
const TOOLS = ["bash", "git", "jq", "sed", "tr", "grep", "sort", "comm", "cat", "head", "dirname", "awk"]

describe("a main checkout in order says nothing", () => {
  it("no report from main", () => {
    assert.equal(report(MAIN), "")
  })
  it("no stdout at all from main", () => {
    assert.equal(stdoutOf(MAIN), "")
  })
})

describe("a fresh linked worktree gets the two lines", () => {
  let R = ""
  before(() => {
    R = report(WT)
  })
  it("missing include files, in order", () => {
    has(R, "worktree: .worktreeinclude files not present here: .env.development, config/local.json")
  })
  it("where to copy them from", () => {
    has(R, `Copy them from ${MAIN}`)
  })
  it("setup commands", () => {
    has(R, "a fresh checkout still needs: pnpm install --frozen-lockfile; pnpm build")
  })
  it("exactly two lines", () => {
    assert.equal(lineCount(R), 2)
  })
})

describe("copied files drop off the list", () => {
  let R = ""
  before(() => {
    copyFileSync(join(MAIN, ".env.development"), join(WT, ".env.development"))
    R = report(WT)
  })
  it("the one still missing", () => {
    has(R, "not present here: config/local.json.")
  })
  it("the copied one gone", () => {
    lacks(R, ".env.development")
  })
  describe("once all are there", () => {
    let R2 = ""
    before(() => {
      mkdirSync(join(WT, "config"), { recursive: true })
      copyFileSync(join(MAIN, "config", "local.json"), join(WT, "config", "local.json"))
      R2 = report(WT)
    })
    it("no include line once all are there", () => {
      lacks(R2, "worktreeinclude")
    })
    it("one line left", () => {
      assert.equal(lineCount(R2), 1)
    })
  })
})

describe("an invalid config is one loud line, in the main checkout too", () => {
  let R = ""
  before(() => {
    writeJson(join(MAIN, ".ai", "agentic.config.json"), { guardrails: { forcePush: "allow" } })
    R = report(MAIN)
  })
  it("invalid, strictest", () => {
    has(R, "agentic config: INVALID, the guards run on the strictest defaults until it is fixed")
  })
  it("the problem named", () => {
    has(R, '.ai/agentic.config.json: guardrails.forcePush: "allow" is not one of "deny", "lease"')
  })
  it("valid again, silent again", () => {
    git(MAIN, "checkout", "-q", "--", ".ai/agentic.config.json")
    assert.equal(report(MAIN), "")
  })
})

describe("a missing jq is said out loud, as plain text", () => {
  it("jq missing line", () => {
    const NOJQ = sandbox(
      join(TMP, "nojq"),
      TOOLS.filter((tool) => tool !== "jq")
    )
    has(stdoutOf(MAIN, NOJQ), "jq is missing")
  })
})

describe("garbage is silent", () => {
  it("empty payload", () => {
    const verdict = runHook("session-start", "")
    expectExit(verdict, 0)
    assert.equal(verdict.stdout, "")
  })
  it("malformed payload", () => {
    const verdict = runHook("session-start", "not json")
    expectExit(verdict, 0)
    assert.equal(verdict.stdout, "")
  })
})
