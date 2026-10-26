// The files of a repository as git sees them, and the ones a Check's globs pick out of them: what the
// Checks that judge many files read, so a file git ignores is never judged.

import { spawnSync } from "node:child_process"
import { existsSync, lstatSync, realpathSync } from "node:fs"
import { join, matchesGlob, relative } from "node:path"

import { CannotRun } from "./check.ts"

/** Every file under `pathspecs`, the whole tree when there are none, that git tracks or would track and that is on disk; sorted. */
export function treeFiles(root: string, pathspecs: string[] = []): string[] {
  const args = ["-C", root, "ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ...pathspecs]
  const listed = spawnSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  if (listed.status !== 0) {
    const under = pathspecs.length === 0 ? "" : ` under ${pathspecs.join(", ")}`
    const message = `cannot list the files${under}: not a git repository`
    throw new CannotRun({ message, remedy: "run the Gate inside a git repository" })
  }
  return [...new Set(listed.stdout.split("\0").filter((path) => path !== ""))]
    .filter((path) => existsSync(join(root, path)))
    .toSorted()
}

/**
 * The files of `paths` that a glob of `globs` matches and none of `exempt` does. A symbolic link is left
 * out when the file it points at is matched too, so one file is judged once. `*` and `**` skip a name
 * that starts with a dot, as a shell does.
 */
export function matching(root: string, paths: string[], globs: string[], exempt: string[] = []): string[] {
  const matched = paths.filter(
    (path) => globs.some((glob) => matchesGlob(path, glob)) && !exempt.some((glob) => matchesGlob(path, glob))
  )
  const judged = new Set(matched)
  const realRoot = realpathSync(root)
  return matched.filter(
    (path) =>
      !lstatSync(join(root, path)).isSymbolicLink() || !judged.has(relative(realRoot, realpathSync(join(root, path))))
  )
}
