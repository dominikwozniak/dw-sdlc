// The Ship script's seam: a fake `gh` first on PATH, answering from a scenario and logging every call,
// and the builders that turn a compact pull request into the reply `gh api graphql` prints for it.

import { chmodSync, existsSync, readFileSync } from "node:fs"
import { delimiter, join } from "node:path"

import { scratch, write } from "./harness.ts"

/** What one gh call prints and exits with; an empty one prints nothing and exits 0. */
export type Response = { stdout?: string; stderr?: string; exit?: number }
/**
 * The GraphQL replies in the order gh serves them, and every other call's answer by its whole arguments, else
 * its first two words. `backlog` answers the query recap reads its next candidates with, apart from that
 * order: an empty backlog when left out.
 */
export type Scenario = { graphql?: Response[]; commands?: Record<string, Response>; backlog?: Response }

export type FakeGh = {
  /** The environment that puts this gh first on PATH, with no GH_HOST or DW_SDLC_NOW from the machine. */
  env: NodeJS.ProcessEnv
  /** Every call's arguments in order, the GraphQL query's text elided to `query=…`. */
  calls: () => string[][]
}

const quoted = (text: string): string => `'${text.replaceAll("'", `'\\''`)}'`

function answer({ stdout = "", stderr = "", exit = 0 }: Response): string {
  return `printf '%s' ${quoted(stdout)}; printf '%s' ${quoted(stderr)} >&2; exit ${exit}`
}

/** The scenario as a plain sh script, since a test makes many gh calls and each would boot Node. */
function script(dir: string, { graphql = [], commands = {}, backlog = backlogOf([]) }: Scenario): string {
  const replies = graphql.map((response, n) => `    ${n}) ${answer(response)} ;;`).join("\n")
  const arms = Object.entries(commands)
    .map(([key, response]) => `  ${quoted(key)}) ${answer(response)} ;;`)
    .join("\n")
  return `#!/bin/sh
dir=${quoted(dir)}
{ for a in "$@"; do printf '%s\\036' "$a"; done; printf '\\035'; } >>"$dir/calls"
if [ "$1 $2" = "api graphql" ]; then
  case "$4" in "query=query Backlog"*) ${answer(backlog)} ;; esac
  n=0
  while [ -e "$dir/served.$n" ]; do n=$((n + 1)); done
  : >"$dir/served.$n"
  case $n in
${replies}
    *) printf 'fake gh: no GraphQL reply left for call %s\\n' $((n + 1)) >&2; exit 99 ;;
  esac
