// The Gate mark `dw-sdlc gate --mark` leaves: a green Gate pinned to the pull request's pushed head, which
// stands in for CI unavailable. It is the `dw-sdlc/gate` commit status, or under footprint local a record in
// the git dir beside the Review state. Only a clean tree whose HEAD is that head can carry one.

import type { Footprint } from "../agentic-config.ts"
import { CannotRun } from "../cannot-run.ts"
import { must } from "../git.ts"
import { localReviews } from "./local-reviews.ts"
import { gh, pullRequestNamed, said } from "./read.ts"
import { GATE } from "./state.ts"

/** The pull request a Gate mark goes on, and the head the Gate runs at. */
export type MarkTarget = { repo: string; number: number; url: string; head: string }

const DESCRIPTION = "the Gate passed on this head"

/** Stops the mark on a tree with uncommitted changes: a mark proves a commit, not the tree. */
function requireClean(root: string, remedy: string): void {
  if (must(root, ["status", "--porcelain"]) !== "") {
    throw new CannotRun(`${root} has uncommitted changes: a Gate mark proves a commit, not the tree`, remedy)
  }
}

/**
 * The pull request of the checkout at `root`, once its tree is clean and its HEAD is the pull request's
 * pushed head: a mark names a commit, so a tree that differs from it proves nothing.
 */
export function markTarget(root: string): MarkTarget {
  requireClean(root, "commit or stash them, push, then call again")
  const head = must(root, ["rev-parse", "HEAD"])
  const pr = pullRequestNamed({ number: undefined, repo: undefined }, "gate --mark")
  if (pr.head !== head) {
    throw new CannotRun(
      `${pr.repo}#${pr.number}: its head is ${pr.head}, not HEAD ${head}`,
      "push HEAD, or check out the pull request's head, then call again"
    )
  }
  return { repo: pr.repo, number: pr.number, url: pr.url, head }
}

/**
 * Leaves the Gate mark on the target's head, once HEAD is still it and the Gate left the tree clean, and
 * says where: the status posted, or the file recorded under footprint local.
 */
export function leaveMark(root: string, target: MarkTarget, footprint: Footprint): string {
  const { repo, number, url, head } = target
  if (must(root, ["rev-parse", "HEAD"]) !== head) {
    throw new CannotRun(`HEAD moved from ${head} while the Gate ran`, "call again on the head to prove")
  }
  requireClean(root, "the Gate wrote the tree: commit what it wrote, push, then call again")
  if (footprint === "local") {
    const store = localReviews(root)
    store.recordGate(number, head)
    return `recorded in ${store.gatesFileOf(number)}`
  }
  const fields = { state: "success", context: GATE, target_url: url, description: DESCRIPTION }
  const flags = Object.entries(fields).flatMap(([key, value]) => ["-f", `${key}=${value}`])
  const posted = gh(["api", `repos/${repo}/statuses/${head}`, "--method", "POST", "--silent", ...flags])
  if (posted.status !== 0) {
    throw new CannotRun(
      `${repo}#${number}: posting ${GATE} failed: ${said(posted.stderr)}`,
      `check that gh's token may write commit statuses to ${repo}, then call again`
    )
  }
  return `posted ${GATE} success`
}
