// A checkout's working tree as git would commit it: the tree of every file git tracks or would track,
// hashed on a copy of the index. The Gate's cache fingerprints it and the watch for Drift records it.

import { spawnSync } from "node:child_process"
import { copyFileSync, existsSync, mkdtempSync, rmSync, statSync, utimesSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { repositoryFreeEnv } from "./git-env.ts"

/** `git <args>` in the repository at `root`, on `index` when given. */
export function git(root: string, args: string[], index?: string): { out: string } | { error: string } {
  const env = repositoryFreeEnv()
  const result = spawnSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    env: index === undefined ? env : { ...env, GIT_INDEX_FILE: index },
    // A Step that writes thousands of files makes a diff-tree past the default 1 MiB.
    maxBuffer: Infinity
  })
  if (result.status === 0) {
    return { out: result.stdout.trim() }
  }
  const reason = result.error?.message ?? result.stderr.split("\n").find((line) => line.trim() !== "")
  return { error: `git ${args[0] ?? ""}: ${reason?.trim() ?? `exited ${result.status ?? "on a signal"}`}` }
}

/**
 * The tree `git write-tree` hashes from a copy of the index after `git add -A` on it: the copy keeps the
 * stat cache, so only what changed is read again; identical content survives a commit, an amend or a
 * rebase, and a new untracked file changes it while an ignored one does not.
 */
function treeOf(root: string, gitDir: string): { out: string } | { error: string } {
  const scratch = mkdtempSync(join(tmpdir(), "dw-sdlc-gate-"))
  const index = join(scratch, "index")
  const real = join(gitDir, "index")
  try {
    if (existsSync(real)) {
      // git trusts a cached stat only when the index is newer than the file, so the copy takes the mtime
      // the real one had before it was read: a newer one would hide an edit made in that same second.
      const { atime, mtime } = statSync(real)
      copyFileSync(real, index)
      utimesSync(index, atime, mtime)
    }
    const added = git(root, ["add", "-A"], index)
    return "error" in added ? added : git(root, ["write-tree"], index)
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

/** The tree of the checkout at `root` and its git dir, or why it has none. */
export function workingTree(root: string): { tree: string; gitDir: string } | { error: string } {
  try {
    const gitDir = git(root, ["rev-parse", "--absolute-git-dir"])
    if ("error" in gitDir) {
      return gitDir
    }
    const tree = treeOf(root, gitDir.out)
    return "error" in tree ? tree : { tree: tree.out, gitDir: gitDir.out }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}