fi
case "$*" in
${arms}
esac
case "$1 $2" in
${arms}
esac
exit 0
`
}

export function fakeGh(scenario: Scenario): FakeGh {
  const dir = scratch("gh")
  const bin = join(dir, "gh")
  write(bin, script(dir, scenario))
  chmodSync(bin, 0o755)
  const log = join(dir, "calls")
  return {
    env: { PATH: `${dir}${delimiter}${process.env.PATH ?? ""}`, GH_HOST: "", DW_SDLC_NOW: "" },
    calls: () =>
      existsSync(log)
        ? readFileSync(log, "utf8")
            .split("\x1d")
            .filter(Boolean)
            .map((call) =>
              call
                .split("\x1e")
                .slice(0, -1)
                .map((arg) => (arg.startsWith("query=") ? "query=…" : arg))
            )
        : []
  }
}

/** A context on the head: a CheckRun or a StatusContext, `state` its conclusion, status or state word. */
export type Context = {
  kind: "run" | "status"
  name: string
  state: string
  link?: string | null
  startedAt?: string | null
  required?: boolean
}
export type Thread = {
  id: string
  path: string
  line: number | null
  author: string | null
  body: string
  resolved?: boolean
  outdated?: boolean
  /** Whether the viewer wrote the thread's last comment. */
  lastByViewer?: boolean
}
/** A reviewer's latest review: its state, and the commit it read, null for a review of none. */
export type Review = { author: string | null; state: string; commit: string | null }
/** A pull request as a test states it; `checks` empty is a head no check reported on. */
export type Pr = {
  repo: string
  number: number
  state: "OPEN" | "CLOSED" | "MERGED"
  draft: boolean
  mergeable: string
  mergeStateStatus: string
  reviewDecision: string | null
  viewerDidAuthor: boolean
  head: string
  committedAt: string
  /** When it last left draft; never when left out. */
  readyAt?: string
  branch: string
  /** Whether the head branch is gone from the remote, so the reply carries no `headRef`. */
  headDeleted?: boolean
  /** Whether the pull request comes from a fork, so its head branch stands on the fork and not on `origin`. */
  fromFork?: boolean
  base: string
  /** The commit the base branch points at. */
  baseOid: string
  /** The `baseRefOid` GitHub reports, which lags a base that just moved: `baseOid` when left out. */
  reportedBaseOid?: string
  /** Whether the base branch is gone, so the reply carries no `baseRef`. */
  baseDeleted?: boolean
  mergeCommit: string | null
  checks: Context[]
  /** Whether more checks follow `checks` than the one read holds; none when left out. */
  moreChecks?: boolean
  threads: Thread[]
  /** Whether more threads follow `threads` than the one read holds; none when left out. */
  moreThreads?: boolean
  /** Each reviewer's latest review; none when left out. */
  reviews?: Review[]
  /** The pull request's commits before the head, oldest first, each with its dw-sdlc/review state. */
  history: Commit[]
  /** How many parents the head has: 2 for a merge; 1 when left out. */
  headParents?: number
  /** The review status of the head's own commit node, as `history` gives a commit's; none when left out. */
  headReview?: Pick<Commit, "review" | "described">
}

/**
 * A commit of the pull request: `review` null is a commit with statuses but no dw-sdlc/review among
 * them, left out one with none; `described` its description, a clean review's when left out; `parents`
 * 2 is a merge, 1 when left out.
 */
export type Commit = { oid: string; review?: string | null; described?: string; parents?: number }

export const HEAD = "e36732e33915969ef4449becafeecd2e2846d544"
export const BASE_OID = "8ba44d6f750333be72a05ca309e37b5984e3a0b9"
export const RUN = "https://github.com/byarcadia-app/foundation/actions/runs/41116749914/job/124272841543"

/** Open, CI green, the head reviewed, no thread. */
export const GREEN: Pr = {
  repo: "byarcadia-app/foundation",
  number: 40,
  state: "OPEN",
  draft: false,
  mergeable: "MERGEABLE",
  mergeStateStatus: "CLEAN",
  reviewDecision: null,
  viewerDidAuthor: true,
  head: HEAD,
  committedAt: "2026-10-31T11:00:00Z",
  branch: "feat/example",
  base: "main",
  baseOid: BASE_OID,
  mergeCommit: null,
  checks: [
    { kind: "run", name: "Check", state: "SUCCESS", link: RUN, startedAt: "2026-10-31T11:01:00Z" },
    { kind: "status", name: "dw-sdlc/review", state: "SUCCESS", startedAt: "2026-10-31T11:05:00Z" }
  ],
  threads: [],
  history: []
}

/** The words a CheckRun reports as its status while it has no conclusion. */
const RUNNING = new Set(["QUEUED", "IN_PROGRESS", "WAITING", "PENDING", "REQUESTED"])

function contextOf({ kind, name, state, link = null, startedAt = null, required = false }: Context): object {
  if (kind === "status") {
    return { context: name, state, targetUrl: link, createdAt: startedAt ?? GREEN.committedAt, isRequired: required }
  }
  const running = RUNNING.has(state)
  return {
    name,
    status: running ? state : "COMPLETED",
    conclusion: running ? null : state,
    detailsUrl: link,
    startedAt,
    isRequired: required
  }
}

function threadOf(thread: Thread): object {
  const { id, path, line, author, body, resolved = false, outdated = false, lastByViewer = false } = thread
  const comment = { author: author === null ? null : { login: author }, body }
  return {
    id,
    isResolved: resolved,
    isOutdated: outdated,
    path,
    line,
    comments: { nodes: [comment] },
    latest: { nodes: [{ viewerDidAuthor: lastByViewer }] }
  }
}

/** A commit node of the history the reply carries: no status, a status without the review, or the review's state. */
function commitOf({ oid, review, described = "a clean review of this head", parents = 1 }: Commit): object {
  const context = review === null || review === undefined ? null : { state: review, description: described }
  const status = review === undefined ? null : { context }
  return { commit: { oid, parents: { totalCount: parents }, status } }
}

/** The `pullRequest` node of the reply, an object a test may break before serving it. */
export function pullRequestOf(pr: Pr): Record<string, unknown> {
  const rollup =
    pr.checks.length === 0
      ? null
      : { contexts: { pageInfo: { hasNextPage: pr.moreChecks === true }, nodes: pr.checks.map(contextOf) } }
  return {
    url: `https://github.com/${pr.repo}/pull/${pr.number}`,
    number: pr.number,
    state: pr.state,
    isDraft: pr.draft,
    mergeable: pr.mergeable,
    mergeStateStatus: pr.mergeStateStatus,
    reviewDecision: pr.reviewDecision,
    headRefOid: pr.head,
    headRefName: pr.branch,
    headRef: pr.headDeleted === true ? null : { name: pr.branch },
    isCrossRepository: pr.fromFork === true,
    baseRefName: pr.base,
    baseRefOid: pr.reportedBaseOid ?? pr.baseOid,
    baseRef: pr.baseDeleted === true ? null : { target: { oid: pr.baseOid } },
    viewerDidAuthor: pr.viewerDidAuthor,
    mergeCommit: pr.mergeCommit === null ? null : { oid: pr.mergeCommit },
    ready: { nodes: pr.readyAt === undefined ? [] : [{ createdAt: pr.readyAt }] },
    reviewThreads: { pageInfo: { hasNextPage: pr.moreThreads === true }, nodes: pr.threads.map(threadOf) },
    latestReviews: {
      nodes: (pr.reviews ?? []).map(({ author, state, commit }) => ({
        state,
        author: author === null ? null : { login: author },
        commit: commit === null ? null : { oid: commit }
      }))
    },
    commits: { nodes: [{ commit: { committedDate: pr.committedAt, statusCheckRollup: rollup } }] },
    history: { nodes: [...pr.history, { oid: pr.head, parents: pr.headParents ?? 1, ...pr.headReview }].map(commitOf) }
  }
}

