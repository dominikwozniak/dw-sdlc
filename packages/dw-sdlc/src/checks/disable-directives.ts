// `disable-directives`: a lint rule or a type check switched off says why. A Disable directive in a comment
// fails unless a reason follows `--` on its line, follows an `@ts-` directive or is a comment above it.
// The language of a file picks the comments read and the directives looked for.

import { readFileSync } from "node:fs"
import { basename, extname, join } from "node:path"

import type { Check, Finding } from "./check.ts"
import { type Comment, commentsOf } from "./comments.ts"
import { type HashLanguage, hashCommentsOf } from "./hash-comments.ts"
import { matching, treeFiles } from "./tree.ts"

export type DisableDirectivesOptions = { files: string[]; exempt: string[] }

const REMEDY = "add one after `--` on its line, or in a comment on the line above"

type Language = "script" | HashLanguage

const SCRIPT_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]
const RUBY_EXTENSIONS = [".rb", ".rake", ".gemspec", ".ru"]
const RUBY_NAMES = ["Rakefile", "Gemfile"]
const PYTHON_EXTENSIONS = [".py", ".pyi"]

function languageOf(file: string): Language | undefined {
  const extension = extname(file)
  if (SCRIPT_EXTENSIONS.includes(extension)) {
    return "script"
  }
  if (RUBY_EXTENSIONS.includes(extension) || RUBY_NAMES.includes(basename(file))) {
    return "ruby"
  }
  return PYTHON_EXTENSIONS.includes(extension) ? "python" : undefined
}

/**
 * The pattern that finds a directive at the start of a comment's line, its name in group 1. A Python
 * `noqa` may follow other words of its comment, after a `#` of its own: `# type: ignore  # noqa`.
 */
const DIRECTIVES: Record<Language, RegExp> = {
  script: /^((?:oxlint|eslint)-disable(?:-next-line|-line)?|@ts-expect-error|@ts-ignore)(?![\w-])/,
  ruby: /^(rubocop:disable)(?![\w-])/,
  python: /(?:^|#\s*)(noqa)(?![\w-])/i
}

/** The reason `--` gives: text after it, set off from what comes before by space. */
const DASH_REASON = /(?:^|\s)--+\s*\S/

/** A comment's lines, each as text starting after its markers and indent, with the line it sits on. */
function linesOf({ start, text }: Comment, language: Language): { line: number; text: string }[] {
  return text.split("\n").map((raw, offset) => {
    const body =
      language === "script" ? raw.replace(/^\s*(?:\/\/+|\/\*+|\*+(?!\/))?\s*/, "") : raw.replace(/^\s*#+\s*/, "")
    return { line: start + offset, text: body.replace(/\s*\*\/\s*$/, "").trimEnd() }
  })
}

/** Whether `rest`, the text of a directive's line after its name, gives a reason. */
function givesReason(directive: string, rest: string): boolean {
  if (directive.startsWith("@ts-")) {
    return /[^\s-]/.test(rest.replace(/^\s*:/, ""))
  }
  return DASH_REASON.test(rest)
}

/** The directive that starts a line of a comment, and the text after it, or undefined. */
function directiveIn(text: string, language: Language): { directive: string; rest: string } | undefined {
  const match = DIRECTIVES[language].exec(text)
  return match === null ? undefined : { directive: match[1] ?? "", rest: text.slice(match.index + match[0].length) }
}

function run(root: string, { files, exempt }: DisableDirectivesOptions): Finding[] {
  const findings: Finding[] = []
  for (const file of matching(root, treeFiles(root), files, exempt)) {
    const language = languageOf(file)
    if (language === undefined) {
      continue
    }
    const text = readFileSync(join(root, file), "utf8")
    const comments = language === "script" ? commentsOf(text) : hashCommentsOf(text, language)
    const found = comments.flatMap((comment) =>
      linesOf(comment, language).flatMap(({ line, text: body }) => {
        const directive = directiveIn(body, language)
        return directive === undefined ? [] : [{ line, ...directive }]
      })
    )
    const directiveLines = new Set(found.map(({ line }) => line))
    // The line above a directive gives a reason when a comment alone on its line ends on it and no directive does.
    const commentEnds = new Set(comments.filter(({ kind }) => kind !== "trailing").map(({ end }) => end))
    for (const { line, directive, rest } of found) {
      const above = commentEnds.has(line - 1) && !directiveLines.has(line - 1)
      if (!givesReason(directive, rest) && !above) {
        findings.push({ file, line, directive, message: `${directive} gives no reason`, remedy: REMEDY })
      }
    }
  }
  return findings
}

export const disableDirectives: Check<DisableDirectivesOptions> = {
  name: "disable-directives",
  defaults: {
    files: [
      "**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}",
      "**/*.{rb,rake,gemspec,ru}",
      "**/{Rakefile,Gemfile}",
      "**/*.{py,pyi}"
    ],
    exempt: ["references/**", "**/vendor/**", "**/node_modules/**"]
  },
  run
}
