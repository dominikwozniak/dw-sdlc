// The upstream of the current branch, read from git, for a branch pushed under another name: gh resolves
// its pull request neither through `@{push}` nor by the local name, so `pr ship` and recap ask by the name
// the upstream gives, and take that pull request only when its commits hold the local head.

import { git } from "../working-tree.ts"
import type { PrState } from "./state.ts"

/** `git <args>` at `root`, or undefined when it exits non-zero as a question answered no. */
function asked(root: string, args: string[]): string | undefined {
  const result = git(root, args)
  return "out" in result ? result.out : undefined
}

/**
 * The remote branch name `branch` tracks, when it differs from `branch`. Read from the config, so it holds
 * after the remote deleted the branch.
 */
export function upstreamName(root: string, branch: string): string | undefined {
  const remote = asked(root, ["config", "--get", `branch.${branch}.remote`])
  const merge = asked(root, ["config", "--get", `branch.${branch}.merge`])
  if (remote === undefined || remote === "." || merge === undefined || !merge.startsWith("refs/heads/")) {
    return undefined
  }
  const name = merge.slice("refs/heads/".length)
  return name === branch ? undefined : name
}

/** Whether `pr`'s commits hold `head`, so the head is on GitHub whatever became of the upstream. */
export function holds(pr: PrState, head: string | null): boolean {
  return head !== null && pr.commits.includes(head)
}

/** The checked-out branch at `root` whose upstream has another name: the branch, its head commit and that name. */
export type Renamed = { branch: string; head: string; name: string }

/** The checked-out branch whose upstream has another name; undefined on a detached HEAD or a branch with no commit. */
export function renamedUpstream(root: string): Renamed | undefined {
  const branch = asked(root, ["symbolic-ref", "--quiet", "--short", "HEAD"])
  const head = asked(root, ["rev-parse", "--verify", "--quiet", "HEAD"])
  if (branch === undefined || head === undefined) {
    return undefined
  }
  const name = upstreamName(root, branch)
  return name === undefined ? undefined : { branch, head, name }
}
