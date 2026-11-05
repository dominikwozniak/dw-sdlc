// The decision of the Ship script: one ordered list of rows, and the first row whose `when` holds for
// the pull request answers its Action at the time given; every later row that holds rides in its
// blockers. The last rows say who merges what no row before them holds back.

import type { PrMerge, PrReview } from "../agentic-config.ts"
import type { CiCheck, PrState, Thread } from "./state.ts"

export type Status = "act" | "wait" | "park" | "done"
export type Actor = "script" | "agent" | "dev"
export type Action =
  | "done"
  | "stop"
  | "wait"
  | "fix-conflicts"
  | "update-branch"
  | "fix-ci"
  | "address-review"
  | "review"
  | "mark-reviewed"
  | "unverified"
  | "ci-stuck"
  | "awaiting-reply"
  | "mark-ready"
  | "awaiting-author"
  | "awaiting-approval"
  | "ready-to-merge"
  | "merge"
/** The Actions the script performs itself, each one gh command. */
export type ScriptAction = "update-branch" | "mark-ready" | "mark-reviewed" | "merge"
/** Where a Review depth comes from: the dev's `--review` for this call, or `pr.review`. */
export type DepthSource = "flag" | "config"
/**
 * What the decision reads beside the pull request: who merges it, how closely a Review reads it, and
 * the slash command a `full` Review runs.
 */
export type Policy = { merge: PrMerge; review: { depth: PrReview; source: DepthSource }; reviewCommand: string }
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
  when: (pr: PrState, policy: Policy) => boolean
  answer: (pr: PrState, now: number, policy: Policy) => Omit<Answer, "blockers">
  /** A row that wins answers with no blockers: a merged, closed or still-computing pull request. */
  alone?: true
  /** A row that never rides in blockers: who merges is no blocker. */
  merging?: true
}

/** How long a head may carry no check before it parks as unverified, from its commit. */
const GRACE_SECONDS = 120
/** How long CI may stay pending before it parks as stuck, from the first start among the pending checks. */
const BUDGET_MINUTES = 40
/** The prefix of the contexts the script posts itself, as `dw-sdlc/review`: never CI. */
const OWN_PREFIX = "dw-sdlc/"
/** The commit status a clean review of the head leaves on it. */
export const REVIEW = "dw-sdlc/review"
/** Its one state: a failure or a pending status would turn the pull request unstable. */
export const REVIEW_STATE = "success"

