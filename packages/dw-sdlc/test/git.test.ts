// How the package runs git, in this process on real repositories: from the directory it names whatever
// GIT_DIR a git hook exports, stdout trimmed or as written, and a failure in git's own words.

import assert from "node:assert/strict"
import { join } from "node:path"
import { describe, it } from "node:test"

import { CannotRun } from "../src/cannot-run.ts"
import { asked, git, gitDirs, must } from "../src/git.ts"
import { commit, git as gitIn, repo, scratch, write } from "./harness.ts"

/** A repository with one commit holding `file`. */
function committed(file = "a.txt"): string {
  const root = repo()
  write(join(root, file), "a\n")
  gitIn(root, "add", file)
  commit(root, "-m", file)
  return root
}

describe("git", () => {
  it("answers stdout trimmed, or as git wrote it", () => {
    const root = committed()
    assert.deepEqual(git(root, ["ls-files"]), { out: "a.txt" })
    assert.deepEqual(git(root, ["ls-files", "-z"], { raw: true }), { out: "a.txt\0" })
  })

  it("names a failure by its first argument, in git's first line or every line", () => {
    const root = committed()
    const failed = git(root, ["rev-parse", "--verify", "no-such-ref"])
    assert.ok("error" in failed)
    assert.equal(failed.error, `git rev-parse: ${failed.said}`)
    assert.ok(!failed.said.includes("\n"), failed.said)
    const whole = git(root, ["checkout", "no-such-branch"], { whole: true })
    assert.ok("error" in whole && whole.said.length > 0 && !whole.said.includes("\n"), JSON.stringify(whole))
  })

  it("finds the repository from its directory, whatever GIT_DIR or GIT_INDEX_FILE says", () => {
    const root = committed()
    const other = committed("b.txt")
    const before = { dir: process.env.GIT_DIR, index: process.env.GIT_INDEX_FILE }
    process.env.GIT_DIR = join(other, ".git")
    process.env.GIT_INDEX_FILE = join(other, ".git", "index")
    try {
      assert.equal(asked(root, ["rev-parse", "--absolute-git-dir"]), join(root, ".git"))
      assert.equal(asked(root, ["ls-files"]), "a.txt")
    } finally {
      for (const [name, value] of [
        ["GIT_DIR", before.dir],
        ["GIT_INDEX_FILE", before.index]
      ] as const) {
        if (value === undefined) {
          delete process.env[name]
        } else {
          process.env[name] = value
        }
      }
    }
  })

  it("takes the variables a call sets over the cleared ones, as a scratch index", () => {
    const root = committed()
    const index = join(scratch("index"), "index")
    assert.equal(asked(root, ["ls-files"], { env: { GIT_INDEX_FILE: index } }), "")
    assert.equal(asked(root, ["ls-files"]), "a.txt")
  })

  it("stops the command on a git that must answer, and answers no to a question", () => {
    const outside = repo({ git: false })
    assert.equal(asked(outside, ["rev-parse", "--show-toplevel"]), undefined)
    assert.throws(
      () => must(outside, ["rev-parse", "--show-toplevel"]),
      (error: unknown) =>
        error instanceof CannotRun &&
        error.message.startsWith("git rev-parse: ") &&
        error.remedy === "check the repository with git status"
    )
  })

  it("names the git dir a linked worktree keeps and the one it shares with the main checkout", () => {
    const root = committed()
    const linked = join(scratch("linked"), "tree")
    gitIn(root, "worktree", "add", "-q", linked)
    assert.deepEqual(gitDirs(root), { gitDir: join(root, ".git"), commonDir: join(root, ".git") })
    assert.deepEqual(gitDirs(linked), {
      gitDir: join(root, ".git", "worktrees", "tree"),
      commonDir: join(root, ".git")
    })
    assert.equal(gitDirs(repo({ git: false })), undefined)
  })
})