/** The response of `gh api graphql` whose reply holds `pullRequest`. */
export function reply(pullRequest: Record<string, unknown>): Response {
  return { stdout: JSON.stringify({ data: { repository: { pullRequest } } }) }
}

/** The response of `gh api graphql` for `pr`, as GitHub reports it. */
export function served(pr: Pr): Response {
  return reply(pullRequestOf(pr))
}

/** An open issue labelled for an agent, as a test states it: no assignee, no open blocker and no parent when left out. */
export type Issue = { number: number; title?: string; assignees?: number; blockedBy?: number; parent?: number }

/**
 * The response of the backlog query: the issues in order, and the issues the pull request closes, which the
 * reply carries only when the query asks for the pull request and the command reads only then.
 */
export function backlogOf(issues: Issue[], closes: number[] = []): Response {
  const nodes = issues.map(({ number, title = `issue ${number}`, assignees = 0, blockedBy = 0, parent }) => ({
    number,
    title,
    url: `https://github.com/byarcadia-app/foundation/issues/${number}`,
    assignees: { totalCount: assignees },
    issueDependenciesSummary: { blockedBy },
    parent: parent === undefined ? null : { number: parent }
  }))
  const pullRequest = { closingIssuesReferences: { nodes: closes.map((number) => ({ number })) } }
  return { stdout: JSON.stringify({ data: { repository: { pullRequest, issues: { nodes } } } }) }
}
