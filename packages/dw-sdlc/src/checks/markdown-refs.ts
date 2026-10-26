// `markdown-refs`: every relative link and image in the markdown resolves, its path to a file or a
// directory of the repository and its heading anchor to a heading of the file it names. The repository
// is the files git tracks or would track, so a link to a file git ignores or to another case of a
// file's name fails here as it fails in CI.

import { readFileSync } from "node:fs"
import { join, posix } from "node:path"

import { type Anchors, anchorsOf, links } from "../markdown.ts"
import { matching, treeFiles } from "../tree.ts"
import type { Check, Finding } from "./check.ts"

export type MarkdownRefsOptions = { files: string[]; exempt: string[] }

const REMEDIES = {
  path: "fix the path or drop the link",
  outside: "point it at a file of the repository",
  anchor: "point it at a heading the file has"
}

/** A target with a scheme, such as `https:` or `mailto:`, or a host: no file of the tree answers it. */
const EXTERNAL = /^([a-z][a-z\d+.-]*:|\/\/)/i

function decode(text: string): string {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}

/** Every directory above a file of `files`. */
function directoriesOf(files: Set<string>): Set<string> {
  const directories = new Set<string>()
  for (const file of files) {
    for (let dir = posix.dirname(file); dir !== "." && !directories.has(dir); dir = posix.dirname(dir)) {
      directories.add(dir)
    }
  }
  return directories
}

/** The repository path a link in `file` names, the root `.`; a path out of the repository starts with `..`. */
function resolve(file: string, path: string): string {
  const joined = path.startsWith("/") ? path.slice(1) : posix.join(posix.dirname(file), path)
  const normal = posix.normalize(joined === "" ? "." : joined)
  return normal.length > 1 ? normal.replace(/\/$/, "") : normal
}

function run(root: string, { files, exempt }: MarkdownRefsOptions): Finding[] {
  const tree = treeFiles(root)
  const known = new Set(tree)
  const directories = directoriesOf(known)
  const cache: Anchors = new Map()
  return matching(root, tree, files, exempt).flatMap((file) =>
    links(readFileSync(join(root, file), "utf8")).flatMap(({ target, line }): Finding[] => {
      if (EXTERNAL.test(target)) {
        return []
      }
      const [reference = "", anchor] = target.split("#", 2)
      const path = decode(reference.split("?", 1)[0] ?? "")
      const resolved = path === "" ? file : resolve(file, path)
      const show = JSON.stringify(target)
      if (resolved === ".." || resolved.startsWith("../")) {
        return [{ file, line, message: `links to ${show}, which is outside the repository`, remedy: REMEDIES.outside }]
      }
      if (resolved !== "." && !known.has(resolved) && !directories.has(resolved)) {
        return [{ file, line, message: `links to ${show}, which does not exist`, remedy: REMEDIES.path }]
      }
      const judged = anchor !== undefined && anchor !== "" && known.has(resolved) && /\.md$/i.test(resolved)
      if (judged && !anchorsOf(root, resolved, cache).has(decode(anchor))) {
        const message = `links to ${show}, but ${resolved} has no heading with that anchor`
        return [{ file, line, message, remedy: REMEDIES.anchor }]
      }
      return []
    })
  )
}

export const markdownRefs: Check<MarkdownRefsOptions> = {
  name: "markdown-refs",
  defaults: { files: ["**/*.md"], exempt: [] },
  run
}
