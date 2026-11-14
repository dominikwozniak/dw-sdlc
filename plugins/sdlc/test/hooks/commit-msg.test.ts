// What commit-msg.sh, the git commit-msg hook, refuses (exit 1) and lets through (exit 0): the subject
// against the resolved commit pattern, read from the message file git hands the hook. The direct
// cases spawn the hook on a written file; the git cases make real commits through `core.hooksPath`.

import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmodSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"

import { expectExit, git, hookPath, initRepo, runBash, scratch, type Verdict, write, writeJson } from "../harness.ts"

const TMP = scratch("commit-msg")

function repo(name: string, config?: object): string {
  const dir = initRepo(join(TMP, name))
  if (config !== undefined) {
    writeJson(join(dir, ".ai", "agentic.config.json"), config)
  }
  return dir
}
const INFERRED = repo("inferred")
const CONVENTIONAL = repo("conventional", { commit: { convention: "conventional" } })
const TICKETS = repo("tickets", { commit: { convention: "ticket-key" } })
const ANY = repo("any", { commit: { pattern: ".+" } })
const TRAILERED = repo("trailered", { commit: { convention: "conventional", trailer: "Co-Authored-By" } })

let files = 0
function run(message: string, cwd: string): Verdict {
  files += 1
  const file = join(TMP, `message-${files}`)
  write(file, message)
  return runBash([hookPath("commit-msg"), file], "", { cwd })
}
function refused(name: string, message: string, cwd = CONVENTIONAL): void {
  it(name, () => {
    const verdict = run(message, cwd)
    expectExit(verdict, 1)
    assert.match(verdict.stderr, /does not match this repository's commit pattern/)
  })
}
function allowed(name: string, message: string, cwd = CONVENTIONAL): void {
  it(name, () => {
    expectExit(run(message, cwd), 0)
  })
}

describe("no subject check when nothing is configured", () => {
  allowed("typed-unset", "fix(hook): a thing\n", INFERRED)
  allowed("no-type-unset", "whatever\n", INFERRED)
  allowed("ticket-style-unset", "[VER-1] feat: x\n", INFERRED)
})

describe("Conventional Commits when the config names them", () => {
  allowed("typed", "fix(hook): a thing\n")
  allowed("breaking", "feat!: a thing\n")
  allowed("with-body", "docs: a thing\n\nWhy it was done.\n")
  refused("no-type", "added a thing\n")
  refused("uppercase-type", "Fix: a thing\n")
  refused("ticket-style", "[ABC-12] docs: x\n")
})

describe("the convention a config layer sets", () => {
  allowed("ticket-key", "[ABC-12] fix: a thing\n", TICKETS)
  refused("ticket-key-without-key", "fix: a thing\n", TICKETS)
  allowed("any-subject", "whatever I like\n", ANY)
})

describe("the trailer stays the agent's rule", () => {
  allowed("no-trailer", "fix: a thing\n", TRAILERED)
})

describe("the subject is the first line git keeps", () => {
  allowed("comments-below", "fix: a thing\n# Please enter the commit message\n#\n")
  allowed("comments-and-blanks-above", "\n\n# a comment\n   \nfix: a thing\n")
  refused("comments-above-bad-subject", "# a comment\nbad subject\n")
  allowed("no-final-newline", "fix: a thing")
  refused("no-final-newline-bad", "bad subject")
})

describe("git's own subjects and an empty message pass", () => {
  allowed("merge", "Merge branch 'feature' into main\n")
  allowed("revert", 'Revert "fix: a thing"\n')
  allowed("fixup", "fixup! fix: a thing\n")
  allowed("squash", "squash! fix: a thing\n")
  allowed("amend", "amend! fix: a thing\n")
  allowed("empty", "")
  allowed("only-comments", "\n# Please enter the commit message\n")
  allowed(
    "verbose-diff-below-the-scissors",
    "\n# ------------------------ >8 ------------------------\n# Do not modify the line above.\ndiff --git a/x b/x\n"
  )
})

it("refuses without a message file", () => {
  expectExit(runBash([hookPath("commit-msg"), join(TMP, "missing")], "", { cwd: INFERRED }), 1)
})

describe("a commit from a terminal", () => {
  const hooks = join(TMP, "git-hooks")
  mkdirSync(hooks)
  write(join(hooks, "commit-msg"), `#!/bin/sh\nexec bash '${hookPath("commit-msg")}' "$1"\n`)
  chmodSync(join(hooks, "commit-msg"), 0o755)

  // `git commit` through the hook, under a fixed identity, unsigned, with an editor that saves as is.
  function commit(cwd: string, ...args: string[]): Verdict {
    const identity = ["-c", "user.email=t@example.com", "-c", "user.name=t", "-c", "commit.gpgsign=false"]
    const result = spawnSync("git", ["-c", `core.hooksPath=${hooks}`, ...identity, "commit", "-q", ...args], {
      cwd,
      encoding: "utf8",
      env: { ...process.env, GIT_EDITOR: "true" }
    })
    return { status: result.status ?? -1, stdout: result.stdout, stderr: result.stderr }
  }

  it("refuses an off-convention subject and records nothing", () => {
    const dir = repo("terminal-refused", { commit: { convention: "conventional" } })
    const result = commit(dir, "--allow-empty", "-m", "added a thing")
    expectExit(result, 1)
    assert.match(result.stderr, /does not match this repository's commit pattern/)
    assert.equal(spawnSync("git", ["-C", dir, "rev-parse", "-q", "--verify", "HEAD"]).status, 1)
  })

  it("records any subject when nothing is configured", () => {
    const dir = repo("terminal-unset")
    expectExit(commit(dir, "--allow-empty", "-m", "[VER-1] feat: x"), 0)
    assert.equal(git(dir, "log", "--format=%s", "-n", "1").trim(), "[VER-1] feat: x")
  })

  it("records a subject on the convention", () => {
    const dir = repo("terminal-allowed")
    expectExit(commit(dir, "--allow-empty", "-m", "fix: a thing"), 0)
    assert.equal(git(dir, "log", "--format=%s", "-n", "1").trim(), "fix: a thing")
  })

  it("leaves an empty verbose message to git", () => {
    const dir = repo("terminal-verbose")
    write(join(dir, "x"), "x\n")
    git(dir, "add", "x")
    const result = commit(dir, "--verbose")
    expectExit(result, 1)
    assert.doesNotMatch(result.stderr, /does not match/)
    assert.match(result.stderr, /empty commit message/)
  })
})
