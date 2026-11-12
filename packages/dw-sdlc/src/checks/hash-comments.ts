// The `#` comments of a Ruby or Python file: every `#` that is not inside a string, as the comments of
// `comments.ts` are, so a directive in a string literal or a heredoc is none.

import type { Comment } from "./comments.ts"

export type HashLanguage = "ruby" | "python"

/** A Ruby heredoc whose body starts on the next line: its terminator, and whether `<<~` and `<<-` let the terminator be indented. */
type Heredoc = { terminator: string; indented: boolean }

const HEREDOC = /^<<([~-]?)(["'`]?)([A-Za-z_]\w*)\2/

/** The heredoc that opens at `index`, or undefined: a bare `<<NAME` counts only in capitals, as `list <<NAME` is an append. */
function heredocAt(text: string, index: number): (Heredoc & { length: number }) | undefined {
  const match = HEREDOC.exec(text.slice(index, index + 80))
  if (match === null || (match[1] === "" && !/^[A-Z_]/.test(match[3] ?? ""))) {
    return undefined
  }
  return { terminator: match[3] ?? "", indented: match[1] !== "", length: match[0].length }
}

/** Where a heredoc body that starts at `start` ends: past the line that is its terminator. */
function heredocEnd(text: string, start: number, { terminator, indented }: Heredoc): number {
  for (let index = start; index < text.length;) {
    const stop = text.indexOf("\n", index)
    const end = stop === -1 ? text.length : stop
    const line = text.slice(index, end)
    index = end + 1
    if ((indented ? line.trim() : line) === terminator) {
      return Math.min(index, text.length)
    }
  }
  return text.length
}

/** Where the block that runs from `index` to the next line that starts with `until` ends; the end of `text` if none. */
function blockEnd(text: string, index: number, until: string): number {
  const stop = text.indexOf(`\n${until}`, index)
  if (stop === -1) {
    return text.length
  }
  const end = text.indexOf("\n", stop + 1)
  return end === -1 ? text.length : end
}

/** Every `#` comment in Ruby or Python `text`, skipping strings, Ruby heredocs, `=begin` blocks and Python triple quotes. */
export function hashCommentsOf(text: string, language: HashLanguage): Comment[] {
  const comments: Comment[] = []
  // The open quotes, a triple quote as its three characters, and a `{` for each brace opened in a Ruby `#{…}`.
  const stack: string[] = []
  const heredocs: Heredoc[] = []
  let line = 1
  let index = 0
  const skipTo = (end: number) => {
    line += text.slice(index, end).split("\n").length - 1
    index = end
  }
  if (language === "ruby" && text.startsWith("=begin")) {
    skipTo(blockEnd(text, 0, "=end"))
  }
  while (index < text.length) {
    const char = text.charAt(index)
    const next = text.charAt(index + 1)
    const top = stack.at(-1)
    if (top !== undefined && top !== "{") {
      if (char === "\\") {
        skipTo(Math.min(index + 2, text.length))
      } else if (language === "ruby" && char === "#" && next === "{" && top !== "'") {
        stack.push("{")
        index += 2
      } else if (text.startsWith(top, index)) {
        stack.pop()
        index += top.length
      } else {
        line += char === "\n" ? 1 : 0
        index += 1
      }
    } else if (char === "'" || char === '"' || (language === "ruby" && char === "`")) {
      const triple = language === "python" && text.startsWith(char.repeat(3), index)
      stack.push(triple ? char.repeat(3) : char)
      index += triple ? 3 : 1
    } else if (char === "{" && top === "{") {
      stack.push("{")
      index += 1
    } else if (char === "}" && top === "{") {
      stack.pop()
      index += 1
    } else if (char === "#" && language === "ruby" && next === "{") {
      index += 1
    } else if (char === "#") {
      const stop = text.indexOf("\n", index)
      const end = stop === -1 ? text.length : stop
      const alone = text.slice(text.lastIndexOf("\n", index - 1) + 1, index).trim() === ""
      comments.push({ kind: alone ? "line" : "trailing", start: line, end: line, text: text.slice(index, end) })
      index = end
    } else if (char === "\n") {
      line += 1
      index += 1
      for (const heredoc of heredocs.splice(0)) {
        skipTo(heredocEnd(text, index, heredoc))
      }
      if (language === "ruby" && text.startsWith("=begin", index)) {
        skipTo(blockEnd(text, index, "=end"))
      } else if (language === "ruby" && text.startsWith("__END__", index)) {
        skipTo(text.length)
      }
    } else if (language === "ruby" && char === "<" && next === "<") {
      const heredoc = heredocAt(text, index)
      if (heredoc === undefined) {
        index += 2
      } else {
        heredocs.push(heredoc)
        index += heredoc.length
      }
    } else {
      index += 1
    }
  }
  return comments
}
