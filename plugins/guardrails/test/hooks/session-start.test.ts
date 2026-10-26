// What session-start.sh tells a fresh session, fed the real SessionStart payload against a throwaway
// repository with a linked worktree: the .worktreeinclude files it lacks, the worktree.setup commands, an
// invalid config, a schema it cannot read, a missing jq — and nothing from a main checkout in order.

import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmodSync, copyFileSync, cpSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { after, before, describe, it } from "node:test"

import {
  commit,
  expectExit,
  git,
  HOOKS_DIR,
  initRepo,
  REPO_ROOT,
  runBash,
  runHook,
  scratch,
  write,
  writeJson
} from "../harness.ts"

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
/** The report for a session starting at `cwd`, with PATH replaced when given. */
function report(cwd: string, path?: string): string {
  return contextOf(stdoutOf(cwd, path))
}
/** The additionalContext in a hook's stdout, trailing newlines dropped as `$(…)` drops them. */
function contextOf(out: string): string {
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

describe("the files read from the main checkout are never missing from a worktree", () => {
  // The config layers the guards fall back to, and the local settings Claude Code reads there.
  const main = initRepo(join(TMP, "shared"), { branch: "main" })
  const shared = [".ai/agentic.config.local.json", ".claude/settings.local.json"]
  write(join(main, ".gitignore"), `${shared.join("\n")}\n.claude/worktrees/\n`)
  write(join(main, ".worktreeinclude"), `${shared.join("\n")}\n`)
  writeJson(join(main, ".ai", "agentic.config.local.json"), { commit: { convention: "ticket-key" } })
  writeJson(join(main, ".claude", "settings.local.json"), {})
  git(main, "add", ".gitignore", ".worktreeinclude")
  commit(main, "-m", "init")
  const worktree = join(main, ".claude", "worktrees", "wt")
  git(main, "worktree", "add", "-q", worktree, "-b", "wt")
  it("no include line", () => {
    assert.equal(report(worktree), "")
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
    has(R, '.ai/agentic.config.json: guardrails.forcePush: "allow" is not one of "deny", "ask", "lease"')
  })
  it("valid again, silent again", () => {
    git(MAIN, "checkout", "-q", "--", ".ai/agentic.config.json")
    assert.equal(report(MAIN), "")
  })
})

describe("a schema the plugin cannot read is a config problem, never a pass", () => {
  // Valid against the schema and looser than the strictest set: only the unread schema drops it.
  const repo = initRepo(join(TMP, "unvalidated"), { branch: "main" })
  writeJson(join(repo, ".ai", "agentic.config.json"), { guardrails: { forcePush: "lease" } })
  const strictest = {
    forcePush: "deny",
    commitOnProtected: "deny",
    envFiles: { policy: "deny", allow: [], deny: [] },
    protectedBranches: ["master", "main", "production"]
  }

  // hooks/ beside no dw-sdlc link, as a marketplace added from GitHub without `packages` in its
  // sparse set installs it; then beside a schema that is not JSON, named with jq's error.
  const cases: [string, string | undefined, (schemaPath: string) => string][] = [
    [
      "missing",
      undefined,
      (schemaPath) =>
        `.ai/agentic.config.json: not validated: the schema ${schemaPath} is missing; ` +
        "an install from GitHub needs packages in its --sparse set"
    ],
    ["not JSON", "{ not json", (schemaPath) => `.ai/agentic.config.json: not validated against ${schemaPath}: jq: `]
  ]
  for (const [name, schema, problem] of cases) {
    describe(`a schema ${name}`, () => {
      const plugin = scratch("plugin")
      cpSync(HOOKS_DIR, join(plugin, "hooks"), { recursive: true })
      const schemaPath = join(plugin, "dw-sdlc", "config", "agentic.config.schema.json")
      if (schema !== undefined) {
        write(schemaPath, schema)
      }
      let R = ""
      before(() => {
        const verdict = runBash([join(plugin, "hooks", "session-start.sh")], payload(repo))
        expectExit(verdict, 0)
        R = contextOf(verdict.stdout)
      })
      it("invalid, strictest", () => {
        has(R, "agentic config: INVALID, the guards run on the strictest defaults until it is fixed")
      })
      it("the schema named", () => {
        has(R, problem(schemaPath))
      })
      it("one problem, on one line", () => {
        assert.equal(lineCount(R), 2)
      })
      it("the guards on the strictest set", () => {
        const script = 'source "$1"; guard_config_load "$2"; jq -c .guardrails <<<"$GUARD_CONFIG"'
        const verdict = runBash(["-c", script, "lib", join(plugin, "hooks", "lib.sh"), repo], "")
        expectExit(verdict, 0)
        assert.deepEqual(JSON.parse(verdict.stdout), strictest)
      })
    })
  }
})

describe("a references key is its plugin's, never a config problem", () => {
  after(() => {
    git(MAIN, "checkout", "-q", "--", ".ai/agentic.config.json")
  })
  it("silent on this repository's own config, its key included", () => {
    copyFileSync(join(REPO_ROOT, ".ai", "agentic.config.json"), join(MAIN, ".ai", "agentic.config.json"))
    assert.equal(report(MAIN), "")
  })
  it("silent on a key the references plugin refuses", () => {
    writeJson(join(MAIN, ".ai", "agentic.config.json"), { references: [{ dir: "../x", branch: "main" }, "kody"] })
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
