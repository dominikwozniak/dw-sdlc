// The decision of the Ship script: one ordered list of rows, and the first row whose `when` holds for
// the pull request answers its Action at the time given; every later row that holds rides in its
// blockers. The last rows say who merges what no row before them holds back.

import type { Footprint, PrCiUnavailable, PrMerge, ResolvedConfig } from "../agentic-config.ts"
import { shellLine } from "../shell-line.ts"
import {
  BUDGET_MINUTES,
  ciOf,
  ciStartOf,
  failingOf,
  failure,
  GRACE_SECONDS,
  pendingOf,
  proven,
  unavailableOf
} from "./ci.ts"
import type { ReviewFull } from "./review-full.ts"
import { type ReadMarks, reviewCall, type ReviewPolicy } from "./standing.ts"
import { awaitsReview, OFF_PREFIX, type PrState, REVIEW, type Thread } from "./state.ts"

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
  | "prove-locally"
  | "ci-unavailable"
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
 * What the decision reads beside the pull request: who merges it, how closely a Review reads it, the
 * dev's word or `pr.review`, the slash command a `full` Review runs, where the Review state lives, whether
 * a Gate mark stands in for CI unavailable, and whether `gate.steps` declares a Gate to leave one.
 */
export type Policy = {
  merge: PrMerge
  review: ReviewPolicy
  reviewCommand: string
  reviewFull: ReviewFull
  footprint: Footprint
  ciUnavailable: PrCiUnavailable
  gateSteps: boolean
}
/**
 * The policy a repository declares in its `pr` key and `footprint`, `reviewFull` as `reviewFullOf` reads
 * it; a flag for one call goes over it.
 */
