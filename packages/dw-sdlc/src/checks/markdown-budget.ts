// `markdown-budget`: each file a glob matches stays within that glob's line and byte budget, so the
// docs an agent reads stay short enough to read whole.

import { readFileSync } from "node:fs"
import { join } from "node:path"

import type { Check, Finding } from "./check.ts"
import { matching, treeFiles } from "./tree.ts"

export type Budget = { maxLines: number; maxBytes: number }
export type MarkdownBudgetOptions = { budgets: (Budget & { glob: string })[] }

const REMEDIES = {
  budget: "cut it, or split a topic into a file of its own",
  glob: "fix the glob, or drop its budget"
}

/** The lines of `text`, a last line without its newline counted, the empty line after a final newline not. */
function lineCount(text: string): number {
  const lines = text.split("\n").length
  return text.endsWith("\n") ? lines - 1 : lines
}

/** What `text` spends past its budget: `156 lines, over the 150-line budget`, then the bytes the same way. */
export function overBudget(text: string, { maxLines, maxBytes }: Budget): string[] {
  const lines = lineCount(text)
  const bytes = Buffer.byteLength(text)
  return [
    ...(lines > maxLines ? [`${lines} lines, over the ${maxLines}-line budget`] : []),
    ...(bytes > maxBytes ? [`${bytes} bytes, over the ${maxBytes}-byte budget`] : [])
  ]
}

function run(root: string, { budgets }: MarkdownBudgetOptions): Finding[] {
  const files = treeFiles(root)
  return budgets.flatMap(({ glob, ...budget }) => {
    const matched = matching(root, files, [glob])
    if (matched.length === 0) {
      return [{ message: `${JSON.stringify(glob)} matches no file`, remedy: REMEDIES.glob }]
    }
    return matched.flatMap((file) =>
      overBudget(readFileSync(join(root, file), "utf8"), budget).map((over) => ({
        file,
        message: `${over} of ${glob}`,
        remedy: REMEDIES.budget
      }))
    )
  })
}

export const markdownBudget: Check<MarkdownBudgetOptions> = {
  name: "markdown-budget",
  defaults: { budgets: [{ glob: "docs/agents/*.md", maxLines: 100, maxBytes: 6144 }] },
  run
}
