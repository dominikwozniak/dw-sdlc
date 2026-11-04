// The parts of a markdown file the Checks read: its ATX headings with the anchors GitHub gives them,
// the rows of a table under a heading, its links, its prose with the code masked and the keys of its
// frontmatter; and the anchors of a file on disk. A line inside a fenced code block is never any of them.

import { readFileSync, statSync } from "node:fs"
import { join } from "node:path"

export type Heading = { level: number; text: string; anchor: string; line: number }
export type Row = { cells: string[]; line: number }
export type Link = { target: string; line: number }

/** A code fence at any indent, so one inside a list item counts. */
const FENCE = /^[ \t]*(`{3,}|~{3,})/
const ATX = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/

/** Each line with its 1-based number, `fenced` when a code fence opens, closes or encloses it. */
function scan(text: string): { text: string; line: number; fenced: boolean }[] {
  let fence: string | undefined
  return text.split("\n").map((line, index) => {
    const marker = FENCE.exec(line)?.[1]
    if (fence === undefined && marker !== undefined) {
      fence = marker
      return { text: line, line: index + 1, fenced: true }
    }
    if (fence !== undefined && marker !== undefined && marker[0] === fence[0] && marker.length >= fence.length) {
      fence = undefined
      return { text: line, line: index + 1, fenced: true }
    }
    return { text: line, line: index + 1, fenced: fence !== undefined }
  })
}

/**
 * GitHub's anchor for a heading: its text as rendered, lowercased, every character but a letter, a
 * digit, a space, `-` and `_` dropped, each space a hyphen.
 */
function slug(text: string): string {
  const rendered = text.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
  return rendered
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "")
    .replaceAll(" ", "-")
}

/** Every ATX heading in `text`, a repeated anchor numbered `-1`, `-2` as GitHub numbers it. */
export function headings(text: string): Heading[] {
  const seen = new Map<string, number>()
  return scan(text).flatMap(({ text: line, line: number, fenced }) => {
    const match = fenced ? null : ATX.exec(line)
    if (match === null) {
      return []
    }
    const [, hashes = "", content = ""] = match
    const base = slug(content)
    const count = seen.get(base) ?? 0
    seen.set(base, count + 1)
    return [{ level: hashes.length, text: content, anchor: count === 0 ? base : `${base}-${count}`, line: number }]
  })
}

function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim())
}

/**
 * The body rows of the tables in the section under the heading whose text is `title`, up to the next
 * heading of its level or above; empty when there is no such heading.
 */
export function tableRows(text: string, title: string): Row[] {
  const all = headings(text)
  const start = all.find((heading) => heading.text.toLowerCase() === title.toLowerCase())
  if (start === undefined) {
    return []
  }
  const end = all.find((heading) => heading.line > start.line && heading.level <= start.level)?.line ?? Infinity
  const rows = scan(text)
    .filter(({ line, fenced }) => line > start.line && line < end && !fenced)
    .filter(({ text: line }) => line.trim().startsWith("|"))
    .map(({ text: line, line: number }) => ({ cells: cells(line), line: number }))
  // A table's header row is the one above its delimiter row, which holds only dashes, colons and spaces.
  const isDelimiter = (row: Row | undefined) => row !== undefined && row.cells.every((cell) => /^:?-+:?$/.test(cell))
  return rows.filter((row, index) => !isDelimiter(row) && !isDelimiter(rows[index + 1]))
}

/** Every backticked span in `text`, without its backticks. */
export function codeSpans(text: string): string[] {
  return Array.from(text.matchAll(/`([^`]+)`/g), ([, span = ""]) => span)
}

