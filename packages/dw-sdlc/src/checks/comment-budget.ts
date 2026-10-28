// `comment-budget`: a comment says what the code cannot, in a few lines. A block, one `/* … */` or a run
// of `//` or shell `#` lines alone on theirs, carries at most `maxProseLines` lines with a letter or a digit.

import { readFileSync } from "node:fs"
import { join, matchesGlob } from "node:path"

import type { Check, Finding } from "./check.ts"
import { matching, treeFiles } from "./tree.ts"

export type CommentBudgetOptions = { maxProseLines: number; roots: string[] }

const SOURCE = ["**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}"]
const SHELL = "**/*.sh"
const REMEDY = "cut it to what the code cannot say, or move the reasoning into a doc and point at it"
/** The characters after which a `/` opens a regular expression, not a division. */
const BEFORE_REGEX = new Set("(,=:[!&|?{};+-*%<>~^")
const KEYWORD_BEFORE_REGEX =
  /(^|[^\w$])(return|typeof|instanceof|in|of|new|delete|void|throw|case|do|else|yield|await)$/

/** A `//` or `#` comment alone on its line, one after code, or a block comment, by its lines and text. */
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

/** Where a shell walk is: code, an arithmetic `((…))`, a `${…}` or a double quote, with the parens or braces open in it. */
type ShellFrame = { kind: "code" | "arithmetic" | "expansion" | "double"; depth: number }

/** The characters that end a shell word, so a `#` after one opens a comment. */
const WORD_BREAK = new Set(" \t\n;&|()<>")

/** Where the line that holds `index` ends: at its newline, or at the end of `text`. */
function lineEnd(text: string, index: number): number {
  const newline = text.indexOf("\n", index)
  return newline === -1 ? text.length : newline
}

/** Where a span that `closer` ends, read from `start`, stops, past the closer; `\` escapes a character when `escapes`. */
function spanEnd(text: string, start: number, closer: string, escapes: boolean): number {
  for (let index = start; index < text.length; index += 1) {
    if (escapes && text[index] === "\\") {
      index += 1
    } else if (text[index] === closer) {
      return index + 1
    }
  }
  return text.length
}

/** A heredoc whose body starts on the next line: its delimiter, and whether `<<-` strips the body's leading tabs. */
type Heredoc = { delimiter: string; strip: boolean }

/** The heredoc whose `<<` is at `start`, its delimiter's quotes off, and where the delimiter's word ends. */
function heredocAt(text: string, start: number): Heredoc & { end: number } {
  const strip = text.charAt(start + 2) === "-"
  let index = start + (strip ? 3 : 2)
  while (text.charAt(index) === " " || text.charAt(index) === "\t") {
    index += 1
  }
  let end = index
  while (end < text.length && !WORD_BREAK.has(text.charAt(end))) {
    const char = text.charAt(end)
    end = char === "'" || char === '"' ? spanEnd(text, end + 1, char, false) : end + (char === "\\" ? 2 : 1)
  }
  return { delimiter: text.slice(index, end).replace(/["'\\]/g, ""), strip, end }
}

/** Where the heredoc body that starts at `start` ends: past the line that is its delimiter. */
function bodyEnd(text: string, start: number, { delimiter, strip }: Heredoc): number {
  for (let index = start; index < text.length;) {
    const end = lineEnd(text, index)
    const line = text.slice(index, end)
    index = end + 1
    if ((strip ? line.replace(/^\t+/, "") : line) === delimiter) {
      return index
    }
  }
  return text.length
}

/** The character that opens and the one that closes a nesting inside each frame. */
const NESTING: Record<ShellFrame["kind"], string> = { code: "()", arithmetic: "()", expansion: "{}", double: "" }

/**
 * Every `#` comment in shell `text`: a `#` that starts a word of code, never one in a quote, an
 * expansion, an arithmetic `((…))` or a heredoc body, nor the shebang on line 1.
 */
function shellCommentsOf(text: string): Comment[] {
  const comments: Comment[] = []
  const newlines = [...text.matchAll(/\n/g)].map((match) => match.index)
  const outer: ShellFrame[] = []
  let frame: ShellFrame = { kind: "code", depth: 0 }
  const heredocs: Heredoc[] = []
  let wordStart = true
  let index = text.startsWith("#!") ? lineEnd(text, 0) : 0
  const open = (kind: ShellFrame["kind"], length: number) => {
    outer.push(frame)
    frame = { kind, depth: 0 }
    index += length
    wordStart = true
  }
  const close = (length: number) => {
    frame = outer.pop() ?? frame
    index += length
    wordStart = false
  }
  const skipTo = (end: number) => {
    index = end
    wordStart = false
  }
  while (index < text.length) {
    const char = text.charAt(index)
    const next = text.charAt(index + 1)
    const { kind } = frame
    const [opener, closer] = NESTING[kind]
    if (char === "\\") {
      skipTo(index + 2)
    } else if (kind === "double" && char === '"') {
      close(1)
    } else if (char === "$" && text.startsWith("((", index + 1)) {
      open("arithmetic", 3)
    } else if (char === "$" && next === "(") {
      open("code", 2)
    } else if (char === "$" && next === "{") {
      open("expansion", 2)
    } else if (char === "`") {
      skipTo(spanEnd(text, index + 1, "`", true))
    } else if (kind === "double") {
      index += 1
    } else if (char === "$" && next === "'") {
      skipTo(spanEnd(text, index + 2, "'", true))
    } else if (char === "'") {
      skipTo(spanEnd(text, index + 1, "'", false))
    } else if (char === '"') {
      open("double", 1)
    } else if (kind === "code" && char === "#" && wordStart) {
      const end = lineEnd(text, index)
      const line = newlines.filter((newline) => newline < index).length + 1
      const alone = text.slice(text.lastIndexOf("\n", index - 1) + 1, index).trim() === ""
      comments.push({ kind: alone ? "line" : "trailing", start: line, end: line, text: text.slice(index, end) })
      index = end
    } else if (kind === "code" && char === "\n") {
      index += 1
      for (const heredoc of heredocs.splice(0)) {
        index = bodyEnd(text, index, heredoc)
      }
      wordStart = true
    } else if (kind === "code" && text.startsWith("<<<", index)) {
      index += 3
      wordStart = true
    } else if (kind === "code" && text.startsWith("<<", index)) {
      const { end, ...heredoc } = heredocAt(text, index)
      heredocs.push(heredoc)
      skipTo(end)
    } else if (kind === "code" && text.startsWith("((", index)) {
      open("arithmetic", 2)
    } else if (char === opener) {
      frame.depth += 1
      index += 1
      wordStart = true
    } else if (char === closer && frame.depth > 0) {
      frame.depth -= 1
      index += 1
      wordStart = true
    } else if (char === closer && outer.length > 0) {
      close(kind === "arithmetic" && next === ")" ? 2 : 1)
    } else {
      wordStart = WORD_BREAK.has(char)
      index += 1
    }
  }
  return comments
}

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
