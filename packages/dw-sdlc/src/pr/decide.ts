// The decision of the Ship script: one ordered list of rows, and the first row whose `when` holds for
// the pull request answers its Action at the time given; every later row that holds rides in its
// blockers. The last rows say who merges what no row before them holds back.

import type { PrMerge, PrReview, ResolvedConfig, ReviewDepth } from "../agentic-config.ts"
import { route } from "./route.ts"
import { awaitsReview, type CiCheck, OFF_PREFIX, type PrState, REVIEW, type Thread } from "./state.ts"

export { REVIEW }

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
  | "review-limit"
  | "mark-reviewed"
  | "unverified"
  | "ci-stuck"
  | "awaiting-reply"
  | "awaiting-review"
  | "mark-ready"
  | "awaiting-author"
  | "awaiting-approval"
  | "partial-read"
  | "ready-to-merge"
  | "merge"
/** The Actions the script performs itself, each one gh command. */
export type ScriptAction = "update-branch" | "mark-ready" | "mark-reviewed" | "merge"
/**
 * Where a Review depth comes from: the dev's `--review` for this call, a depth `pr.review` sets, or the
 * rules `pr.review: auto` routes it by.
 */
export type DepthSource = "flag" | "config" | "auto"
/**
 * What the decision reads beside the pull request: who merges it, how closely a Review reads it, the
 * dev's word or `pr.review`, and the slash command a `full` Review runs.
 */
export type Policy = {
  merge: PrMerge
  review: { depth: ReviewDepth; source: "flag" } | { depth: PrReview; source: "config" }
  reviewCommand: string
}
/** The policy a repository's `pr` key declares; a flag for one call goes over it. */
export function declaredPolicy({ merge, review, reviewCommand }: ResolvedConfig["pr"]): Policy {
  return { merge, review: { depth: review, source: "config" }, reviewCommand }
}

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
/**
 * How many Reviews that each left a Finding open, with no success between them, the script lets run: the
 * next call parks the pull request for the dev. A constant, like the depth rules, so no repository turns
 * the loop back on.
 */
const REVIEW_LIMIT = 3
/** The prefix of the contexts the script posts itself, as `dw-sdlc/review`: never CI. */
const OWN_PREFIX = "dw-sdlc/"
/**
 * The state of the review status a clean or skipped Review leaves; the read mark's is failure, on a
 * head the fix then leaves behind. A pending status would turn the pull request unstable.
 */
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

/** A failing check as the agent reads it: its link, and the command that prints a GitHub Actions job's log. */
function failure({ name, link, log }: CiCheck): Record<string, unknown> {
  return { name, link, ...(log === null ? {} : { log: shellLine(log) }) }
}

/** The unresolved threads whose last comment is the viewer's, or with `false` someone else's. */
function threads(pr: PrState, lastByViewer: boolean): Thread[] {
  return pr.unresolvedThreads.filter((thread) => thread.lastByViewer === lastByViewer)
}

/**
 * Whether the decision is changes requested and every reviewer asking for them has been answered by a
 * push. One review still unanswered, or none in the reply to judge, keeps the agent's turn.
 */
function reviewAnswered({ reviewDecision, changeRequests }: PrState): boolean {
  return (
    reviewDecision === "CHANGES_REQUESTED" &&
    changeRequests.length > 0 &&
    changeRequests.every(({ answered }) => answered)
  )
}

