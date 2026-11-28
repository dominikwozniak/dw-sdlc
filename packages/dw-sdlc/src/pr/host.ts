// The gh commands of the Actions the Ship script performs itself: the call the script runs, naming the
// repository, and the one it leaves the dev to run from a checkout. Under --without-ci a merge carries
// --admin, since gh turns on auto-merge in place of merging while required checks have not passed.

import { shellLine } from "../shell-line.ts"
import type { Policy } from "./decide.ts"
import type { PrState } from "./state.ts"

/** The Actions the script performs itself, each one gh command. */
export type ScriptAction = "update-branch" | "mark-ready" | "merge"

/**
 * A script Action's gh arguments: `repo` is `-R` and the repository when the call names it, `admin` is
 * `--admin` under --without-ci; each is empty otherwise.
 */
const HOST: Record<ScriptAction, (pr: PrState, repo: string[], admin: string[]) => string[]> = {
  "update-branch": (pr, repo) => ["pr", "update-branch", String(pr.number), ...repo],
  "mark-ready": (pr, repo) => ["pr", "ready", String(pr.number), ...repo],
  merge: (pr, repo, admin) => [
    "pr",
    "merge",
    String(pr.number),
    ...repo,
    ...admin,
    "--squash",
    "--match-head-commit",
    pr.head
  ]
}

export function isScriptAction(action: string): action is ScriptAction {
  return Object.hasOwn(HOST, action)
}

/**
 * The gh arguments of a script Action, `-R` naming the repository when `named`. The update merges the
 * base in, never --rebase, which rewrites the branch on GitHub; the merge names the head it read.
 */
export function hostArgs(
  pr: PrState,
  action: ScriptAction,
  named: boolean,
  { withoutCi }: Pick<Policy, "withoutCi">
): string[] {
  return HOST[action](pr, named ? ["-R", pr.repo] : [], withoutCi ? ["--admin"] : [])
}

/** The command a script Action leaves the dev to run, from a checkout of the repository. */
export function devCommand(pr: PrState, action: ScriptAction, policy: Pick<Policy, "withoutCi">): string {
  return shellLine(["gh", ...hostArgs(pr, action, false, policy)])
}
