// What a Sweep reads of a repository's branches and worktrees: where each worktree lies, what it has checked
// out, its lock, the files that hold it and the operation paused in it, and the way off the main checkout's;
// beside them, the commands the dev runs for what the Sweep keeps.

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { asked, git, must } from "./git.ts"
import { isLanded } from "./landed.ts"
import { shellLine } from "./pr/decide.ts"

/** The forced delete of `branch`, the dev's to run. */
export function forcedDelete(branch: string): string {
  return shellLine(["git", "branch", "-D", branch])
}

/** The forced removal of the worktree at `path`, the dev's to run; git wants --force twice for one still locked. */
export function forcedRemoval(path: string, locked = false): string {
  return shellLine(["git", "worktree", "remove", "--force", ...(locked ? ["--force"] : []), path])
}

/** The unlock of the worktree at `path`, the dev's to run. */
export function unlockCommand(path: string): string {
  return shellLine(["git", "worktree", "unlock", path])
}

/** The commit the local `branch` points at, or undefined once it is gone. */
export function tipOf(root: string, branch: string): string | undefined {
  return asked(root, ["rev-parse", "--verify", "-q", `refs/heads/${branch}^{commit}`])
}

/** The local branches of the repository at `root`. */
export function branchesOf(root: string): string[] {
  return must(root, ["for-each-ref", "--format=%(refname:lstrip=2)", "refs/heads"])
    .split("\n")
    .filter((name) => name !== "")
}

export type Tree = {
  path: string
  head: string
  branch: string | undefined
  lock: string | undefined
  prunable: boolean
}

/** Every worktree of the repository, the main checkout first. */
export function worktreesOf(root: string): Tree[] {
  const trees: Tree[] = []
  let tree: Tree | undefined
  for (const line of must(root, ["worktree", "list", "--porcelain"]).split("\n")) {
    if (line.startsWith("worktree ")) {
      tree = { path: line.slice("worktree ".length), head: "", branch: undefined, lock: undefined, prunable: false }
      trees.push(tree)
    } else if (tree !== undefined && line.startsWith("HEAD ")) {
      tree.head = line.slice("HEAD ".length)
    } else if (tree !== undefined && line.startsWith("branch refs/heads/")) {
      tree.branch = line.slice("branch refs/heads/".length)
    } else if (tree !== undefined && (line === "locked" || line.startsWith("locked "))) {
      tree.lock = line.slice("locked".length).trim()
    } else if (tree !== undefined && (line === "prunable" || line.startsWith("prunable "))) {
      tree.prunable = true
    }
  }
  return trees
}

/** The files `git status` lists in the worktree at `path`, ignored ones aside, or why it cannot be read. */
export function dirtyFiles(path: string): string[] | { error: string } {
  const status = git(path, ["status", "--porcelain=v1", "-z", "--untracked-files=all"], { raw: true })
  if ("error" in status) {
    return status
  }
  const files: string[] = []
  const entries = status.out.split("\0").filter((entry) => entry !== "")
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index] ?? ""
    files.push(entry.slice(3))
    if (entry.startsWith("R") || entry.startsWith("C")) {
      index++
    }
  }
  return files
}

/** What in the worktree at `path` a removal could lose, a paused operation or a file git status lists, or null. */
export function whyUnclean(path: string, locked: boolean): { reason: string; command: string | null } | null {
  const operation = pausedOperation(path)
  if (operation !== undefined) {
    return { reason: `a ${operation} is paused in it`, command: null }
  }
  const files = dirtyFiles(path)
  if ("error" in files) {
    return { reason: files.error, command: null }
  }
  return files.length === 0
    ? null
    : { reason: `modified or untracked: ${files.join(", ")}`, command: forcedRemoval(path, locked) }
}

const OPERATIONS = [
  ["rebase-merge", "rebase"],
  ["rebase-apply", "rebase or am"],
  ["MERGE_HEAD", "merge"],
  ["CHERRY_PICK_HEAD", "cherry-pick"],
  ["REVERT_HEAD", "revert"],
  ["BISECT_LOG", "bisect"]
] as const

/** The operation paused in the worktree at `path`: its git dir holds the state git resumes it from. */
export function pausedOperation(path: string): string | undefined {
  const dir = asked(path, ["rev-parse", "--absolute-git-dir"])
  return dir === undefined ? undefined : OPERATIONS.find(([file]) => existsSync(join(dir, file)))?.[1]
}

/** The branch a rebase paused in the worktree at `path` works on; git lists that worktree as detached. */
function rebasedBranch(path: string): string | undefined {
  const dir = asked(path, ["rev-parse", "--absolute-git-dir"])
  if (dir === undefined) {
    return undefined
  }
  for (const state of ["rebase-merge", "rebase-apply"]) {
    const file = join(dir, state, "head-name")
    const name = existsSync(file) ? readFileSync(file, "utf8").trim() : ""
    if (name.startsWith("refs/heads/")) {
      return name.slice("refs/heads/".length)
    }
  }
  return undefined
}

/** The branch git keeps from a delete for the worktree `tree`, and why: checked out there, or a rebase of it paused there. */
export function heldBranch(tree: Tree): { branch: string; reason: string } | undefined {
  if (tree.branch !== undefined) {
    return { branch: tree.branch, reason: `checked out in the worktree at ${tree.path}` }
  }
  const branch = rebasedBranch(tree.path)
  return branch === undefined
    ? undefined
    : { branch, reason: `a rebase paused in the worktree at ${tree.path} holds it` }
}

/** The dev's way off `branch`, checked out in the main checkout at `root`: null until it is Landed and nothing there could be lost. */
export function switchOff(
  root: string,
  base: { name: string; ref: string },
  branch: string
): { reason: string; command: string } | null {
  const files = dirtyFiles(root)
  if (
    "error" in files ||
    files.length > 0 ||
    pausedOperation(root) !== undefined ||
    !isLanded(root, base.ref, branch)
  ) {
    return null
  }
  const command = `${shellLine(["git", "switch", base.name])} && ${shellLine(["git", "pull", "--rebase"])}`
  return { reason: `checked out in the main checkout at ${root}, Landed on origin/${base.name}`, command }
}
