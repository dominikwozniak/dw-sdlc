// `markdown-budget`: each file a glob matches stays within that glob's line and byte budget, so the
// docs an agent reads stay short enough to read whole.

import { readFileSync } from "node:fs"
import { join } from "node:path"

import { lineCount } from "../markdown.ts"
import { matching, treeFiles } from "../tree.ts"
import type { Check, Finding } from "./check.ts"

export type Budget = { glob: string; maxLines: number; maxBytes: number }
export type MarkdownBudgetOptions = { budgets: Budget[] }

const REMEDIES = {
  budget: "cut it, or split a topic into a file of its own",
  glob: "fix the glob, or drop its budget"
}

function run(root: string, { budgets }: MarkdownBudgetOptions): Finding[] {
  const files = treeFiles(root)
  return budgets.flatMap(({ glob, maxLines, maxBytes }) => {
    const matched = matching(root, files, [glob])
    if (matched.length === 0) {
      return [{ message: `${JSON.stringify(glob)} matches no file`, remedy: REMEDIES.glob }]
    }
    return matched.flatMap((file) => {
      const content = readFileSync(join(root, file))
      const findings: Finding[] = []
      const lines = lineCount(content.toString("utf8"))
      if (lines > maxLines) {
        const message = `${lines} lines, over the ${maxLines}-line budget of ${glob}`
        findings.push({ file, message, remedy: REMEDIES.budget })
      }
      const bytes = content.byteLength
      if (bytes > maxBytes) {
        const message = `${bytes} bytes, over the ${maxBytes}-byte budget of ${glob}`
        findings.push({ file, message, remedy: REMEDIES.budget })
      }
      return findings
    })
  })
}

export const markdownBudget: Check<MarkdownBudgetOptions> = {
  name: "markdown-budget",
  defaults: { budgets: [{ glob: "docs/agents/*.md", maxLines: 100, maxBytes: 6144 }] },
  run
}
