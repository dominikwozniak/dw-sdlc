// The Router's block: a table of each Reference's `dir` and `when`, written from `.ai/references.json`
// between two markers. The setup writes it and the Sync checks it; the rest of the Router is the
// author's. A block is in step when its rows say what the file says, not its bytes, which a formatter pads.

import type { Reference } from "./references-key.ts"

const START = "<!-- references:start — written from .ai/references.json by the setup; edit the file -->"
const END = "<!-- references:end -->"
const START_LINE = /^<!-- references:start\b.*-->\s*$/
const END_LINE = /^<!-- references:end -->\s*$/
const NONE = "No Reference is declared yet: `/sdlc-references-add <repository>` adds one."

const GRAPHEMES = new Intl.Segmenter("en", { granularity: "grapheme" })
/** An emoji drawn as one, or a character of the East Asian wide and fullwidth ranges. */
const WIDE =
  /[\p{Emoji_Presentation}️ᄀ-ᅟ〈〉⺀-〾぀-꓏가-힣豈-﫿︐-︙︰-﹯＀-｠￠-￦\u{20000}-\u{2FFFD}\u{30000}-\u{3FFFD}]/u

/** A cell's width in columns as oxfmt measures it: two for a wide grapheme, one for any other. */
function width(cell: string): number {
  let columns = 0
  for (const { segment } of GRAPHEMES.segment(cell)) {
    columns += WIDE.test(segment) ? 2 : 1
  }
  return columns
}

function tableLine(cells: string[]): string {
  return `| ${cells.join(" | ")} |`
}

/** A Markdown table, each column padded to its widest cell and three at the least. */
function table(header: string[], body: string[][]): string[] {
  const rows = [header, ...body]
  const widths = header.map((_, column) => Math.max(3, ...rows.map((row) => width(row[column] ?? ""))))
  const padded = (row: string[]): string =>
    tableLine(row.map((cell, column) => cell + " ".repeat((widths[column] ?? 0) - width(cell))))
  return [padded(header), tableLine(widths.map((count) => "-".repeat(count))), ...body.map(padded)]
}

/**
 * The block the file gives: one row per Reference in the file's order, or one line when it has none,
 * with a blank line inside each marker, as oxfmt leaves it.
 */
export function renderBlock(references: Reference[]): string {
  const body =
    references.length === 0
      ? [NONE]
      : table(
          ["dir", "reach for it when"],
          references.map((reference) => [`\`${reference.dir}\``, reference.when.replaceAll("|", "\\|")])
        )
  return `${[START, "", ...body, "", END].join("\n")}\n`
}

/** A table's delimiter row, dashes of any count. */
const DELIMITER = /^\|(?:\s*-+\s*\|)+$/

/** What `lines` say once a formatter's work is undone: no blank lines, every cell trimmed, a run of dashes three. */
function normalized(lines: string[]): string {
  return lines
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) => {
      const cells = line.split("|").map((cell) => cell.trim())
      return (DELIMITER.test(line) ? cells.map((cell) => cell.replaceAll(/-+/g, "---")) : cells).join("|")
    })
    .join("\n")
}

/**
 * The Router's text with `block` in place of the one between its markers: as it is when the two say
 * the same rows, the block replaced when they differ, appended when the Router has no markers; or
 * the problem with a Router that has one marker without the other.
 */
export function withBlock(router: string, block: string): { text: string } | { problem: string } {
  const lines = router.split("\n")
  const start = lines.findIndex((line) => START_LINE.test(line))
  const end = lines.findIndex((line) => END_LINE.test(line))
  if (start === -1 && end === -1) {
    const head = router === "" || router.endsWith("\n") ? router : `${router}\n`
    return { text: `${head}${head === "" ? "" : "\n"}${block}` }
  }
  if (start === -1 || end === -1) {
    const lone =
      start === -1
        ? "references:end marker without a references:start"
        : "references:start marker without a references:end"
    return { problem: `has a ${lone}; fix the pair by hand first` }
  }
  if (end < start) {
    return { problem: "has its references:end marker before references:start; fix the pair by hand first" }
  }
  const next = block.trimEnd().split("\n")
  if (normalized(lines.slice(start + 1, end)) === normalized(next.slice(1, -1))) {
    return { text: router }
  }
  return { text: [...lines.slice(0, start), ...next, ...lines.slice(end + 1)].join("\n") }
}
