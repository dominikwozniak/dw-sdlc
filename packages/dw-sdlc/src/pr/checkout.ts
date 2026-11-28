// The local checkout against the pull request: whether it is the pull request's branch, and where its
// tip stands against the head GitHub holds. The Ship script reads it before it hands the agent a fix.

import { asked, findRepository } from "../git.ts"
import type { Answer, Step } from "./decide.ts"
import type { PrState } from "./state.ts"
import { upstreamName } from "./upstream.ts"

/** The branch checked out, null on a detached HEAD, and the commit it stands at. */
export type Checkout = { branch: string | null; head: string }

/**
 * What the checkout is to the pull request: its branch at the head or behind it, its branch with a commit
 * the pull request lacks, or another branch.
 */
type Standing = "current" | "behind" | "ahead" | "elsewhere"

/** The checkout at `root`; undefined outside a repository or on a branch with no commit. */
export function readCheckout(root: string): Checkout | undefined {
  if (findRepository(root) === undefined) {
    return undefined
  }
  const head = asked(root, ["rev-parse", "--verify", "--quiet", "HEAD"])
  if (head === undefined) {
    return undefined
  }
  return { branch: asked(root, ["symbolic-ref", "--quiet", "--short", "HEAD"]) ?? null, head }
}

/**
 * Where the checkout stands. It is the pull request's branch by its own name or by the name its upstream
 * gives. Behind: its tip is one of the pull request's last 100 commits, before the head. Any other tip on
 * that branch is a commit the pull request lacks.
 */
function standingOf(root: string, pr: Pick<PrState, "branch" | "head" | "commits">, at: Checkout): Standing {
  const { branch, head } = at
  const onBranch = branch !== null && (branch === pr.branch || upstreamName(root, branch) === pr.branch)
  if (!onBranch) {
    return "elsewhere"
  }
  if (head === pr.head) {
    return "current"
  }
  return pr.commits.includes(head) ? "behind" : "ahead"
}

const short = (commit: string): string => commit.slice(0, 7)

/** The answer that sends the dev to the pull request's branch: where the checkout stands, and where it should. */
function wrongCheckout(pr: PrState, { branch, head }: Checkout, standing: "ahead" | "elsewhere"): Answer {
  const where = branch === null ? "a detached HEAD" : branch
  const lacks = standing === "ahead" ? `${where} at ${short(head)}, which the pull request lacks` : where
  return {
    status: "park",
    action: "wrong-checkout",
    actor: "dev",
    reason: `the checkout is on ${lacks}, not on ${pr.branch} at ${short(pr.head)}, the branch of the pull request`,
    details: { branch, head, expected: { branch: pr.branch, head: pr.head } },
    next: [{ by: "dev", run: `git switch ${pr.branch}` }],
    blockers: []
  }
}

const PULL: Step = { by: "agent", run: "git pull --rebase" }

/**
 * `answer` with the checkout taken into account, when it hands the agent a fix: on the pull request's
 * branch behind the head `git pull --rebase` comes first in `next`; anywhere else the dev switches first.
 * An answer with no step for the agent stands as the pull request alone gives it.
 */
export function withCheckout(root: string, pr: PrState, answer: Answer, at: Checkout | undefined): Answer {
  if (at === undefined || answer.status !== "act" || answer.actor !== "agent") {
    return answer
  }
  const standing = standingOf(root, pr, at)
  if (standing === "current") {
    return answer
  }
  return standing === "behind" ? { ...answer, next: [PULL, ...answer.next] } : wrongCheckout(pr, at, standing)
}
