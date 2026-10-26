// `comment-budget`: a comment says what the code cannot, in a few lines. A block, one `/* … */` or a run
// of `//` lines alone on theirs, carries at most `maxProseLines` lines with a letter or a digit.

import { readFileSync } from "node:fs"
import { join } from "node:path"

import type { Check, Finding } from "./check.ts"
import { isPlainFile, listFiles } from "./files.ts"

export type CommentBudgetOptions = { maxProseLines: number; roots: string[] }

const SOURCE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/
const REMEDY = "cut it to what the code cannot say, or move the reasoning into a doc and point at it"
/** The characters after which a `/` opens a regular expression, not a division. */
const BEFORE_REGEX = new Set("(,=:[!&|?{};+-*%<>~^")
const KEYWORD_BEFORE_REGEX =
  /(^|[^\w$])(return|typeof|instanceof|in|of|new|delete|void|throw|case|do|else|yield|await)$/

/** A `//` comment alone on its line, a `//` comment after code, or a block comment, by its lines and text. */
type Comment = { kind: "line" | "trailing" | "block"; start: number; end: number; text: string }

/** Where the regular expression whose `/` is at `start` ends, or undefined when the line ends first. */
function regexEnd(text: string, start: number): number | undefined {
  let inClass = false
  for (let index = start + 1; index < text.length; index += 1) {
    const char = text[index]
    if (char === "\\") {
      index += 1
    } else if (char === "\n") {
      return undefined
    } else if (char === "[" || char === "]") {
      inClass = char === "["
    } else if (char === "/" && !inClass) {
      return index + 1
    }
  }
  return undefined
}

/** Whether the `/` at `index` opens a regular expression: the code before it ends where a value starts. */
function opensRegex(text: string, index: number): boolean {
  const before = text.slice(0, index).trimEnd()
  const last = before.at(-1)
  return last === undefined || BEFORE_REGEX.has(last) || KEYWORD_BEFORE_REGEX.test(before)
}

/** Every comment in JavaScript or TypeScript `text`, skipping strings, template literals and regular expressions. */
function commentsOf(text: string): Comment[] {
  const comments: Comment[] = []
  // The open quotes, and a `{` for each brace opened inside a template literal's `${…}`.
  const stack: string[] = []
  let line = 1
  let index = 0
  while (index < text.length) {
    const char = text[index]
    const next = text[index + 1]
    const top = stack.at(-1)
    if (top === "'" || top === '"' || top === "`") {
      if (char === "\\") {
        line += next === "\n" ? 1 : 0
        index += 2
        continue
      }
      if (top === "`" && char === "$" && next === "{") {
        stack.push("{")
        index += 2
        continue
      }
      if (char === top) {
        stack.pop()
      }
      line += char === "\n" ? 1 : 0
      index += 1
      continue
    }
    if (char === "'" || char === '"' || char === "`" || (char === "{" && top === "{")) {
      stack.push(char)
    } else if (char === "}" && top === "{") {
      stack.pop()
    } else if (char === "/" && next === "/") {
      const stop = text.indexOf("\n", index) === -1 ? text.length : text.indexOf("\n", index)
      const alone = text.slice(text.lastIndexOf("\n", index - 1) + 1, index).trim() === ""
      comments.push({ kind: alone ? "line" : "trailing", start: line, end: line, text: text.slice(index, stop) })
      index = stop
      continue
    } else if (char === "/" && next === "*") {
      const close = text.indexOf("*/", index + 2)
      const body = text.slice(index, close === -1 ? text.length : close + 2)
      const start = line
      line += body.split("\n").length - 1
      comments.push({ kind: "block", start, end: line, text: body })
      index += body.length
      continue
    } else if (char === "/" && opensRegex(text, index)) {
      index = regexEnd(text, index) ?? index + 1
      continue
    }
    line += char === "\n" ? 1 : 0
    index += 1
  }
  return comments
}

/** The comments as blocks: a run of `//` lines alone on consecutive lines is one; a comment after code is none. */
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
  for (const file of listFiles(root, roots).filter((path) => SOURCE.test(path) && isPlainFile(root, path))) {
    for (const block of blocksOf(commentsOf(readFileSync(join(root, file), "utf8")))) {
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
