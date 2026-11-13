// The Primitives a session's branch changed, for `dw-sdlc recap`: the rollup of `primitives --diff` from
// the branch's merge-base with `origin/<default>`, ids and classes only. A branch the config protects,
// the default branch and a repository with no catalogue roll up to none.

import { resolveConfig } from "./agentic-config.ts"
import { catalogueFile } from "./checks/primitives.ts"
import { type PrimitiveClass, primitivesDiff } from "./primitives-diff.ts"
import { asked } from "./working-tree.ts"

export type Rolled = { id: string; class: PrimitiveClass }

/** What the rollup read: the Primitives, and why it could not read them when it could not. */
export type Rollup = { primitives: Rolled[]; unread?: string }

/** `defaultOf` names the default branch and is asked only once the repository has a catalogue and `branch` is no base. */
export function rollup(root: string, branch: string, defaultOf: () => string): Rollup {
  const { guardrails, gate } = resolveConfig(root).config
  if (guardrails.protectedBranches.includes(branch)) {
    return { primitives: [] }
  }
  if (asked(root, ["cat-file", "-e", `HEAD:${catalogueFile(gate.checks)}`]) === undefined) {
    return { primitives: [] }
  }
  const base = defaultOf()
  if (branch === base) {
    return { primitives: [] }
  }
  const answer = primitivesDiff(root, `origin/${base}`)
  if ("problems" in answer) {
    return { primitives: [], unread: answer.problems.join("; ") }
  }
  return { primitives: answer.primitives.map(({ id, class: kind }) => ({ id, class: kind })) }
}
