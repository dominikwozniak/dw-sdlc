// GitHub's compare of two commits as gh prints it, read for how far a head is behind a base, which says
// whether an update merged the base in.

import { integer, rootOf } from "./reply.ts"

/** The gh arguments of the compare from `from` to `commit`, the files on its one page. */
export function compareArgs(repo: string, from: string, commit: string): string[] {
  return ["api", `repos/${repo}/compare/${from}...${commit}?per_page=1`]
}

/** How many commits of the compare's base its head lacks: 0 when the head carries all of it. */
export function behindOf(reply: string): number {
  return integer(rootOf(reply, "the compare"), "behind_by")
}
