// `comment-budget`: a comment says what the code cannot, in a few lines. A block, one `/* … */` or a run
// of `//` or shell `#` lines alone on theirs, carries at most `maxProseLines` lines with a letter or a digit.

import { readFileSync } from "node:fs"
import { join, matchesGlob } from "node:path"

import type { Check, Finding } from "./check.ts"
import { type Comment, commentsOf, shellCommentsOf } from "./comments.ts"
import { matching, treeFiles } from "./tree.ts"

export type CommentBudgetOptions = { maxProseLines: number; roots: string[] }

const SOURCE = ["**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}"]
const SHELL = "**/*.sh"
const REMEDY = "cut it to what the code cannot say, or move the reasoning into a doc and point at it"

/** The comments as blocks: a run of `//` or `#` lines alone on consecutive lines is one; a comment after code is none. */
function blocksOf(comments: Comment[]): Comment[] {
  const blocks: Comment[] = []
  for (const comment of comments) {
    const previous = blocks.at(-1)
    if (comment.kind === "line" && previous?.kind === "line" && previous.end === comment.start - 1) {
      previous.end = comment.end
      previous.text += `\n${comment.text}`
    } else if (comment.kind !== "trailing") {
      blocks.push({ ...comment })
    }
  }
  return blocks
}

/** The lines of a block that hold a letter or a digit once the comment markers around them are off. */
function proseLines(block: string): number {
  return block
    .replace(/^\/\*\*?/, "")
    .replace(/\*\/$/, "")
    .split("\n")
    .map((line) =>
      line
        .trim()
        .replace(/^\*\s?/, "")
        .replace(/^\/\/\s?/, "")
    )
    .filter((line) => /[\p{L}\p{N}]/u.test(line)).length
}

function run(root: string, { maxProseLines, roots }: CommentBudgetOptions): Finding[] {
  const findings: Finding[] = []
  for (const file of matching(root, treeFiles(root, roots), [...SOURCE, SHELL])) {
    const text = readFileSync(join(root, file), "utf8")
    for (const block of blocksOf(matchesGlob(file, SHELL) ? shellCommentsOf(text) : commentsOf(text))) {
      const prose = proseLines(block.text)
      if (prose > maxProseLines) {
        const message = `a comment block of ${prose} prose lines, over the ${maxProseLines}-line budget`
        findings.push({ file, line: block.start, message, remedy: REMEDY })
      }
    }
  }
  return findings
}

export const commentBudget: Check<CommentBudgetOptions> = {
  name: "comment-budget",
  defaults: { maxProseLines: 3, roots: ["packages", "plugins", "scripts", "src"] },
  run
}
