// The candidates for the session after this one, as `dw-sdlc recap` reads them: the open issues an agent may
// start, from one GraphQL request that also asks which issues the branch's pull request closes.

import { CannotRun } from "./cannot-run.ts"
import { gh, said } from "./pr/read.ts"
import { child, childOrNull, integer, type Node, nodes, ReplyError, rootOf, string } from "./pr/reply.ts"

/** The label that marks an issue as ready for an agent to start. */
export const READY_LABEL = "ready-for-agent"
/** How many open issues the one read holds, oldest first, and how many issues the pull request closes. */
const ISSUES_READ = 100
const CLOSING_READ = 25

const QUERY = `query Backlog($owner: String!, $name: String!, $number: Int!, $closing: Boolean!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) @include(if: $closing) { closingIssuesReferences(first: ${CLOSING_READ}) { nodes { number } } }
    issues(first: ${ISSUES_READ}, states: OPEN, labels: ["${READY_LABEL}"], orderBy: { field: CREATED_AT, direction: ASC }) {
      nodes { number title url assignees { totalCount } issueDependenciesSummary { blockedBy } parent { number } }
    }
  }
}`

/** An issue the next session may start; `parent` the issue it is a sub-issue of, null for none. */
export type Candidate = { number: number; title: string; url: string; parent: number | null }

const REMEDY = "check gh auth status and the network, then call again"
const UNREAD_SHAPE = "gh answered a shape dw-sdlc does not read; report it with the output of gh --version"

/** An issue node as a candidate, or null when it has an assignee or an open blocker. */
function candidateOf(node: Node): Candidate | null {
  const title = string(node, "title")
  const url = string(node, "url")
  const assignees = integer(child(node, "assignees"), "totalCount")
  const blockedBy = integer(child(node, "issueDependenciesSummary"), "blockedBy")
  if (assignees > 0 || blockedBy > 0) {
    return null
  }
  const parent = childOrNull(node, "parent")
  return { number: integer(node, "number"), title, url, parent: parent === null ? null : integer(parent, "number") }
}

/**
 * The candidates the backlog `reply` holds, the sub-issues of an issue the pull request closes first, each
 * part in issue order. The issues it closes are read only when the query asked for them, `closing`.
 */
function candidatesIn(reply: string, closing: boolean): Candidate[] {
  const repository = child(child(rootOf(reply, "the backlog reply"), "data"), "repository")
  const closed = closing ? nodes(child(repository, "pullRequest"), "closingIssuesReferences") : []
  const closes = new Set(closed.map((node) => integer(node, "number")))
  const candidates = nodes(repository, "issues")
    .map(candidateOf)
    .filter((candidate): candidate is Candidate => candidate !== null && !closes.has(candidate.number))
    .toSorted((one, other) => one.number - other.number)
  const underClosed = (candidate: Candidate): boolean => candidate.parent !== null && closes.has(candidate.parent)
  return [...candidates.filter(underClosed), ...candidates.filter((candidate) => !underClosed(candidate))]
}

/**
 * The open issues labelled ready-for-agent with no assignee and no open blocker, read from `repo`, or from the
 * repository gh resolves when it is null. The open sub-issues of an issue pull request `pr` closes come
 * first, then the rest, each part in issue order; the issues it closes are never candidates.
 */
function nextCandidates(pr: { repo: string; number: number } | null): Candidate[] {
  const [owner, name] = pr === null ? ["{owner}", "{repo}"] : pr.repo.split("/")
  const reply = gh([
    "api",
    "graphql",
    "-f",
    `query=${QUERY}`,
    "-F",
    `owner=${owner ?? ""}`,
    "-F",
    `name=${name ?? ""}`,
    "-F",
    `number=${pr?.number ?? 0}`,
    "-F",
    `closing=${pr !== null}`
  ])
  if (reply.status !== 0) {
    throw new CannotRun(`gh could not read the backlog: ${said(reply.stderr)}`, REMEDY)
  }
  try {
    return candidatesIn(reply.stdout, pr !== null)
  } catch (error) {
    if (error instanceof ReplyError) {
      throw new CannotRun(`the backlog reply does not parse: ${error.message}`, UNREAD_SHAPE)
    }
    throw error
  }
}

/** The candidates, or why the backlog could not be read: a Recap closes without them, so no failure stops it. */
export type Next = { candidates: Candidate[] } | { unread: string }

export function readNext(pr: { repo: string; number: number } | null): Next {
  try {
    return { candidates: nextCandidates(pr) }
  } catch (error) {
    if (error instanceof CannotRun) {
      return { unread: error.message }
    }
    throw error
  }
}
