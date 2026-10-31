// The decision of the Ship script: one ordered list of rows, and the first row whose `when` holds for
// the pull request answers its Action. A state no row matches parks as undecided.

import type { PrState } from "./state.ts"

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

type Row = { when: (pr: PrState) => boolean; answer: (pr: PrState) => Answer }

/** The words as one POSIX shell command line, each word that needs it single-quoted. */
function shellLine(words: string[]): string {
  return words.map((word) => (/^[\w./:=@%+,-]+$/.test(word) ? word : `'${word.replaceAll("'", `'\\''`)}'`)).join(" ")
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
  }
]

const UNDECIDED: Answer = {
  status: "park",
  action: "undecided",
  actor: "dev",
  reason: "no row of the decision matches this pull request"
}

export function decide(pr: PrState): Answer {
  return ROWS.find((row) => row.when(pr))?.answer(pr) ?? UNDECIDED
}