/** The words as one POSIX shell command line, each word that needs it single-quoted. */
export function shellLine(words: string[]): string {
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

/** The viewer's own pull request without a review success on its head: the one a Review reads. */
export function awaitsReview(pr: PrState): boolean {
  return pr.viewerDidAuthor && !pr.checks.some((check) => check.name === REVIEW && check.bucket === "pass")
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

/**
 * The gh arguments that post the `dw-sdlc/review` success on the head, `description` saying how it was
 * read. The path names the repository, so the call reads the same from any checkout.
 */
export function reviewStatusArgs(pr: PrState, description: string): string[] {
  const fields = { state: REVIEW_STATE, context: REVIEW, target_url: pr.url, description }
  const flags = Object.entries(fields).flatMap(([key, value]) => ["-f", `${key}=${value}`])
  return ["api", `repos/${pr.repo}/statuses/${pr.head}`, "--method", "POST", "--silent", ...flags]
}

/** Why the head carries the success the script posts: the Review it carries, else the dev's word or the config. */
function markedDescription(pr: PrState, policy: Policy): string {
  if (pr.lastReviewed?.carried === true) {
    return `carried from ${pr.lastReviewed.commit.slice(0, 7)}`
  }
  return `off: ${policy.review.source === "flag" ? "--review off" : "pr.review"}`
}

/** A script Action's gh arguments; `repo` is `-R` and the repository when the call names it, else empty. */
const HOST: Record<ScriptAction, (pr: PrState, repo: string[], policy: Policy) => string[]> = {
  "update-branch": (pr, repo) => ["pr", "update-branch", String(pr.number), ...repo],
  "mark-ready": (pr, repo) => ["pr", "ready", String(pr.number), ...repo],
  "mark-reviewed": (pr, _, policy) => reviewStatusArgs(pr, markedDescription(pr, policy)),
  merge: (pr, repo) => ["pr", "merge", String(pr.number), ...repo, "--squash", "--match-head-commit", pr.head]
}

export function isScriptAction(action: Action): action is ScriptAction {
  return Object.hasOwn(HOST, action)
}

/**
 * The gh arguments of a script Action, `-R` naming the repository when `named`. The update merges the
 * base in, never --rebase, which rewrites the branch on GitHub; the merge names the head it read.
 */
export function hostArgs(pr: PrState, action: ScriptAction, policy: Policy, named: boolean): string[] {
  return HOST[action](pr, named ? ["-R", pr.repo] : [], policy)
}

/** The command a script Action leaves the dev to run, from a checkout of the repository. */
export function devCommand(pr: PrState, action: ScriptAction, policy: Policy): string {
  return shellLine(["gh", ...hostArgs(pr, action, policy, false)])
}

/** The merge left to the dev, `reason` saying why it is theirs. */
export function readyToMerge(pr: PrState, policy: Policy, reason: string): Omit<Answer, "blockers"> {
  return { status: "park", action: "ready-to-merge", actor: "dev", reason, command: devCommand(pr, "merge", policy) }
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
    when: (pr) => pr.mergeStateStatus === "BEHIND",
    answer: (pr) => ({ status: "act", action: "update-branch", actor: "script", reason: `behind ${pr.base}` })
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
    // The dev merges another author's pull request, so it needs no Review. Under off no one reads
    // the head, and a head with the own changes of the last reviewed commit carries its success: the
    // script posts the success itself. Otherwise the Review reads from that commit, when there is one.
    when: awaitsReview,
    answer: (pr, _, { review, reviewCommand }) => {
      const byScript = review.depth === "off" || pr.lastReviewed?.carried === true
      return {
        status: "act",
        action: byScript ? "mark-reviewed" : "review",
        actor: byScript ? "script" : "agent",
        reason: `no ${REVIEW} success on ${pr.head.slice(0, 7)}`,
        details: {
          ...review,
          ...(review.depth === "full" ? { reviewCommand } : {}),
          ...(pr.lastReviewed === null ? {} : { since: pr.lastReviewed.commit })
        }
      }
    }
  },
  {
    when: (pr) => ciOf(pr).length === 0,
    answer: (pr, now, policy) =>
      now - Date.parse(pr.headCommittedAt) <= GRACE_SECONDS * 1000
        ? { status: "wait", action: "wait", actor: "script", reason: "unverified", recheckAfter: 15 }
        : {
            status: "park",
            action: "unverified",
            actor: "dev",
            reason: `no check reported on ${pr.head.slice(0, 7)} within ${GRACE_SECONDS} s of its commit`,
            command: devCommand(pr, "merge", policy)
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
  },
  {
    when: (pr) => pr.draft && pr.viewerDidAuthor,
    answer: () => ({ status: "act", action: "mark-ready", actor: "script", reason: "still a draft" })
  },
  {
    when: (pr) => pr.draft && !pr.viewerDidAuthor,
    answer: () => ({
      status: "park",
      action: "awaiting-author",
      actor: "dev",
      reason: "another author's draft: marking it ready is the author's"
    })
  },
  {
    when: (pr) => pr.reviewDecision === "REVIEW_REQUIRED",
    answer: () => ({
      status: "park",
      action: "awaiting-approval",
      actor: "dev",
      reason: "an approving review is required"
    })
  },
  {
    when: (pr) => !pr.viewerDidAuthor,
    answer: (pr, _, policy) => readyToMerge(pr, policy, "another author's pull request: the merge is the dev's"),
    merging: true
  },
  {
    when: (_, { merge }) => merge === "auto",
    answer: () => ({ status: "act", action: "merge", actor: "script", reason: "green, reviewed and the viewer's own" }),
    merging: true
  },
  {
    when: (_, { merge }) => merge === "ask",
    answer: (pr, _, policy) => readyToMerge(pr, policy, "pr.merge is ask: the merge is the dev's"),
    merging: true
  }
]

function blockerOf({ action, actor, reason, details }: Omit<Answer, "blockers">): Blocker {
  return { action, actor, reason, ...(details === undefined ? {} : { details }) }
}

/** The Action `pr` needs at `now`, milliseconds since the epoch, under `policy`. */
export function decide(pr: PrState, now: number, policy: Policy): Answer {
  const index = ROWS.findIndex((row) => row.when(pr, policy))
  const row = ROWS[index]
  if (row === undefined) {
    throw new Error(`no row of the decision matches ${pr.url} under pr.merge ${policy.merge}`)
  }
  const later =
    row.alone === true ? [] : ROWS.slice(index + 1).filter((other) => !other.merging && other.when(pr, policy))
  return {
    ...row.answer(pr, now, policy),
    blockers: later.map((other) => blockerOf(other.answer(pr, now, policy)))
  }
}
