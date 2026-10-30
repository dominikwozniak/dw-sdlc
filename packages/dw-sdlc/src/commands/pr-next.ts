// PROTOTYPE (wayfinder #146): `dw-sdlc pr next --pr <n> [-R owner/name]`. Reads one PR through one
// `gh api graphql` call, decides the next step in kcd's order and prints it as JSON. Performs nothing.

import { execFileSync } from "node:child_process"
import { parseArgs } from "node:util"

export const summary = "PROTOTYPE: print the next step for one open pull request, perform nothing"

const QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      url state isDraft mergeable mergeStateStatus reviewDecision headRefOid headRefName
      autoMergeRequest { enabledAt mergeMethod }
      reviewThreads(first: 100) { totalCount nodes { id isResolved isOutdated path line
        comments(first: 1) { nodes { author { login } body } } } }
      commits(last: 1) { nodes { commit { statusCheckRollup { state
        contexts(first: 50) { nodes { __typename
          ... on CheckRun { name status conclusion detailsUrl isRequired(pullRequestNumber: $number) }
          ... on StatusContext { context state targetUrl isRequired(pullRequestNumber: $number) } } } } } } }
    }
  }
}`

type Bucket = "pass" | "fail" | "pending" | "skipping"
type Check = { name: string; bucket: Bucket; required: boolean; link: string | null }
type Thread = { id: string; path: string; line: number | null; author: string; body: string }

export type PrState = {
  url: string
  state: "OPEN" | "CLOSED" | "MERGED"
  draft: boolean
  mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN"
  mergeStateStatus: string
  reviewDecision: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null
  head: string
  branch: string
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

// The stub trusts gh's shape; the real command parses it.
// oxlint-disable-next-line typescript/no-explicit-any -- prototype: unparsed gh JSON
function normalise(pr: any): PrState {
  const rollup = pr.commits.nodes[0]?.commit.statusCheckRollup ?? null
  // oxlint-disable-next-line typescript/no-explicit-any -- prototype
  const checks: Check[] = (rollup?.contexts.nodes ?? []).map((node: any) =>
    node.__typename === "CheckRun"
      ? { name: node.name, bucket: bucketOf(node.status, node.conclusion), required: node.isRequired, link: node.detailsUrl }
      : { name: node.context, bucket: bucketOf(undefined, node.state), required: node.isRequired, link: node.targetUrl }
  )
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
    state: pr.state,
    draft: pr.isDraft,
    mergeable: pr.mergeable,
    mergeStateStatus: pr.mergeStateStatus,
    reviewDecision: pr.reviewDecision,
    head: pr.headRefOid,
    branch: pr.headRefName,
    rollup: rollup?.state ?? null,
    checks,
    unresolvedThreads
  }
}

/** kcd's order, minus risk tiers and reviewers; `pr.merge` is `ask` until the contract says otherwise. */
export function decide(pr: PrState, merge: "auto" | "ask" = "ask"): Step {
  if (pr.state === "MERGED") {
    return { status: "done", step: "done", actor: "script", reason: "merged", next: `the dev deletes branch ${pr.branch}` }
  }
  if (pr.state === "CLOSED") {
    return { status: "parked", step: "stop", actor: "dev", reason: "closed without merging" }
  }
  if (pr.draft) {
    return { status: "action", step: "mark-ready", actor: "script", reason: "draft", command: ["gh", "pr", "ready", pr.url] }
  }
  if (pr.mergeable === "UNKNOWN") {
    return { status: "waiting", step: "wait", actor: "script", reason: "GitHub is still computing mergeability" }
  }
  if (pr.mergeable === "CONFLICTING") {
    return { status: "action", step: "fix-conflicts", actor: "agent", reason: "conflicts with the base" }
  }
  if (pr.mergeStateStatus === "BEHIND") {
    return {
      status: "action",
      step: "update-branch",
      actor: "script",
      reason: "behind the base",
      command: ["gh", "pr", "update-branch", pr.url],
      next: "wait: the update starts a new CI run"
    }
  }
  const failing = pr.checks.filter((check) => check.bucket === "fail")
  if (failing.length > 0) {
    return { status: "action", step: "fix-ci", actor: "agent", reason: `${failing.length} check(s) failing`, details: failing }
  }
  const pending = pr.checks.filter((check) => check.bucket === "pending")
  if (pending.length > 0) {
    return { status: "waiting", step: "wait", actor: "script", reason: `${pending.length} check(s) running`, details: pending }
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
  if (pr.reviewDecision === "REVIEW_REQUIRED") {
    return { status: "waiting", step: "wait-for-review", actor: "dev", reason: "the base requires an approving review" }
  }
  const command = ["gh", "pr", "merge", pr.url, "--squash", "--match-head-commit", pr.head]
  return merge === "auto"
    ? { status: "action", step: "merge", actor: "script", reason: "every gate passed", command }
    : { status: "parked", step: "ready-to-merge", actor: "dev", reason: "every gate passed; pr.merge is ask", command }
}

export async function run(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: { pr: { type: "string" }, repo: { type: "string", short: "R" }, json: { type: "boolean" } }
  })
  if (values.pr === undefined) {
    process.stderr.write("Usage: dw-sdlc pr next --pr <n> [-R owner/name] [--json]\n")
    return 2
  }
  const repo =
    values.repo ?? execFileSync("gh", ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"], { encoding: "utf8" }).trim()
  const [owner, name] = repo.split("/")
  const raw = execFileSync(
    "gh",
    ["api", "graphql", "-f", `query=${QUERY}`, "-F", `owner=${owner}`, "-F", `name=${name}`, "-F", `number=${values.pr}`],
    { encoding: "utf8" }
  )
  const state = normalise(JSON.parse(raw).data.repository.pullRequest)
  const step = decide(state)
  process.stdout.write(`${JSON.stringify({ pr: state.url, head: state.head, ...step, facts: state }, null, 2)}\n`)
  return step.status === "done" ? 0 : step.status === "waiting" ? 20 : step.status === "parked" ? 30 : 10
}
