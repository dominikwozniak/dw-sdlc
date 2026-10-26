// The parts of a markdown file the Checks read: its ATX headings with the anchors GitHub gives them,
// and the rows of a table under a heading. A line inside a fenced code block is never either.

export type Heading = { level: number; text: string; anchor: string; line: number }
export type Row = { cells: string[]; line: number }

const FENCE = /^ {0,3}(`{3,}|~{3,})/
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
