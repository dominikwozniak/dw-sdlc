// A checkout's working tree as git would commit it: the tree of every file git tracks or would track,
// hashed on a copy of the index. The Gate's cache fingerprints it and the watch for Drift records it.

import { copyFileSync, existsSync, mkdtempSync, rmSync, statSync, utimesSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { messageOf } from "./cannot-run.ts"
import { git, type GitAnswer } from "./git.ts"

/**
 * The tree `git write-tree` hashes from a copy of the index after `git add -A` on it: the copy keeps the
 * stat cache, so only what changed is read again; identical content survives a commit, an amend or a
 * rebase, and a new untracked file changes it while an ignored one does not.
 */
function treeOf(root: string, gitDir: string): GitAnswer {
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
    const scratchIndex = { env: { GIT_INDEX_FILE: index } }
    const added = git(root, ["add", "-A"], scratchIndex)
    return "error" in added ? added : git(root, ["write-tree"], scratchIndex)
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
    return { error: messageOf(error) }
  }
}
