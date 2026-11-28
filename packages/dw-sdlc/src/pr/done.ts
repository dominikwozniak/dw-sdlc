// What `done` hands on once the pull request is merged: the steps that finish the Landed branch. The script
// stays at reads and gh; each step is the session's or the dev's to run, so the guards see every command.

import { asked, mainCheckout } from "../git.ts"
import { shellLine } from "../shell-line.ts"
import type { Checkout } from "./checkout.ts"
import type { Answer, Step } from "./decide.ts"
import type { PrState } from "./state.ts"

const SWEEP: Step = { by: "dev", run: "/sdlc-sweep" }

const short = (commit: string): string => commit.slice(0, 7)

/** The commit the local branch `name` is at, undefined when no such branch is local. */
function localTip(root: string, name: string): string | undefined {
  return asked(root, ["rev-parse", "--verify", "--quiet", `refs/heads/${name}^{commit}`])
}

/**
 * The steps of the main checkout: one agent step holding only what the state allows, a line saying why a
 * branch stays, and the dev's remote delete while the head ref still stands. A fork's branch is its
 * author's: nothing deletes it and nothing names it.
 */
function mainCheckoutSteps(root: string, pr: PrState, at: Checkout): Step[] {
  const commands = [
    // A detached HEAD is no branch to stay on: the pull needs one.
    ...(at.branch === pr.branch || at.branch === null ? [shellLine(["git", "switch", pr.base])] : []),
    "git pull --rebase"
  ]
  const steps: Step[] = []
  const tip = pr.fromFork ? undefined : localTip(root, pr.branch)
  const stays: Step[] = []
  if (tip === pr.head) {
    commands.push(shellLine(["git", "branch", "-D", pr.branch]))
  } else if (tip !== undefined) {
    stays.push({
      by: "agent",
      do: `tell the dev ${pr.branch} stays: its tip ${short(tip)} is not the merged head ${short(pr.head)}`
    })
  }
  steps.push({ by: "agent", run: commands.join(" && ") }, ...stays)
  if (pr.branchStands && !pr.fromFork) {
    steps.push({ by: "dev", run: shellLine(["git", "push", "origin", "--delete", pr.branch]) })
  }
  return steps
}

/**
 * `answer` with the Landed branch finished, when it is `done` and the checkout is known: the main
 * checkout's steps, or in a linked worktree the dev's `/sdlc-sweep`. Under -R it stands as it is.
 */
export function withLanded(root: string, pr: PrState, answer: Answer, at: Checkout | undefined): Answer {
  if (at === undefined || answer.action !== "done") {
    return answer
  }
  const inLinkedWorktree = mainCheckout(root) !== undefined
  return { ...answer, next: inLinkedWorktree ? [SWEEP] : mainCheckoutSteps(root, pr, at) }
}
