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
  limitedOf,
  pendingOf,
  pendingStartOf,
  proven,
  recheckOf,
  redChecksOf,
  redHeadsOf,
  unavailableOf
} from "./ci.ts"
import type { PrState, Thread } from "./state.ts"

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
  | "unverified"
  | "prove-locally"
  | "ci-unavailable"
  | "ci-stuck"
  | "ci-limit"
  | "awaiting-reply"
  | "awaiting-review"
  | "mark-ready"
  | "awaiting-author"
  | "awaiting-approval"
  | "partial-read"
  | "ready-to-merge"
  | "wrong-checkout"
  | "merge"
/** The Actions the script performs itself, each one gh command. */
export type ScriptAction = "update-branch" | "mark-ready" | "merge"
/**
 * What the decision reads beside the pull request: who merges it, where the Gate mark lives, whether a
 * Gate mark stands in for CI unavailable, and whether `gate.steps` declares a Gate to leave one.
 */
export type Policy = {
  merge: PrMerge
  footprint: Footprint
  ciUnavailable: PrCiUnavailable
  gateSteps: boolean
}
/** The policy a repository declares in its `pr` key and `footprint`; a flag for one call goes over it. */
export function declaredPolicy({ pr, footprint, gate }: Pick<ResolvedConfig, "pr" | "footprint" | "gate">): Policy {
  const { merge, ciUnavailable } = pr
  return { merge, footprint, ciUnavailable, gateSteps: gate.steps.length > 0 }
}

/**
 * One step of an answer's `next`, the agent's or the dev's. `run` is an exact command: for the agent a
 * shell command, for the dev what they type, shell or a slash command. `do` is one line of judgement,
 * carried out on the answer's `details`.
 */
export type Step = { by: "agent" | "dev"; run: string } | { by: "agent" | "dev"; do: string }

/** An Action the pull request needs beside the one its answer names, so one push can fix several. */
export type Blocker = {
  action: Action
  actor: Actor
  reason: string
  details?: Record<string, unknown>
  /** The steps, in order, that answer this Action; empty when the next move is nobody's to run. */
  next: Step[]
}
export type Answer = Blocker & {
  status: Status
  /** Seconds to wait before calling again. */
  recheckAfter?: number
  blockers: Blocker[]
}

type Row = {
  when: (pr: PrState, policy: Policy) => boolean
  answer: (pr: PrState, now: number, policy: Policy, asBlocker: boolean) => Omit<Answer, "blockers">
  /** A row that wins answers with no blockers: a merged, closed or still-computing pull request. */
  alone?: true
  /** A row that never rides in blockers: who merges is no blocker. */
  merging?: true
}

/** Whether a Gate mark may stand in for CI unavailable: under pr.ciUnavailable ci those checks fail. */
const markStandsIn = ({ ciUnavailable }: Policy) => ciUnavailable === "gate"
/** The checks CI unavailable leaves to a Gate mark: none under pr.ciUnavailable ci. */
const unavailableUnder = (pr: PrState, policy: Policy) => unavailableOf(pr, markStandsIn(policy))
const failingUnder = (pr: PrState, policy: Policy) => failingOf(pr, markStandsIn(policy))
/** Whether the head is the third in a row with failing CI, where the agent's fixes stop. */
const limited = (pr: PrState, policy: Policy) => limitedOf(pr, markStandsIn(policy))

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

const RESOLVE_THREAD = "mutation($id:ID!){resolveReviewThread(input:{threadId:$id}){thread{id}}}"
const REPLY_TO_THREAD =
  "mutation($id:ID!,$body:String!){addPullRequestReviewThreadReply(input:{pullRequestReviewThreadId:$id,body:$body}){comment{id}}}"

/** The gh call that runs `mutation` on a thread; `more` is appended as it stands. */
function graphql(mutation: string, id: string, more = ""): string {
  return `gh api graphql -f query=${shellLine([mutation])} -f id=${shellLine([id])}${more}`
}

function listed({ id, path, line, author, body }: Thread): Record<string, unknown> {
  return { id, path, line, author, body }
}

