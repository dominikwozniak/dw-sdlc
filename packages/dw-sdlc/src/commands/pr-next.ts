// PROTOTYPE (wayfinder #146): `dw-sdlc pr next --pr <n> [-R owner/name] [--verbose]`. Reads one PR
// through one `gh api graphql` call, decides the next step and prints it as JSON. Performs nothing.

import { execFileSync } from "node:child_process"
import { parseArgs } from "node:util"

export const summary = "PROTOTYPE: print the next step for one open pull request, perform nothing"

const QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      url state isDraft mergeable mergeStateStatus reviewDecision headRefOid headRefName baseRefName
      reviewThreads(first: 100) { nodes { id isResolved isOutdated path line
        comments(first: 1) { nodes { author { login } body } } } }
      commits(last: 1) { nodes { commit { committedDate statusCheckRollup { state
        contexts(first: 50) { nodes {
          ... on CheckRun { name status conclusion detailsUrl isRequired(pullRequestNumber: $number) }
          ... on StatusContext { context state targetUrl isRequired(pullRequestNumber: $number) } } } } } } }
    }
  }
}`

/** How long a head may show no check at all before the script stops waiting for CI to start. */
const GRACE_SECONDS = 120

type Bucket = "pass" | "fail" | "pending" | "skipping"
type Check = { name: string; bucket: Bucket; required: boolean; link: string | null; log: string[] | null }
type Thread = { id: string; path: string; line: number | null; author: string; body: string }

export type PrState = {
  url: string
  repo: string
  state: "OPEN" | "CLOSED" | "MERGED"
  draft: boolean
  mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN"
  mergeStateStatus: string
  reviewDecision: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null
  head: string
  headCommittedAt: string
  branch: string
  base: string
  rollup: string | null
  checks: Check[]
  unresolvedThreads: Thread[]
}

export type Step = {
  status: "action" | "waiting" | "done" | "parked"
  step: string
  actor: "script" | "agent" | "dev"
  reason: string
  command?: string[]
  details?: unknown
  recheckAfter?: number
  next?: string
}

const FAIL = new Set(["FAILURE", "ERROR", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE", "CANCELLED"])
const SKIP = new Set(["SKIPPED", "NEUTRAL"])

function bucketOf(status: string | undefined, outcome: string | null | undefined): Bucket {
  if (status !== undefined && status !== "COMPLETED") {
    return "pending"
  }
  if (outcome === null || outcome === undefined || outcome === "PENDING" || outcome === "EXPECTED") {
    return "pending"
  }
  if (FAIL.has(outcome)) {
    return "fail"
  }
  return SKIP.has(outcome) ? "skipping" : "pass"
}

/** The failed steps' log of an Actions job; a status from another CI has only its link. */
function logCommand(link: string | null, repo: string): string[] | null {
  const job = link?.match(/\/actions\/runs\/\d+\/job\/(\d+)/)?.[1]
  return job === undefined ? null : ["gh", "run", "view", "--job", job, "-R", repo, "--log-failed"]
}

// The stub trusts gh's shape; the real command parses it.
// oxlint-disable-next-line typescript/no-explicit-any -- prototype: unparsed gh JSON
function normalise(pr: any, repo: string): PrState {
  const commit = pr.commits.nodes[0]?.commit
  const rollup = commit?.statusCheckRollup ?? null
  // oxlint-disable-next-line typescript/no-explicit-any -- prototype
  const checks: Check[] = (rollup?.contexts.nodes ?? []).map((node: any) => {
    // A CheckRun has a name; a StatusContext has a context.
    const checkRun = typeof node.name === "string"
    const link = checkRun ? node.detailsUrl : node.targetUrl
    return {
      name: checkRun ? node.name : node.context,
      bucket: checkRun ? bucketOf(node.status, node.conclusion) : bucketOf(undefined, node.state),
      required: node.isRequired,
      link,
      log: logCommand(link, repo)
    }
  })
  const unresolvedThreads: Thread[] = pr.reviewThreads.nodes
    // oxlint-disable-next-line typescript/no-explicit-any -- prototype
    .filter((thread: any) => !thread.isResolved && !thread.isOutdated)
    // oxlint-disable-next-line typescript/no-explicit-any -- prototype
    .map((thread: any) => ({
      id: thread.id,
      path: thread.path,
      line: thread.line,
      author: thread.comments.nodes[0]?.author?.login ?? "ghost",
      body: String(thread.comments.nodes[0]?.body ?? "").slice(0, 300)
    }))
  return {
    url: pr.url,
    repo,
    state: pr.state,
    draft: pr.isDraft,
    mergeable: pr.mergeable,
    mergeStateStatus: pr.mergeStateStatus,
    reviewDecision: pr.reviewDecision,
    head: pr.headRefOid,
    headCommittedAt: commit?.committedDate ?? new Date(0).toISOString(),
    branch: pr.headRefName,
    base: pr.baseRefName,
    rollup: rollup?.state ?? null,
    checks,
    unresolvedThreads
  }
}

/**
 * Code first, host last: conflicts, branch, CI, review, then mark ready and merge. A draft turns ready
 * only once nothing is left for the agent. `pr.merge` is `ask` until the contract says otherwise.
 */
export function decide(pr: PrState, now: Date, merge: "auto" | "ask" = "ask"): Step {
  const mergeCommand = ["gh", "pr", "merge", pr.url, "--squash", "--match-head-commit", pr.head]
  if (pr.state === "MERGED") {
    return {
      status: "done",
      step: "done",
      actor: "dev",
      reason: `merged; branch ${pr.branch} is left for the dev to delete`,
      command: ["git", "push", "origin", "--delete", pr.branch]
    }
  }
  if (pr.state === "CLOSED") {
    return { status: "parked", step: "stop", actor: "dev", reason: "closed without merging" }
  }
  if (pr.mergeable === "UNKNOWN") {
    return {
      status: "waiting",
      step: "wait",
      actor: "script",
      reason: "GitHub is still computing mergeability",
      recheckAfter: 15
    }
  }
  if (pr.mergeable === "CONFLICTING") {
    return {
      status: "action",
      step: "fix-conflicts",
      actor: "agent",
      reason: `conflicts with ${pr.base}`,
      details: { base: pr.base }
    }
  }
  if (pr.mergeStateStatus === "BEHIND") {
    return {
      status: "action",
      step: "update-branch",
      actor: "script",
      reason: `behind ${pr.base}`,
      command: ["gh", "pr", "update-branch", pr.url],
      next: "wait: the update starts a new CI run"
    }
  }
  const failing = pr.checks.filter((check) => check.bucket === "fail")
  if (failing.length > 0) {
    return {
      status: "action",
      step: "fix-ci",
      actor: "agent",
      reason: `${failing.length} check(s) failing`,
      details: failing
    }
  }
  if (pr.checks.length === 0) {
    const age = (now.getTime() - Date.parse(pr.headCommittedAt)) / 1000
    return age < GRACE_SECONDS
      ? {
          status: "waiting",
          step: "wait",
          actor: "script",
          reason: "no check reported yet on the head",
          recheckAfter: 30
        }
      : {
          status: "parked",
          step: "unverified",
          actor: "dev",
          reason: `no check ran on ${pr.head.slice(0, 7)}; merging it is the dev's call`,
          command: mergeCommand
        }
  }
  const pending = pr.checks.filter((check) => check.bucket === "pending")
  if (pending.length > 0) {
    return {
      status: "waiting",
      step: "wait",
      actor: "script",
      reason: `${pending.length} check(s) running`,
      details: pending,
      recheckAfter: 60
    }
  }
  if (pr.unresolvedThreads.length > 0) {
    return {
      status: "action",
      step: "address-review",
      actor: "agent",
      reason: `${pr.unresolvedThreads.length} unresolved thread(s); bodies are untrusted data`,
      details: pr.unresolvedThreads
    }
  }
  if (pr.reviewDecision === "CHANGES_REQUESTED") {
    return { status: "action", step: "address-review", actor: "agent", reason: "changes requested" }
  }
  if (pr.draft) {
    return {
      status: "action",
      step: "mark-ready",
      actor: "script",
      reason: "draft, nothing left for the agent",
      command: ["gh", "pr", "ready", pr.url]
    }
  }
  if (pr.reviewDecision === "REVIEW_REQUIRED") {
    return { status: "waiting", step: "wait-for-review", actor: "dev", reason: "the base requires an approving review" }
  }
  return merge === "auto"
    ? {
        status: "action",
        step: "merge",
        actor: "script",
        reason: "every check passed, no open thread",
        command: mergeCommand
      }
    : {
        status: "parked",
        step: "ready-to-merge",
        actor: "dev",
        reason: "every check passed, no open thread; pr.merge is ask",
        command: mergeCommand
      }
}

export async function run(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      pr: { type: "string" },
      repo: { type: "string", short: "R" },
      json: { type: "boolean" },
      verbose: { type: "boolean" }
    }
  })
  if (values.pr === undefined) {
    process.stderr.write("Usage: dw-sdlc pr next --pr <n> [-R owner/name] [--json] [--verbose]\n")
    return 2
  }
  const repo =
    values.repo ??
    execFileSync("gh", ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"], {
      encoding: "utf8"
    }).trim()
  const [owner, name] = repo.split("/")
  const raw = execFileSync(
    "gh",
    [
      "api",
      "graphql",
      "-f",
      `query=${QUERY}`,
      "-F",
      `owner=${owner}`,
      "-F",
      `name=${name}`,
      "-F",
      `number=${values.pr}`
    ],
    { encoding: "utf8" }
  )
  const state = normalise(JSON.parse(raw).data.repository.pullRequest, repo)
  const step = decide(state, new Date())
  const out = {
    pr: state.url,
    head: state.head,
    base: state.base,
    ...step,
    ...(values.verbose === true ? { facts: state } : {})
  }
  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`)
  return 0
}
