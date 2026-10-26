// `markdown-refs`: every relative link and image in the markdown resolves, its path to a file or a
// directory git tracks or would track and its heading anchor to a heading of the file it names, so a
// link to an ignored file or to another case of a file's name fails here as it fails in CI.

import { readFileSync } from "node:fs"
import { join, posix } from "node:path"

import { type Anchors, anchorsOf, type Link, links } from "../markdown.ts"
import type { Check, Finding } from "./check.ts"
import { matching, treeFiles } from "./tree.ts"

export type MarkdownRefsOptions = { files: string[]; exempt: string[] }

/** The repository a link resolves in: its files, the directories above them, the anchors read so far. */
type Repository = { root: string; files: Set<string>; directories: Set<string>; anchors: Anchors }

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

/** The repository path `path` names from `file`, the root `.`; a path out of the repository starts with `..`. */
function resolve(file: string, path: string): string {
  if (path === "") {
    return file
  }
  const joined = path.startsWith("/") ? path.slice(1) : posix.join(posix.dirname(file), path)
  const normal = posix.normalize(joined === "" ? "." : joined)
  return normal.length > 1 ? normal.replace(/\/$/, "") : normal
}

/** What is wrong with one link of `file`: a path out of the repository or not in it, or an anchor with no heading. */
function judge(repository: Repository, file: string, { target, line }: Link): Finding[] {
  if (EXTERNAL.test(target)) {
    return []
  }
  const [beforeAnchor = "", anchor = ""] = target.split("#", 2)
  const resolved = resolve(file, decode(beforeAnchor.split("?", 1)[0] ?? ""))
  const quoted = JSON.stringify(target)
  if (resolved === ".." || resolved.startsWith("../")) {
    return [{ file, line, message: `links to ${quoted}, which is outside the repository`, remedy: REMEDIES.outside }]
  }
  if (resolved !== "." && !repository.files.has(resolved) && !repository.directories.has(resolved)) {
    return [{ file, line, message: `links to ${quoted}, which does not exist`, remedy: REMEDIES.path }]
  }
  const namesHeading = anchor !== "" && repository.files.has(resolved) && /\.md$/i.test(resolved)
  if (namesHeading && !anchorsOf(repository.root, resolved, repository.anchors).has(decode(anchor))) {
    const message = `links to ${quoted}, but ${resolved} has no heading with that anchor`
    return [{ file, line, message, remedy: REMEDIES.anchor }]
  }
  return []
}

function run(root: string, { files, exempt }: MarkdownRefsOptions): Finding[] {
  const tree = treeFiles(root)
  const known = new Set(tree)
  const repository: Repository = { root, files: known, directories: directoriesOf(known), anchors: new Map() }
  return matching(root, tree, files, exempt).flatMap((file) =>
    links(readFileSync(join(root, file), "utf8")).flatMap((link) => judge(repository, file, link))
  )
}

export const markdownRefs: Check<MarkdownRefsOptions> = {
  name: "markdown-refs",
  defaults: { files: ["**/*.md"], exempt: [] },
  run
}
