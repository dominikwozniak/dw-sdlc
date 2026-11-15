// `pr.reviewFull`: the Primitives whose change `pr.review: auto` always reads in full (ADR 0026). The
// ids are the repository's; the paths come from the catalogue, found as `dw-sdlc primitives` finds it.

import type { ResolvedConfig } from "../agentic-config.ts"
import { type Catalogue, primitivesNaming, readCatalogue } from "../catalogue.ts"
import { catalogueFile } from "../checks/primitives.ts"

/**
 * What `pr.reviewFull` makes of a changed file: `null` with no id listed; `"closed"` when the list cannot
 * be held to the tree, the catalogue missing or unreadable or an id it lacks, so every change reads in
 * full; else whether a listed Primitive owns a path.
 */
export type ReviewFull = null | "closed" | ((path: string) => boolean)

function catalogueAt(root: string, file: string): Catalogue | null {
  try {
    const read = readCatalogue(root, file)
    return read.state === "valid" ? read.catalogue : null
  } catch {
    return null
  }
}

/** The rule `config` lists at `root`, read from the catalogue the `primitives` Check points at. */
export function reviewFullOf(root: string, { pr, gate }: Pick<ResolvedConfig, "pr" | "gate">): ReviewFull {
  const ids = new Set(pr.reviewFull)
  if (ids.size === 0) {
    return null
  }
  const catalogue = catalogueAt(root, catalogueFile(gate.checks))
  if (catalogue === null || [...ids].some((id) => !catalogue.primitives.some((primitive) => primitive.id === id))) {
    return "closed"
  }
  return (path) => primitivesNaming(catalogue, path).some((primitive) => ids.has(primitive.id))
}
