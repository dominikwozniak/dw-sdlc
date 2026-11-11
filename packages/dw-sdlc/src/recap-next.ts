// The candidates for the session after this one, as `dw-sdlc recap` reads them: the open issues an agent may
// start, from one GraphQL request that also asks which issues the branch's pull request closes.

import { isObject, type JsonObject, parseObject } from "./json-text.ts"
import { CannotRun, gh, said } from "./pr/read.ts"

/** The label that marks an issue as ready for an agent to start. */
export const READY_LABEL = "ready-for-agent"
/** How many open issues the one read holds, oldest first. */
const ISSUES_READ = 100

const QUERY = `query Backlog($owner: String!, $name: String!, $number: Int!, $closing: Boolean!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) @include(if: $closing) { closingIssuesReferences(first: 25) { nodes { number } } }
    issues(first: ${ISSUES_READ}, states: OPEN, labels: ["${READY_LABEL}"], orderBy: { field: CREATED_AT, direction: ASC }) {
      nodes { number title url assignees { totalCount } issueDependenciesSummary { blockedBy } parent { number } }
    }
  }
}`

/** An issue the next session may start; `parent` the issue it is a sub-issue of, null for none. */
export type Candidate = { number: number; title: string; url: string; parent: number | null }

const REMEDY = "check gh auth status and the network, then call again"

function malformed(field: string): CannotRun {
  return new CannotRun(
    `the backlog reply does not parse: ${field}`,
    "gh answered a shape dw-sdlc does not read; report it with the output of gh --version"
  )
}

function nodesOf(value: unknown, field: string): unknown[] {
  if (!isObject(value) || !Array.isArray(value.nodes)) {
    throw malformed(field)
  }
  return value.nodes
}

function numberOf(value: unknown, field: string): number {
  if (!isObject(value) || typeof value.number !== "number") {
    throw malformed(field)
  }
  return value.number
}

/** An issue node as a candidate, or null when it has an assignee or an open blocker. */
function candidateOf(node: unknown): Candidate | null {
  if (!isObject(node) || typeof node.title !== "string" || typeof node.url !== "string") {
    throw malformed("issues.nodes")
  }
  const { assignees, issueDependenciesSummary: dependencies, parent } = node
  if (!isObject(assignees) || typeof assignees.totalCount !== "number") {
    throw malformed("issues.nodes.assignees")
  }
  if (!isObject(dependencies) || typeof dependencies.blockedBy !== "number") {
    throw malformed("issues.nodes.issueDependenciesSummary")
  }
  if (assignees.totalCount > 0 || dependencies.blockedBy > 0) {
    return null
  }
  const number = numberOf(node, "issues.nodes.number")
  return { number, title: node.title, url: node.url, parent: parent === null ? null : numberOf(parent, "parent") }
}

function repositoryOf(stdout: string): JsonObject {
  const data = parseObject(stdout)?.data
  const repository = isObject(data) ? data.repository : undefined
  if (!isObject(repository)) {
    throw malformed("data.repository")
  }
  return repository
}

/**
 * The open issues labelled ready-for-agent with no assignee and no open blocker, read from `repo`, or from the
 * repository gh resolves when it is null. The open sub-issues of an issue pull request `pr` closes come
 * first, then the rest, each part in issue order; the issues it closes are never candidates.
 */
export function nextCandidates(pr: { repo: string; number: number } | null): Candidate[] {
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
  const repository = repositoryOf(reply.stdout)
  const closes = new Set(
    pr === null
      ? []
      : nodesOf(
          isObject(repository.pullRequest) ? repository.pullRequest.closingIssuesReferences : undefined,
          "pullRequest"
        ).map((node) => numberOf(node, "closingIssuesReferences.nodes"))
  )
  const candidates = nodesOf(repository.issues, "issues")
    .map(candidateOf)
    .filter((candidate): candidate is Candidate => candidate !== null && !closes.has(candidate.number))
    .toSorted((one, other) => one.number - other.number)
  const topic = (candidate: Candidate): boolean => candidate.parent !== null && closes.has(candidate.parent)
  return [...candidates.filter(topic), ...candidates.filter((candidate) => !topic(candidate))]
}