/** A thread the agent answers: with the command that resolves it and the one that replies, `<text>` its only blank. */
function answerable(thread: Thread): Record<string, unknown> {
  return {
    ...listed(thread),
    resolve: graphql(RESOLVE_THREAD, thread.id),
    reply: graphql(REPLY_TO_THREAD, thread.id, " -f body=<text>")
  }
}

const agent = (run: string): Step => ({ by: "agent", run })
const agentDo = (line: string): Step => ({ by: "agent", do: line })
const dev = (run: string): Step => ({ by: "dev", run })

/** A script Action's gh arguments; `repo` is `-R` and the repository when the call names it, else empty. */
const HOST: Record<ScriptAction, (pr: PrState, repo: string[]) => string[]> = {
  "update-branch": (pr, repo) => ["pr", "update-branch", String(pr.number), ...repo],
  "mark-ready": (pr, repo) => ["pr", "ready", String(pr.number), ...repo],
  merge: (pr, repo) => ["pr", "merge", String(pr.number), ...repo, "--squash", "--match-head-commit", pr.head]
}

export function isScriptAction(action: Action): action is ScriptAction {
  return Object.hasOwn(HOST, action)
}

/**
 * The gh arguments of a script Action, `-R` naming the repository when `named`. The update merges the
 * base in, never --rebase, which rewrites the branch on GitHub; the merge names the head it read.
 */
export function hostArgs(pr: PrState, action: ScriptAction, named: boolean): string[] {
  return HOST[action](pr, named ? ["-R", pr.repo] : [])
}

/** The command a script Action leaves the dev to run, from a checkout of the repository. */
export function devCommand(pr: PrState, action: ScriptAction): string {
  return shellLine(["gh", ...hostArgs(pr, action, false)])
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
    return {
      status: "act",
      action: "prove-locally",
      actor: "agent",
      reason,
      next: [agent(GATE_MARK), agentDo("red: fix what it printed, then git push")]
    }
  }
  return {
    status: "park",
    action: "ci-unavailable",
    actor: "dev",
    reason: `${reason}: no gate.steps to prove it, so the merge is the dev's`,
    next: [dev(devCommand(pr, "merge"))]
  }
}

/** The merge left to the dev, `reason` saying why it is theirs. */
export function readyToMerge(pr: PrState, reason: string): Omit<Answer, "blockers"> {
  return { status: "park", action: "ready-to-merge", actor: "dev", reason, next: [dev(devCommand(pr, "merge"))] }
}

