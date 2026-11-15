// `pinned-actions`: every `uses:` of a workflow names a full commit SHA with a `# vX.Y.Z` comment, so the
// code a workflow runs cannot move under it. A local action (`./...`) and a `docker://` image are left out.

import { readFileSync } from "node:fs"
import { join } from "node:path"

import type { Check, Finding } from "./check.ts"
import { matching, treeFiles } from "./tree.ts"

export type PinnedActionsOptions = { files: string[] }

const REMEDY = "pin it as `<owner>/<repo>@<40-hex commit SHA> # vX.Y.Z`"
/** A `uses:` value, its trailing comment in group 2; the key may follow `- `. */
const USES = /^\s*(?:-\s+)?uses:\s*([^\s#]+)\s*(?:#\s*(.*?)\s*)?$/
const SHA = /@[0-9a-f]{40}$/
const VERSION = /^v\d+\.\d+\.\d+$/

function judge(line: string): string | undefined {
  const match = USES.exec(line)
  if (match === null) {
    return undefined
  }
  const [, target = "", comment] = match
  if (target.startsWith("./") || target.startsWith("docker://")) {
    return undefined
  }
  if (!SHA.test(target)) {
    return `${target} is not pinned to a full commit SHA`
  }
  return comment !== undefined && VERSION.test(comment) ? undefined : `${target} has no \`# vX.Y.Z\` comment`
}

function run(root: string, { files }: PinnedActionsOptions): Finding[] {
  return matching(root, treeFiles(root), files).flatMap((file) =>
    readFileSync(join(root, file), "utf8")
      .split("\n")
      .flatMap((text, index) => {
        const message = judge(text)
        return message === undefined ? [] : [{ file, line: index + 1, message, remedy: REMEDY }]
      })
  )
}

export const pinnedActions: Check<PinnedActionsOptions> = {
  name: "pinned-actions",
  defaults: { files: [".github/workflows/*.yaml", ".github/workflows/*.yml"] },
  run
}
