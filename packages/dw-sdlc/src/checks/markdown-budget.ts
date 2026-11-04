// `markdown-budget`: each file a glob matches stays within that glob's byte budget, so the docs an
// agent reads stay short enough to read whole.

import { readFileSync } from "node:fs"
import { join } from "node:path"

import type { Check, Finding } from "./check.ts"
import { matching, treeFiles } from "./tree.ts"

export type Budget = { maxBytes: number }
export type MarkdownBudgetOptions = { budgets: (Budget & { glob: string })[] }

const REMEDIES = {
  budget: "cut it, or split a topic into a file of its own",
  glob: "fix the glob, or drop its budget"
}

/** What `text` spends past its budget, `10651 bytes, over the 10240-byte budget`; nothing within it. */
export function overBudget(text: string, { maxBytes }: Budget): string[] {
  const bytes = Buffer.byteLength(text)
  return bytes > maxBytes ? [`${bytes} bytes, over the ${maxBytes}-byte budget`] : []
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
  defaults: { budgets: [{ glob: "docs/agents/*.md", maxBytes: 6144 }] },
  run
}
