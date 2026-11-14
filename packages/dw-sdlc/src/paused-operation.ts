// The operation git left paused in a checkout, read from the record git resumes it from.

import { existsSync } from "node:fs"
import { join } from "node:path"

/** Git's own record of each paused operation, in the git directory a linked worktree keeps apart. */
const PAUSES = [
  { record: "rebase-merge", name: "rebase" },
  { record: "rebase-apply", name: "rebase or am" },
  { record: "MERGE_HEAD", name: "merge" },
  { record: "CHERRY_PICK_HEAD", name: "cherry-pick" },
  { record: "REVERT_HEAD", name: "revert" },
  { record: "sequencer", name: "cherry-pick or revert" },
  { record: "BISECT_LOG", name: "bisect" }
]

/** The operation paused in the checkout whose git directory is `gitDir`, if any. */
export function pausedIn(gitDir: string): string | undefined {
  return PAUSES.find(({ record }) => existsSync(join(gitDir, record)))?.name
}