/** A code span: a run of backticks, then the text up to the next run of as many. */
const CODE_SPAN = /(?<!`)(`+)(?!`).*?(?<!`)\1(?!`)/g

/** `text` with each fenced line and each code span blanked to spaces, so every offset and line is kept. */
export function prose(text: string): string {
  return scan(text)
    .map(({ text: line, fenced }) =>
      fenced ? " ".repeat(line.length) : line.replace(CODE_SPAN, (span) => " ".repeat(span.length))
    )
    .join("\n")
}

/** The target of an inline link or image, `<…>` or up to a space or `)`, and of a link definition, `[label]: target`. */
const INLINE_TARGET = /\]\(\s*(<[^>]*>|[^\s)]+)/g
const DEFINITION = /^ {0,3}\[(?!\^)[^\]]+\]:[ \t]*(<[^>]*>|\S+)/

/** Every link target in the prose of `text`, its angle brackets dropped, with its 1-based line. */
export function links(text: string): Link[] {
  return prose(text)
    .split("\n")
    .flatMap((line, index) => {
      const definition = DEFINITION.exec(line)?.[1]
      const targets = [
        ...Array.from(line.matchAll(INLINE_TARGET), ([, target = ""]) => target),
        ...(definition === undefined ? [] : [definition])
      ]
      return targets.map((target) => ({ target: target.replace(/^<(.*)>$/, "$1"), line: index + 1 }))
    })
}

/** A value of a frontmatter, with its 1-based line. */
export type FrontmatterValue = { value: string; line: number }

/** A top-level key of a frontmatter: the value after its colon, and the items of the block list under it. */
export type FrontmatterEntry = FrontmatterValue & { items: FrontmatterValue[] }

/** A scalar as YAML reads it: the text between its quotes, or else the text before a ` #` comment. */
function scalar(text: string): string {
  const quoted = /^\s*(["'])(.*?)\1\s*(#.*)?$/.exec(text)
  return quoted?.[2] ?? text.replace(/(^|\s)#.*$/, "").trim()
}

/**
 * The top-level keys of the frontmatter `text` opens with, none when it opens with none. A key written
 * twice is read where it first appears.
 */
export function frontmatter(text: string): Map<string, FrontmatterEntry> {
  const keys = new Map<string, FrontmatterEntry>()
  const lines = text.split("\n")
  if (lines[0]?.trim() !== "---") {
    return keys
  }
  let current: FrontmatterEntry | undefined
  for (let index = 1; index < lines.length && lines[index]?.trim() !== "---"; index++) {
    const line = lines[index] ?? ""
    const [, name, rest = ""] = /^([\w-]+):(.*)$/.exec(line) ?? []
    const item = /^\s*-(?:\s+(.*))?$/.exec(line)
    if (name !== undefined) {
      current = keys.has(name) ? undefined : { value: scalar(rest), line: index + 1, items: [] }
      if (current !== undefined) {
        keys.set(name, current)
      }
    } else if (item !== null) {
      current?.items.push({ value: scalar(item[1] ?? ""), line: index + 1 })
    }
  }
  return keys
}

/**
 * The values a list key names: comma-separated after its colon, in `[…]` or not, or else its items. A comma
 * inside a glob's `{…}` separates none, and an empty value is dropped.
 */
export function frontmatterList(key: FrontmatterEntry | undefined): FrontmatterValue[] {
  if (key === undefined) {
    return []
  }
  const inline = key.value.replace(/^\[(.*)\]$/, "$1")
  const values =
    inline === "" ? key.items : inline.split(/,(?![^{]*\})/).map((value) => ({ value: scalar(value), line: key.line }))
  return values.filter(({ value }) => value !== "")
}

/** The anchors of each markdown file read so far, by path. */
export type Anchors = Map<string, Set<string>>

/** The anchors of the headings of `path` under `root`; none when it is not a file. */
export function anchorsOf(root: string, path: string, cache: Anchors): Set<string> {
  let anchors = cache.get(path)
  if (anchors === undefined) {
    const full = join(root, path)
    anchors = new Set(statSync(full).isFile() ? headings(readFileSync(full, "utf8")).map(({ anchor }) => anchor) : [])
    cache.set(path, anchors)
  }
  return anchors
}