const ROWS: Row[] = [
  {
    when: (pr) => pr.state === "MERGED",
    answer: (pr) => ({
      status: "done",
      action: "done",
      actor: "dev",
      reason: pr.mergeCommit === null ? "merged" : `merged as ${pr.mergeCommit.slice(0, 7)}`,
      next: pr.branchStands && !pr.fromFork ? [dev(shellLine(["git", "push", "origin", "--delete", pr.branch]))] : [],
      ...(pr.mergeCommit === null ? {} : { details: { mergeCommit: pr.mergeCommit } })
    }),
    alone: true
  },
  {
    when: (pr) => pr.state === "CLOSED",
    answer: () => ({ status: "park", action: "stop", actor: "dev", reason: "closed without merging", next: [] }),
    alone: true
  },
  {
    when: (pr) => pr.mergeable === "UNKNOWN",
    answer: () => ({
      status: "wait",
      action: "wait",
      actor: "script",
      reason: "mergeability-unknown",
      recheckAfter: 15,
      next: []
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
      details: { base: pr.base },
      next: [
        agent(
          `${shellLine(["git", "fetch", "origin", pr.base])} && ${shellLine(["git", "rebase", `origin/${pr.base}`])}`
        ),
        agentDo(
          "resolve each conflict keeping both sides' intent, git rebase --continue, then git push --force-with-lease"
        )
      ]
    })
  },
  {
    // GitHub reports BEHIND only under a rule that a branch be up to date. A branch only behind its base
    // merges as it is: CI ran on its merge with the base as the base stood at that run.
    when: (pr) => pr.mergeStateStatus === "BEHIND",
    answer: (pr) => ({
      status: "act",
      action: "update-branch",
      actor: "script",
      reason: `behind ${pr.base}`,
      next: []
    })
  },
  {
    // Before fix-ci: the third red head in a row is the dev's. The fix-ci and unavailable rows hold
    // `!limited` so this row's Action never rides in their blockers, nor theirs in its own.
    when: (pr, policy) => limited(pr, policy),
    answer: (pr, _, policy) => {
      const checks = redChecksOf(pr, markStandsIn(policy))
      return {
        status: "park",
        action: "ci-limit",
        actor: "dev",
        reason: `CI failed on ${redHeadsOf(pr, markStandsIn(policy))} heads in a row, the CI limit: ${namesOf(checks.map(({ name }) => name))} on ${pr.head.slice(0, 7)}`,
        details: { checks: checks.map(failure) },
        next: [
          { by: "dev", do: "fix the failing checks under details.checks yourself, then push" },
          { by: "dev", do: 'say "merge without CI" to merge on a Gate mark, past the failing CI' }
        ]
      }
    }
  },
  {
    when: (pr, policy) => !limited(pr, policy) && failingUnder(pr, policy).length > 0,
    answer: (pr, _, policy, asBlocker) => ({
      status: "act",
      action: "fix-ci",
      actor: "agent",
      reason: `${failingUnder(pr, policy).length} check(s) failing`,
      details: { checks: failingUnder(pr, policy).map(failure) },
      next: [
        agentDo(
          `read each failing check's log under details.checks, fix the cause, ${asBlocker ? "in the same push" : "then git push"}`
        )
      ]
    })
  },
  {
    when: (pr) => threads(pr, false).length > 0,
    answer: (pr) => ({
      status: "act",
      action: "address-review",
      actor: "agent",
      reason: `${threads(pr, false).length} unresolved thread(s)`,
      details: { threads: threads(pr, false).map(answerable) },
      next: [
        agentDo(
          "triage each thread under details.threads against the code: fix it and run its resolve, or run its reply with why and leave it open; git push when code changed"
        )
      ]
    })
  },
  {
    when: (pr) => pr.reviewDecision === "CHANGES_REQUESTED" && !reviewAnswered(pr),
    answer: (pr) => ({
      status: "act",
      action: "address-review",
      actor: "agent",
      reason: "changes requested",
      next: [
        agent(shellLine(["gh", "pr", "view", String(pr.number), "-R", pr.repo, "--json", "reviews"])),
        agentDo(
          "answer the review asking for changes with a push; with nothing to change it is the reviewer's turn: say so and stop"
        )
      ]
    })
  },
  {
    // CI unavailable under pr.ciUnavailable gate: a job GitHub never ran, as under a billing lock. A Gate
    // mark on the head stands in for it.
    when: (pr, policy) => !pr.draft && !proven(pr) && !limited(pr, policy) && unavailableUnder(pr, policy).length > 0,
    answer: (pr, _, policy) => unavailable(pr, policy)
  },
  {
    // A head whose every check was skipped, or that has none, has run nothing. A draft's runs skip or
    // never start until `ready` starts the run, so a draft is no case of it: `mark-ready` is its row.
    when: (pr) => !pr.draft && (ciOf(pr).length === 0 || ciOf(pr).every((check) => check.bucket === "skipping")),
    answer: (pr, now) =>
      now - ciStartOf(pr) <= GRACE_SECONDS * 1000
        ? { status: "wait", action: "wait", actor: "script", reason: "unverified", recheckAfter: 15, next: [] }
        : {
            status: "park",
            action: "unverified",
            actor: "dev",
            reason:
              ciOf(pr).length === 0
                ? `no check reported on ${pr.head.slice(0, 7)} within ${GRACE_SECONDS} s of its commit or its ready`
                : `every check on ${pr.head.slice(0, 7)} was skipped, ${GRACE_SECONDS} s after its commit or its ready`,
            next: [dev(devCommand(pr, "merge"))]
          }
  },
  {
    when: (pr) => pendingOf(pr).length > 0,
    answer: (pr, now) => {
      const pending = pendingOf(pr)
      const start = pendingStartOf(pr)
      const minutes = Math.floor((now - start) / 60_000)
      return now - start <= BUDGET_MINUTES * 60_000
        ? {
            status: "wait",
            action: "wait",
            actor: "script",
            reason: "ci-pending",
            recheckAfter: recheckOf(pr, now),
            next: []
          }
        : {
            status: "park",
            action: "ci-stuck",
            actor: "dev",
            reason: `${pending.length} check(s) pending for ${minutes} min, past the ${BUDGET_MINUTES} min budget`,
            next: []
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
      details: { threads: threads(pr, true).map(listed) },
      next: []
    })
  },
  {
    // After awaiting-reply, so CI runs first and the reviewer gets a verified fix. Only the reviewer can act: their review stands until they review again or dismiss it.
    when: reviewAnswered,
    answer: (pr) => ({
      status: "park",
      action: "awaiting-review",
      actor: "dev",
      reason: `changes requested by ${namesOf(pr.changeRequests.map(({ reviewer }) => reviewer))}, answered by a push: the next review is the reviewer's`,
      next: []
    })
  },
  {
    when: (pr) => pr.draft && pr.viewerDidAuthor,
    answer: () => ({ status: "act", action: "mark-ready", actor: "script", reason: "still a draft", next: [] })
  },
  {
    when: (pr) => pr.draft && !pr.viewerDidAuthor,
    answer: () => ({
      status: "park",
      action: "awaiting-author",
      actor: "dev",
      reason: "another author's draft: marking it ready is the author's",
      next: []
    })
  },
  {
    when: (pr) => pr.reviewDecision === "REVIEW_REQUIRED",
    answer: () => ({
      status: "park",
      action: "awaiting-approval",
      actor: "dev",
      reason: "an approving review is required",
      next: []
    })
  },
  {
    // A failure or an open thread past what the read holds shows in no row above.
    when: (pr) => pr.cutOff.length > 0,
    answer: (pr) => ({
      status: "park",
      action: "partial-read",
      actor: "dev",
      reason: `the read holds only ${pr.cutOff.join(" and ")}: the merge is the dev's`,
      next: [dev(devCommand(pr, "merge"))]
    })
  },
  {
    when: (pr) => !pr.viewerDidAuthor,
    answer: (pr) => readyToMerge(pr, "another author's pull request: the merge is the dev's"),
    merging: true
  },
  {
    when: (_, { merge }) => merge === "auto",
    answer: () => ({
      status: "act",
      action: "merge",
      actor: "script",
      reason: "green, no open thread or change request, and the viewer's own",
      next: []
    }),
    merging: true
  },
  {
    when: (_, { merge }) => merge === "ask",
    answer: (pr) => readyToMerge(pr, "pr.merge is ask: the merge is the dev's"),
    merging: true
  }
]

/** `<status> <action>`, the action dropped when it repeats the status. */
export function labelOf({ status, action }: Pick<Answer, "status" | "action">): string {
  return status === action ? status : `${status} ${action}`
}

/** The label and the reason, then the recheck and each step of `next` in order, marked agent or dev. */
export function lineOf(answer: Answer): string {
  const { reason, next, recheckAfter } = answer
  const recheck = recheckAfter === undefined ? "" : `, recheck in ${recheckAfter} s`
  const steps = next.map((step) => ` — ${step.by}: ${"run" in step ? step.run : step.do}`).join("")
  return `${labelOf(answer)}: ${reason}${recheck}${steps}`
}

function blockerOf({ action, actor, reason, details, next }: Omit<Answer, "blockers">): Blocker {
  return { action, actor, reason, ...(details === undefined ? {} : { details }), next }
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
    ...row.answer(pr, now, policy, false),
    blockers: later.map((other) => blockerOf(other.answer(pr, now, policy, true)))
  }
}
