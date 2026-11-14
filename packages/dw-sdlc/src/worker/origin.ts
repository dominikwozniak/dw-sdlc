// Brings the clone's view of origin's default branch up to date before a Worker starts: Claude Code's
// `--worktree` branches from the cached `origin/<default>` and fetches it only when the clone has gone a
// day without a fetch, so a Worker could otherwise begin from a ref that is hours or days behind.

import { CannotRun } from "../cannot-run.ts"
import { SLOW_LIMIT_MS, TimedOut } from "../exec.ts"
import { asked, git, type GitAnswer } from "../git.ts"

const REMOTE_HEAD = "refs/remotes/origin/HEAD"
const PREFIX = "refs/remotes/origin/"

/** The branch to fetch: the one origin/HEAD names, else `baseBranch` of the config; undefined when neither names one. */
function defaultBranch(root: string, baseBranch: string): string | undefined {
  const ref = asked(root, ["symbolic-ref", "-q", REMOTE_HEAD])
  if (ref !== undefined && ref.startsWith(PREFIX) && ref.length > PREFIX.length) {
    return ref.slice(PREFIX.length)
  }
  return baseBranch === "" || baseBranch === "auto" ? undefined : baseBranch
}

/**
 * Fetches origin's default branch, or every branch of origin when no default is known, into the remote-tracking
 * refs at `root`; a clone with no origin has nothing to fetch and is left alone. Throws `CannotRun` when the
 * fetch fails, since a Worker started on a stale base is the fault this prevents.
 */
export function freshenOrigin(root: string, baseBranch: string): void {
  if (asked(root, ["remote", "get-url", "origin"]) === undefined) {
    return
  }
  const branch = defaultBranch(root, baseBranch)
  const args = ["fetch", "--quiet", "origin", ...(branch === undefined ? [] : [branch])]
  const fetched = `git fetch origin${branch === undefined ? "" : ` ${branch}`}`
  const stale = (why: string): CannotRun =>
    new CannotRun(
      `${fetched} failed, so the Worker would begin from a stale base: ${why}`,
      "check the network and the access to origin; when origin/HEAD names a branch the remote no longer has, " +
        "run `git remote set-head origin --auto`; then start the Worker again"
    )
  let result: GitAnswer
  try {
    result = git(root, args, { limitMs: SLOW_LIMIT_MS })
  } catch (error) {
    throw error instanceof TimedOut ? stale(error.message) : error
  }
  if ("error" in result) {
    throw stale(result.said)
  }
}
