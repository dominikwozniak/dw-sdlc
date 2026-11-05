// The Ship script's seam: a fake `gh` first on PATH, answering from a scenario and logging every call,
// and the builders that turn a compact pull request into the reply `gh api graphql` prints for it.

import { chmodSync, existsSync, readFileSync } from "node:fs"
import { delimiter, join } from "node:path"

import { lines, scratch, write, writeJson } from "./harness.ts"

const FAKE = join(import.meta.dirname, "fake-gh.ts")

/** What one gh call prints and exits with; an empty one prints nothing and exits 0. */
export type Response = { stdout?: string; stderr?: string; exit?: number }
/** The GraphQL replies in the order gh serves them, and every other call's answer by its first two words. */
export type Scenario = { graphql?: Response[]; commands?: Record<string, Response> }

export type FakeGh = {
  /** The environment that puts this gh first on PATH, with no GH_HOST or DW_SDLC_NOW from the machine. */
  env: NodeJS.ProcessEnv
  /** Every call's arguments in order, the GraphQL query's text elided to `query=…`. */
  calls: () => string[][]
}

export function fakeGh(scenario: Scenario): FakeGh {
  const dir = scratch("gh")
  writeJson(join(dir, "scenario.json"), scenario)
  const bin = join(dir, "gh")
  write(bin, `#!/bin/sh\nexec "${process.execPath}" "${FAKE}" "${dir}" "$@"\n`)
  chmodSync(bin, 0o755)
  const log = join(dir, "calls.jsonl")
  return {
    env: { PATH: `${dir}${delimiter}${process.env.PATH ?? ""}`, GH_HOST: "", DW_SDLC_NOW: "" },
    calls: () =>
      existsSync(log)
        ? lines(readFileSync(log, "utf8")).map((line) =>
            (JSON.parse(line) as string[]).map((arg) => (arg.startsWith("query=") ? "query=…" : arg))
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
  branch: string
  base: string
  /** The commit the base branch points at. */
  baseOid: string
  mergeCommit: string | null
  checks: Context[]
  threads: Thread[]
  /** The pull request's commits before the head, oldest first, each with its dw-sdlc/review state. */
  history: Commit[]
  /** How many parents the head has: 2 for a merge; 1 when left out. */
  headParents?: number
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
  const rollup = pr.checks.length === 0 ? null : { contexts: { nodes: pr.checks.map(contextOf) } }
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
    baseRefName: pr.base,
    baseRefOid: pr.baseOid,
    viewerDidAuthor: pr.viewerDidAuthor,
    mergeCommit: pr.mergeCommit === null ? null : { oid: pr.mergeCommit },
    reviewThreads: { nodes: pr.threads.map(threadOf) },
    commits: { nodes: [{ commit: { committedDate: pr.committedAt, statusCheckRollup: rollup } }] },
    history: { nodes: [...pr.history, { oid: pr.head, parents: pr.headParents ?? 1 }].map(commitOf) }
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
