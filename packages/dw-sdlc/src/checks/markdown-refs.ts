// `markdown-refs`: every relative link and image, and every URL into origin's default branch even in
// code, resolves to a file or directory git tracks or would track and its anchor to a heading there, so
// a link to an ignored file or to another case of a file's name fails here as it fails in CI.

import { readFileSync } from "node:fs"
import { join, posix } from "node:path"

import { type Anchors, anchorsOf, type Link, links } from "../markdown.ts"
import { asked } from "../working-tree.ts"
import type { Check, Finding } from "./check.ts"
import { directoriesOf, matching, treeFiles } from "./tree.ts"

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

/** `owner/name` in the URL of a GitHub remote, over SSH or HTTPS, `.git` or not. */
const GITHUB_REMOTE =
  /^(?:git@github\.com:|ssh:\/\/git@github\.com\/|https:\/\/github\.com\/)([^/]+\/[^/]+?)(?:\.git)?\/?$/i
const REMOTE_HEAD = "refs/remotes/origin/HEAD"
/** The branch a URL is judged at when origin/HEAD names none, as in a CI checkout. */
const FALLBACK_BRANCH = "main"

/** A URL into a GitHub repository: a file page, a directory page or a raw file, up to a space, a quote or a bracket. */
const REPOSITORY_URL =
  /https:\/\/(?:github\.com\/[^/\s]+\/[^/\s]+\/(?:blob|tree)|raw\.githubusercontent\.com\/[^/\s]+\/[^/\s]+)\/[^\s"'`<>()[\]]+/gi

/** The URL prefixes, lowercased, that name a path of origin's default branch; none when origin is not on GitHub. */
function prefixesOf(root: string): string[] {
  const slug = GITHUB_REMOTE.exec(asked(root, ["remote", "get-url", "origin"]) ?? "")?.[1]?.toLowerCase()
  if (slug === undefined) {
    return []
  }
  const head = asked(root, ["symbolic-ref", "-q", REMOTE_HEAD])?.replace(/^refs\/remotes\/origin\//, "")
  const branch = head === undefined || head === "" ? FALLBACK_BRANCH : head
  return [
    `https://github.com/${slug}/blob/${branch}/`,
    `https://github.com/${slug}/tree/${branch}/`,
    `https://raw.githubusercontent.com/${slug}/${branch}/`
  ]
}

/**
 * Every URL of `text` into the repository's default branch, a fenced line's included, as a link to its
 * path from the root; a sentence's closing punctuation is not part of it.
 */
function repositoryLinks(text: string, prefixes: string[]): (Link & { shown: string })[] {
  if (prefixes.length === 0) {
    return []
  }
  return text.split("\n").flatMap((line, index) =>
    Array.from(line.matchAll(REPOSITORY_URL), ([url]) => url.replace(/[.,;:!?]+$/, "")).flatMap((url) => {
      const prefix = prefixes.find((candidate) => url.toLowerCase().startsWith(candidate))
      return prefix === undefined ? [] : [{ target: `/${url.slice(prefix.length)}`, line: index + 1, shown: url }]
    })
  )
}

function decode(text: string): string {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
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
function judge(
  repository: Repository,
  file: string,
  { target, line, shown = target }: Link & { shown?: string }
): Finding[] {
  if (EXTERNAL.test(target)) {
    return []
  }
  const [beforeAnchor = "", anchor = ""] = target.split("#", 2)
  const resolved = resolve(file, decode(beforeAnchor.split("?", 1)[0] ?? ""))
  const quoted = JSON.stringify(shown)
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
  const prefixes = prefixesOf(root)
  const repository: Repository = { root, files: known, directories: directoriesOf(known), anchors: new Map() }
  return matching(root, tree, files, exempt).flatMap((file) => {
    const text = readFileSync(join(root, file), "utf8")
    return [...links(text), ...repositoryLinks(text, prefixes)]
      .toSorted((left, right) => left.line - right.line)
      .flatMap((link) => judge(repository, file, link))
  })
}

export const markdownRefs: Check<MarkdownRefsOptions> = {
  name: "markdown-refs",
  defaults: { files: ["**/*.md"], exempt: [] },
  run
}
