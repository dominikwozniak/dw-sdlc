// The decision of the Ship script: one ordered list of rows, and the first row whose `when` holds for
// the pull request answers its Action at the time given. A state no row matches parks as undecided.

import type { CiCheck, PrState } from "./state.ts"

export type Status = "act" | "wait" | "park" | "done"
export type Actor = "script" | "agent" | "dev"
export type Answer = {
  status: Status
  action: string
  actor: Actor
  reason: string
  /** A shell-quoted command, when there is one to run. */
  command?: string
  details?: Record<string, unknown>
  /** Seconds to wait before calling again. */
  recheckAfter?: number
}

type Row = { when: (pr: PrState) => boolean; answer: (pr: PrState, now: number) => Answer }

/** How long a head may carry no check before it parks as unverified, from its commit. */
const GRACE_SECONDS = 120
/** How long CI may stay pending before it parks as stuck, from the first start among the pending checks. */
const BUDGET_MINUTES = 40
/** The prefix of the contexts the script posts itself, as `dw-sdlc/review`: never CI. */
const OWN_PREFIX = "dw-sdlc/"

/** The words as one POSIX shell command line, each word that needs it single-quoted. */
function shellLine(words: string[]): string {
  return words.map((word) => (/^[\w./:=@%+,-]+$/.test(word) ? word : `'${word.replaceAll("'", `'\\''`)}'`)).join(" ")
}

function ciOf(pr: PrState): CiCheck[] {
  return pr.checks.filter((check) => !check.name.startsWith(OWN_PREFIX))
}

function pendingOf(pr: PrState): CiCheck[] {
  return ciOf(pr).filter((check) => check.bucket === "pending")
}

function mergeCommand(pr: PrState): string {
  return shellLine(["gh", "pr", "merge", String(pr.number), "--squash", "--match-head-commit", pr.head])
}

const ROWS: Row[] = [
  {
    when: (pr) => pr.state === "MERGED",
    answer: (pr) => ({
      status: "done",
      action: "done",
      actor: "dev",
      reason: pr.mergeCommit === null ? "merged" : `merged as ${pr.mergeCommit.slice(0, 7)}`,
      command: shellLine(["git", "push", "origin", "--delete", pr.branch]),
      ...(pr.mergeCommit === null ? {} : { details: { mergeCommit: pr.mergeCommit } })
    })
  },
  {
    when: (pr) => pr.state === "CLOSED",
    answer: () => ({ status: "park", action: "stop", actor: "dev", reason: "closed without merging" })
  },
  {
    when: (pr) => pr.mergeable === "UNKNOWN",
    answer: () => ({
      status: "wait",
      action: "wait",
      actor: "script",
      reason: "mergeability-unknown",
      recheckAfter: 15
    })
  },
  {
    when: (pr) => ciOf(pr).length === 0,
    answer: (pr, now) =>
      now - Date.parse(pr.headCommittedAt) <= GRACE_SECONDS * 1000
        ? { status: "wait", action: "wait", actor: "script", reason: "unverified", recheckAfter: 15 }
        : {
            status: "park",
            action: "unverified",
            actor: "dev",
            reason: `no check reported on ${pr.head.slice(0, 7)} within ${GRACE_SECONDS} s of its commit`,
            command: mergeCommand(pr)
          }
  },
  {
    when: (pr) => pendingOf(pr).length > 0,
    answer: (pr, now) => {
      const pending = pendingOf(pr)
      // A check queued and not yet started counts from the head's commit.
      const start = Math.min(...pending.map((check) => Date.parse(check.startedAt ?? pr.headCommittedAt)))
      const minutes = Math.floor((now - start) / 60_000)
      return now - start <= BUDGET_MINUTES * 60_000
        ? { status: "wait", action: "wait", actor: "script", reason: "ci-pending", recheckAfter: 60 }
        : {
            status: "park",
            action: "ci-stuck",
            actor: "dev",
            reason: `${pending.length} check(s) pending for ${minutes} min, past the ${BUDGET_MINUTES} min budget`
          }
    }
  }
]

const UNDECIDED: Answer = {
  status: "park",
  action: "undecided",
  actor: "dev",
  reason: "no row of the decision matches this pull request"
}

/** The Action `pr` needs at `now`, milliseconds since the epoch. */
export function decide(pr: PrState, now: number): Answer {
  return ROWS.find((row) => row.when(pr))?.answer(pr, now) ?? UNDECIDED
}