/** The names, `a`, `a and b` or `a, b and c`. */
function namesOf(names: string[]): string {
  const last = names.at(-1)
  return names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${last}`
}

function listed({ id, path, line, author, body }: Thread): Record<string, unknown> {
  return { id, path, line, author, body }
}

/**
 * The gh arguments that post `dw-sdlc/review` on the head, a success unless `state` says otherwise,
 * `description` saying how it was read. The path names the repository, so the call reads the same from
 * any checkout.
 */
export function reviewStatusArgs(pr: PrState, description: string, state: string = REVIEW_STATE): string[] {
  const fields = { state, context: REVIEW, target_url: pr.url, description }
  const flags = Object.entries(fields).flatMap(([key, value]) => ["-f", `${key}=${value}`])
  return ["api", `repos/${pr.repo}/statuses/${pr.head}`, "--method", "POST", "--silent", ...flags]
}

/** Whether the dev named a depth for a head that would carry the status: their word beats the carry. */
function flagOverCarry(pr: PrState, { review }: Policy): boolean {
  return pr.carried && review.source === "flag"
}

/** The reviewed commit whose success the head carries, if it does and the dev named no depth. */
function carriedFrom(pr: PrState, policy: Policy): string | null {
  return pr.carried && !flagOverCarry(pr, policy) ? (pr.lastRead?.commit ?? null) : null
}

/**
 * The commit the Review reads from: the last one a Review read, clean or not, so the Review after a fix
 * reads the fix. Over a carry the dev's depth reads the whole diff, since the changes after that commit
 * are only the base's.
 */
function sinceOf(pr: PrState, policy: Policy): string | null {
  return flagOverCarry(pr, policy) ? null : (pr.lastRead?.commit ?? null)
}

/** A depth as the answer names it, and under off why no one reads the head. */
type Depth =
  | { depth: Exclude<ReviewDepth, "off">; source: DepthSource }
  | { depth: "off"; source: DepthSource; why: string }

/** The depth a Review reads the head at: the dev's or the one `pr.review` sets, else the one the rules route. */
function depthOf(pr: PrState, { review }: Policy): Depth {
  const { depth, source } = review
  if (depth === "off") {
    return { depth, source, why: source === "flag" ? "--review off" : "pr.review" }
  }
  if (depth !== "auto") {
    return { depth, source }
  }
  return { ...route(pr.changed), source: "auto" }
}

/** Why the head carries the success the script posts: the Review it carries, else why its depth is off. */
function markedDescription(pr: PrState, policy: Policy): string {
  const carried = carriedFrom(pr, policy)
  if (carried !== null) {
    return `carried from ${carried.slice(0, 7)}`
  }
  const depth = depthOf(pr, policy)
  if (depth.depth !== "off") {
    throw new Error(`the script marks ${pr.url} reviewed at ${depth.depth}, neither off nor a carry`)
  }
  return `${OFF_PREFIX} ${depth.why}`
}

/** The park at the limit: the dev accepts the head as it stands, or names a depth for one more Review. */
function reviewLimit(pr: PrState): Omit<Answer, "blockers"> {
  const { count, since } = pr.marks
  const from = since === null ? "the start of the pull request" : `the success on ${since.slice(0, 7)}`
  return {
    status: "park",
    action: "review-limit",
    actor: "dev",
    reason: `${count} Reviews since ${from} left a Finding open: accepting the head is the dev's`,
    command: shellLine(["dw-sdlc", "pr", "reviewed", String(pr.number), "-R", pr.repo, "--head", pr.head, "--accept"])
  }
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
      ...(pr.branchStands && !pr.fromFork
        ? { command: shellLine(["git", "push", "origin", "--delete", pr.branch]) }
        : {}),
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
    // GitHub reports BEHIND only under a rule that a branch be up to date; the compare tells it anywhere.
    when: (pr) => pr.mergeStateStatus === "BEHIND" || (pr.behindBy ?? 0) > 0,
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
    when: (pr) => pr.reviewDecision === "CHANGES_REQUESTED" && !reviewAnswered(pr),
    answer: () => ({ status: "act", action: "address-review", actor: "agent", reason: "changes requested" })
  },
  {
    // Another author's pull request needs no Review: the dev merges it. The script posts the success
    // under off, and over a carry, which reads at no depth.
    when: awaitsReview,
    answer: (pr, _, policy) => {
      const since = sinceOf(pr, policy)
      const head = { status: "act", reason: `no ${REVIEW} success on ${pr.head.slice(0, 7)}` } as const
      const after = since === null ? {} : { since }
      if (carriedFrom(pr, policy) !== null) {
        return { ...head, action: "mark-reviewed", actor: "script", details: after }
      }
      const { depth, source } = depthOf(pr, policy)
      // The dev's own depth buys one Review past the limit; a Review under off needs none.
      if (depth !== "off" && source !== "flag" && pr.marks.count >= REVIEW_LIMIT) {
        return reviewLimit(pr)
      }
      const byScript = depth === "off"
      return {
        ...head,
        action: byScript ? "mark-reviewed" : "review",
        actor: byScript ? "script" : "agent",
        details: {
          depth,
          source,
          // The agent may raise a routed depth to full, so auto names the command at any depth.
          ...(depth === "full" || source === "auto" ? { reviewCommand: policy.reviewCommand } : {}),
          ...after
        }
      }
    }
  },
  {
    // A head whose every check was skipped has run nothing: a draft's are, until `ready` starts the run.
    when: (pr) => ciOf(pr).length === 0 || (!pr.draft && ciOf(pr).every((check) => check.bucket === "skipping")),
    answer: (pr, now, policy) =>
      now - Math.max(Date.parse(pr.headCommittedAt), Date.parse(pr.readyAt ?? pr.headCommittedAt)) <=
      GRACE_SECONDS * 1000
        ? { status: "wait", action: "wait", actor: "script", reason: "unverified", recheckAfter: 15 }
        : {
            status: "park",
            action: "unverified",
            actor: "dev",
            reason:
              ciOf(pr).length === 0
                ? `no check reported on ${pr.head.slice(0, 7)} within ${GRACE_SECONDS} s of its commit`
                : `every check on ${pr.head.slice(0, 7)} was skipped, ${GRACE_SECONDS} s after its commit or its ready`,
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
    // After awaiting-reply, so the pull request's own Review and CI run first and the reviewer gets a
    // verified fix. Only the reviewer can act: their review stands until they review again or dismiss it.
    when: reviewAnswered,
    answer: (pr) => ({
      status: "park",
      action: "awaiting-review",
      actor: "dev",
      reason: `changes requested by ${namesOf(pr.changeRequests.map(({ reviewer }) => reviewer))}, answered by a push: the next review is the reviewer's`
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
    // A failure or an open thread past what the read holds shows in no row above.
    when: (pr) => pr.cutOff.length > 0,
    answer: (pr, _, policy) => ({
      status: "park",
      action: "partial-read",
      actor: "dev",
      reason: `the read holds only ${pr.cutOff.join(" and ")}: the merge is the dev's`,
      command: devCommand(pr, "merge", policy)
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

/** `<status> <action>`, the action dropped when it repeats the status. */
export function labelOf({ status, action }: Pick<Answer, "status" | "action">): string {
  return status === action ? status : `${status} ${action}`
}

/** The label and the reason, then the recheck and the command. */
export function lineOf(answer: Answer): string {
  const { reason, command, recheckAfter } = answer
  const recheck = recheckAfter === undefined ? "" : `, recheck in ${recheckAfter} s`
  return `${labelOf(answer)}: ${reason}${recheck}${command === undefined ? "" : ` — ${command}`}`
}

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
