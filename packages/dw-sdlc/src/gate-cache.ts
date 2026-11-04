// The Gate's cache. A checkout's fingerprint is its working tree's content and the Gate that judges
// it. A green run stamps it in the checkout's own git dir, so each worktree keeps its own stamp.

import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import type { Gate } from "./agentic-config.ts"
import { packageVersion } from "./package-version.ts"
import { workingTree } from "./working-tree.ts"

const STAMP_FILE = "dw-sdlc-gate.green"

/** A checkout's fingerprint and the file its last green run is stamped in. */
export type Fingerprint = { key: string; stampFile: string }

/** The fingerprint of the checkout at `root` judged by `gate`, or why it has none. */
export function fingerprint(root: string, gate: Gate): Fingerprint | { error: string } {
  const found = workingTree(root)
  if ("error" in found) {
    return found
  }
  try {
    const judge = createHash("sha256").update(JSON.stringify({ version: packageVersion(), gate }))
    return { key: `${found.tree} ${judge.digest("hex")}`, stampFile: join(found.gitDir, STAMP_FILE) }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

/** Whether the last green run of this checkout was stamped with this fingerprint. */
export function isGreen({ key, stampFile }: Fingerprint): boolean {
  try {
    return readFileSync(stampFile, "utf8").trim() === key
  } catch {
    return false
  }
}

export function stampGreen({ key, stampFile }: Fingerprint): void {
  try {
    writeFileSync(stampFile, `${key}\n`)
  } catch {
    // A stamp that cannot be written only means the next run does not skip.
  }
}
