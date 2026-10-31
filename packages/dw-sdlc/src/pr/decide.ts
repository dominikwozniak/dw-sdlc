// The decision of the Ship script: one ordered list of rows, and the first row whose `when` holds for
// the pull request answers its Action at the time given; every later row that holds rides in its
// blockers. A state no row matches parks as undecided.

import type { CiCheck, PrState, Thread } from "./state.ts"

export type Status = "act" | "wait" | "park" | "done"
export type Actor = "script" | "agent" | "dev"
export type Action =
  | "done"
  | "stop"
  | "wait"
  | "fix-conflicts"
  | "fix-ci"
  | "address-review"
  | "review"
  | "unverified"
  | "ci-stuck"
  | "awaiting-reply"
  | "undecided"
/** An Action the pull request needs beside the one its answer names, so one push can fix several. */
export type Blocker = { action: Action; actor: Actor; reason: string; details?: Record<string, unknown> }
export type Answer = Blocker & {
  status: Status
  /** A shell-quoted command, when there is one to run. */
  command?: string
  /** Seconds to wait before calling again. */
  recheckAfter?: number
  blockers: Blocker[]
}

type Row = {
  when: (pr: PrState) => boolean
  answer: (pr: PrState, now: number) => Omit<Answer, "blockers">
  /** A row that wins answers with no blockers: a merged, closed or still-computing pull request. */
  alone?: true
}

/** How long a head may carry no check before it parks as unverified, from its commit. */
const GRACE_SECONDS = 120
/** How long CI may stay pending before it parks as stuck, from the first start among the pending checks. */
const BUDGET_MINUTES = 40
/** The prefix of the contexts the script posts itself, as `dw-sdlc/review`: never CI. */
const OWN_PREFIX = "dw-sdlc/"
/** The commit status a clean review of the head leaves on it. */
const REVIEW = "dw-sdlc/review"

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

function failingOf(pr: PrState): CiCheck[] {
  return ciOf(pr).filter((check) => check.bucket === "fail")
}

/** A failing check as the agent reads it: its link, and the command that prints a GitHub Actions job's log. */
function failure({ name, link, log }: CiCheck): Record<string, unknown> {
  return { name, link, ...(log === null ? {} : { log: shellLine(log) }) }
}

/** The unresolved threads whose last comment is the viewer's, or with `false` someone else's. */
function threads(pr: PrState, lastByViewer: boolean): Thread[] {
  return pr.unresolvedThreads.filter((thread) => thread.lastByViewer === lastByViewer)
}

function listed({ id, path, line, author, body }: Thread): Record<string, unknown> {
  return { id, path, line, author, body }
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
    }),
    alone: true
  },
  {
    when: (pr) => pr.state === "CLOSED",
    answer: () => ({ status: "park", action: "stop", actor: "dev", reason: "closed without merging" }),
    alone: true
  },
  {
    when: (pr) => pr.mergeable === "UNKNOWN",
    answer: () => ({
      status: "wait",
      action: "wait",
      actor: "script",
      reason: "mergeability-unknown",
      recheckAfter: 15
    }),
    alone: true
  },
  {
    when: (pr) => pr.mergeable === "CONFLICTING",
    answer: (pr) => ({
      status: "act",
      action: "fix-conflicts",
      actor: "agent",
      reason: `conflicts with ${pr.base}`,
      details: { base: pr.base }
    })
  },
  {
    when: (pr) => failingOf(pr).length > 0,
    answer: (pr) => ({
      status: "act",
      action: "fix-ci",
      actor: "agent",
      reason: `${failingOf(pr).length} check(s) failing`,
      details: { checks: failingOf(pr).map(failure) }
    })
  },
  {
    when: (pr) => threads(pr, false).length > 0,
    answer: (pr) => ({
      status: "act",
      action: "address-review",
      actor: "agent",
      reason: `${threads(pr, false).length} unresolved thread(s)`,
      details: { threads: threads(pr, false).map(listed) }
    })
  },
  {
    when: (pr) => pr.reviewDecision === "CHANGES_REQUESTED",
    answer: () => ({ status: "act", action: "address-review", actor: "agent", reason: "changes requested" })
  },
  {
    when: (pr) => !pr.checks.some((check) => check.name === REVIEW && check.bucket === "pass"),
    answer: (pr) => ({
      status: "act",
      action: "review",
      actor: "agent",
      reason: `no ${REVIEW} success on ${pr.head.slice(0, 7)}`
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
  },
  {
    when: (pr) => threads(pr, true).length > 0,
    answer: (pr) => ({
      status: "park",
      action: "awaiting-reply",
      actor: "dev",
      reason: `${threads(pr, true).length} thread(s) await a reply`,
      details: { threads: threads(pr, true).map(listed) }
    })
  }
]

const UNDECIDED: Answer = {
  status: "park",
  action: "undecided",
  actor: "dev",
  reason: "no row of the decision matches this pull request",
  blockers: []
}

function blockerOf({ action, actor, reason, details }: Omit<Answer, "blockers">): Blocker {
  return { action, actor, reason, ...(details === undefined ? {} : { details }) }
}

/** The Action `pr` needs at `now`, milliseconds since the epoch. */
export function decide(pr: PrState, now: number): Answer {
  const index = ROWS.findIndex((row) => row.when(pr))
  const row = ROWS[index]
  if (row === undefined) {
    return UNDECIDED
  }
  const later = row.alone === true ? [] : ROWS.slice(index + 1).filter((other) => other.when(pr))
  return { ...row.answer(pr, now), blockers: later.map((other) => blockerOf(other.answer(pr, now))) }
}
