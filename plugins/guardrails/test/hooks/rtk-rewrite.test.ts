// What rtk-rewrite.sh hands to `rtk hook claude` and what it keeps from it, against a fake rtk on
// PATH that echoes the payload it received: every command from a main checkout, and nothing at all
// from a linked worktree or on a machine without rtk.

import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmodSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"

import { bashPayload, commit, expectExit, git, initRepo, runHook, scratch, write, type Verdict } from "../harness.ts"

const TMP = scratch("rtk")

const MAIN = initRepo(join(TMP, "main"), { branch: "main" })
write(join(MAIN, "README.md"), "")
git(MAIN, "add", "README.md")
commit(MAIN, "-m", "init")
const WT = join(MAIN, ".claude", "worktrees", "wt")
git(MAIN, "worktree", "add", "-q", WT, "-b", "wt")

/** A PATH holding wrappers for the named tools, plus a fake rtk when asked, and nothing else. */
function sandbox(dir: string, rtk: boolean): string {
  mkdirSync(dir, { recursive: true })
  for (const tool of ["bash", "git", "jq", "cat", "dirname"]) {
    const found = spawnSync("bash", ["-c", 'command -v "$1"', "which", tool], { encoding: "utf8" })
    write(join(dir, tool), `#!/bin/sh\nexec ${found.stdout.trim()} "$@"\n`)
    chmodSync(join(dir, tool), 0o755)
  }
  if (rtk) {
    write(join(dir, "rtk"), '#!/bin/sh\nprintf "REWROTE:"; cat\n')
    chmodSync(join(dir, "rtk"), 0o755)
  }
  return dir
}
const WITH_RTK = sandbox(join(TMP, "with-rtk"), true)
const NO_RTK = sandbox(join(TMP, "no-rtk"), false)

function run(command: string, cwd: string, path = WITH_RTK): Verdict {
  return runHook("rtk-rewrite", bashPayload(command, cwd), { env: { PATH: path } })
}
function rewritten(name: string, command: string, cwd: string): void {
  it(name, () => {
    const verdict = run(command, cwd)
    expectExit(verdict, 0)
    assert.equal(verdict.stdout, `REWROTE:${JSON.stringify(bashPayload(command, cwd))}`)
  })
}
function silent(name: string, command: string, cwd: string, path?: string): void {
  it(name, () => {
    const verdict = run(command, cwd, path)
    expectExit(verdict, 0)
    assert.equal(verdict.stdout, "")
  })
}

describe("a main checkout hands every command to rtk, the payload untouched", () => {
  rewritten("git status", "git status --short", MAIN)
  rewritten("a git chain", "git status && git diff --stat", MAIN)
  rewritten("a non-git command", "pnpm install", MAIN)
})

describe("a linked worktree keeps every command away from rtk", () => {
  silent("git status", "git status --short", WT)
  silent("a chain naming git", "pnpm install && git status", WT)
  silent("a non-git command", "pnpm install", WT)
  silent("a glob", `ls -la ${WT}/*`, WT)
})

describe("without rtk the hook says nothing", () => {
  silent("main checkout", "git status --short", MAIN, NO_RTK)
  silent("non-git command", "pnpm install", MAIN, NO_RTK)
})

describe("garbage still goes to rtk, which reads it itself", () => {
  it("malformed payload", () => {
    const verdict = runHook("rtk-rewrite", "not json", { env: { PATH: WITH_RTK } })
    expectExit(verdict, 0)
    assert.equal(verdict.stdout, "REWROTE:not json")
  })
})
