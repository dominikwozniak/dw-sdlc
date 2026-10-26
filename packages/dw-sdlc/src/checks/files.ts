// The files a Check judges: what git tracks or would track, on disk, and how many lines one holds.

import { spawnSync } from "node:child_process"
import { existsSync, lstatSync } from "node:fs"
import { join } from "node:path"

import { CannotRun } from "./check.ts"

/** Every file under `paths`, the whole tree when there are none, that git tracks or would track and that is on disk. */
export function listFiles(root: string, paths: string[] = []): string[] {
  const args = ["-C", root, "ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ...paths]
  const listed = spawnSync("git", args, { encoding: "utf8" })
  if (listed.status !== 0) {
    const where = paths.length === 0 ? "of the tree" : `under ${paths.join(", ")}`
    throw new CannotRun({
      message: `cannot list the files ${where}: not a git repository`,
      remedy: "run the Gate inside a git repository"
    })
  }
  return [...new Set(listed.stdout.split("\0").filter((path) => path !== ""))]
    .filter((path) => existsSync(join(root, path)))
    .toSorted()
}

/** Whether `path` is a file itself, not a symbolic link to one, so a linked file is read once. */
export function isPlainFile(root: string, path: string): boolean {
  return lstatSync(join(root, path), { throwIfNoEntry: false })?.isFile() === true
}

/** The lines of `text`: its newlines, and one more for a last line without one. */
export function lineCount(text: string): number {
  return text.split("\n").length - (text === "" || text.endsWith("\n") ? 1 : 0)
}
