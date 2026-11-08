// What a Sweep reads of a repository's linked worktrees: where each lies, what it has checked out, its lock,
// the files that hold it and the operation paused in it.

import { existsSync } from "node:fs"
import { join } from "node:path"

import { exec } from "./exec.ts"
import { repositoryFreeEnv } from "./git-env.ts"
import { CannotRun } from "./pr/read.ts"
import { asked, git } from "./working-tree.ts"

/** `git <args>` at `root`, or a stop naming its problem. */
export function must(root: string, args: string[]): string {
  const result = git(root, args)
  if ("error" in result) {
    throw new CannotRun(result.error, "check the repository with git status")
  }
  return result.out
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
  const args = ["-C", path, "status", "--porcelain=v1", "-z", "--untracked-files=all"]
  const result = exec("git", args, { env: repositoryFreeEnv() })
  if (result.status !== 0) {
    const said = result.stderr.split("\n").find((line) => line.trim() !== "")
    return { error: `git status: ${said?.trim() ?? `exited ${result.status ?? "on a signal"}`}` }
  }
  const files: string[] = []
  const entries = result.stdout.split("\0").filter((entry) => entry !== "")
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index] ?? ""
    files.push(entry.slice(3))
    if (entry.startsWith("R") || entry.startsWith("C")) {
      index++
    }
  }
  return files
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