export function declaredPolicy(
  { pr, footprint, gate }: Pick<ResolvedConfig, "pr" | "footprint" | "gate">,
  reviewFull: ReviewFull
): Policy {
  const { merge, review, reviewCommand, ciUnavailable } = pr
  const declared = { merge, review: { depth: review, source: "config" }, reviewCommand, reviewFull } as const
  return { ...declared, footprint, ciUnavailable, gateSteps: gate.steps.length > 0 }
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

/**
 * The state of the review status a clean or skipped Review leaves; the read mark's is failure, on a
 * head the fix then leaves behind. A pending status would turn the pull request unstable.
 */
export const REVIEW_STATE = "success"

/** The checks CI unavailable leaves to a Gate mark: none under pr.ciUnavailable ci, where they fail. */
const unavailableUnder = (pr: PrState, policy: Policy) => unavailableOf(pr, policy.ciUnavailable === "gate")
const failingUnder = (pr: PrState, policy: Policy) => failingOf(pr, policy.ciUnavailable === "gate")

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
export function reviewStatusArgs(
  pr: Pick<PrState, "url" | "repo" | "head">,
  description: string,
  state: string = REVIEW_STATE
): string[] {
  const fields = { state, context: REVIEW, target_url: pr.url, description }
  const flags = Object.entries(fields).flatMap(([key, value]) => ["-f", `${key}=${value}`])
  return ["api", `repos/${pr.repo}/statuses/${pr.head}`, "--method", "POST", "--silent", ...flags]
}

/** The success the script marks the head with: the Review it carries, else why its depth is off. */
function scriptMark(pr: PrState, policy: Policy): { carry: string } | { off: string } {
  const call = reviewCall(pr, policy.review, policy.reviewFull)
  if (call.kind === "carry") {
    return { carry: call.from }
  }
  if (call.kind !== "review" || call.depth !== "off") {
    throw new Error(`the script marks ${pr.url} reviewed, neither off nor a carry`)
  }
  return { off: call.why }
}

/** Why the head carries the success the script posts: the Review it carries, else why its depth is off. */
function markedDescription(pr: PrState, policy: Policy): string {
  const mark = scriptMark(pr, policy)
  return "carry" in mark ? `carried from ${mark.carry.slice(0, 7)}` : `${OFF_PREFIX} ${mark.off}`
}

/**
 * What the script records on the head under footprint local, and the command that records it: a carry is a
 * clean Review, as its success reads under github, and an off head `--off`.
 */
export function localMark(pr: PrState, policy: Policy): { mark: "clean" | "off"; command: string } {
  const mark = "carry" in scriptMark(pr, policy) ? "clean" : "off"
  const words = ["dw-sdlc", "pr", "reviewed", String(pr.number), "-R", pr.repo, "--head", pr.head]
  return { mark, command: shellLine(mark === "off" ? [...words, "--off"] : words) }
}

/** The park at the limit: the dev accepts the head as it stands, or names a depth for one more Review. */
function reviewLimit(pr: PrState, { count, since }: ReadMarks): Omit<Answer, "blockers"> {
  const from = since === null ? "the start of the pull request" : `the success on ${since.slice(0, 7)}`
  return {
    status: "park",
    action: "review-limit",
    actor: "dev",
    reason: `${count} Reviews since ${from} left a Finding open: accepting the head is the dev's`,
    command: shellLine(["dw-sdlc", "pr", "reviewed", String(pr.number), "-R", pr.repo, "--head", pr.head, "--accept"])
  }
}

/**
 * The Review a head that awaits one gets: the script posts the success of a carry or under off, the agent
 * reviews at the depth, else it parks at the limit. Auto names the command at any depth, since the agent
 * may raise a routed one to full.
 */
function reviewAnswer(pr: PrState, policy: Policy): Omit<Answer, "blockers"> {
  const head = { status: "act", reason: `no ${REVIEW} success on ${pr.head.slice(0, 7)}` } as const
  const call = reviewCall(pr, policy.review, policy.reviewFull)
  if (call.kind === "carry") {
    return { ...head, action: "mark-reviewed", actor: "script", details: { since: call.from } }
  }
  if (call.kind === "limit") {
    return reviewLimit(pr, call)
  }
  const { depth, source, since, paths, open } = call
  const byScript = depth === "off"
  return {
    ...head,
    action: byScript ? "mark-reviewed" : "review",
    actor: byScript ? "script" : "agent",
    details: {
      depth,
      source,
      ...(depth === "full" || source === "auto" ? { reviewCommand: policy.reviewCommand } : {}),
      ...(since === null ? {} : { since }),
      ...(paths === null ? {} : { paths }),
      ...(open === null ? {} : { open })
    }
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

/**
 * The command a script Action leaves the dev to run, from a checkout of the repository; under footprint
 * local a mark-reviewed records its mark in that checkout.
 */
export function devCommand(pr: PrState, action: ScriptAction, policy: Policy): string {
  if (action === "mark-reviewed" && policy.footprint === "local") {
    return localMark(pr, policy).command
  }
  return shellLine(["gh", ...hostArgs(pr, action, policy, false)])
}

/** The command that runs the Gate and leaves its mark on the head it passed on. */
export const GATE_MARK = shellLine(["dw-sdlc", "gate", "--mark"])

/**
 * CI unavailable under pr.ciUnavailable gate: with gate.steps the agent proves the head with the Gate,
 * else the merge is the dev's, never the script's on a head nothing proved.
 */
function unavailable(pr: PrState, policy: Policy): Omit<Answer, "blockers"> {
  const names = unavailableUnder(pr, policy).map(({ name }) => `${name} ran no step`)
  const reason = `CI unavailable on ${pr.head.slice(0, 7)}: ${namesOf(names)}`
  if (policy.gateSteps) {
    return { status: "act", action: "prove-locally", actor: "agent", reason, command: GATE_MARK }
  }
  return {
    status: "park",
    action: "ci-unavailable",
    actor: "dev",
    reason: `${reason}: no gate.steps to prove it, so the merge is the dev's`,
    command: devCommand(pr, "merge", policy)
  }
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
    // GitHub reports BEHIND only under a rule that a branch be up to date. A branch only behind its base
    // merges as it is: CI ran on its merge with the base as the base stood at that run.
    when: (pr) => pr.mergeStateStatus === "BEHIND",
    answer: (pr) => ({ status: "act", action: "update-branch", actor: "script", reason: `behind ${pr.base}` })
  },
  {
    when: (pr, policy) => failingUnder(pr, policy).length > 0,
    answer: (pr, _, policy) => ({
      status: "act",
      action: "fix-ci",
      actor: "agent",
      reason: `${failingUnder(pr, policy).length} check(s) failing`,
      details: { checks: failingUnder(pr, policy).map(failure) }
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
    // Another author's pull request needs no Review: the dev merges it.
    when: awaitsReview,
    answer: (pr, _, policy) => reviewAnswer(pr, policy)
  },
  {
    // CI unavailable under pr.ciUnavailable gate: a job GitHub never ran, as under a billing lock. A Gate
    // mark on the head stands in for it.
    when: (pr, policy) => !pr.draft && !proven(pr) && unavailableUnder(pr, policy).length > 0,
    answer: (pr, _, policy) => unavailable(pr, policy)
  },
  {
    // A head whose every check was skipped, or that has none, has run nothing. A draft's runs skip or
    // never start until `ready` starts the run, so a draft is no case of it: `mark-ready` is its row.
    when: (pr) => !pr.draft && (ciOf(pr).length === 0 || ciOf(pr).every((check) => check.bucket === "skipping")),
    answer: (pr, now, policy) =>
      now - ciStartOf(pr) <= GRACE_SECONDS * 1000
        ? { status: "wait", action: "wait", actor: "script", reason: "unverified", recheckAfter: 15 }
        : {
            status: "park",
            action: "unverified",
            actor: "dev",
            reason:
              ciOf(pr).length === 0
                ? `no check reported on ${pr.head.slice(0, 7)} within ${GRACE_SECONDS} s of its commit or its ready`
                : `every check on ${pr.head.slice(0, 7)} was skipped, ${GRACE_SECONDS} s after its commit or its ready`,
            command: devCommand(pr, "merge", policy)
          }
  },
  {
    when: (pr) => pendingOf(pr).length > 0,
    answer: (pr, now) => {
      const pending = pendingOf(pr)
      const start = Math.min(
        ...pending.map((check) => (check.startedAt === null ? ciStartOf(pr) : Date.parse(check.startedAt)))
      )
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
