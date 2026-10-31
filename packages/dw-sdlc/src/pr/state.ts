// One pull request as the Ship script reads it: the one GraphQL query, and its reply parsed into the
// state the decision reads. Every field the state needs is checked; a reply that fails names the field.

export const QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      url state isDraft mergeable mergeStateStatus reviewDecision headRefOid headRefName baseRefName
      viewerDidAuthor mergeCommit { oid }
      reviewThreads(first: 100) { nodes { id isResolved isOutdated path line
        comments(first: 1) { nodes { author { login } body } } } }
      commits(last: 1) { nodes { commit { committedDate statusCheckRollup {
        contexts(first: 50) { nodes {
          ... on CheckRun { name status conclusion detailsUrl startedAt isRequired(pullRequestNumber: $number) }
          ... on StatusContext { context state targetUrl createdAt isRequired(pullRequestNumber: $number) } } } } } } }
    }
  }
}`

export type Bucket = "pass" | "fail" | "pending" | "skipping"
export type CiCheck = {
  name: string
  bucket: Bucket
  required: boolean
  link: string | null
  /** The command that prints a failed GitHub Actions job's log; null for any other CI. */
  log: string[] | null
  startedAt: string | null
}
export type Thread = { id: string; path: string; line: number | null; author: string; body: string }

const STATES = ["OPEN", "CLOSED", "MERGED"] as const
const MERGEABLE = ["MERGEABLE", "CONFLICTING", "UNKNOWN"] as const
const REVIEW_DECISIONS = ["APPROVED", "CHANGES_REQUESTED", "REVIEW_REQUIRED"] as const

export type PrState = {
  url: string
  repo: string
  state: (typeof STATES)[number]
  draft: boolean
  mergeable: (typeof MERGEABLE)[number]
  /** BEHIND, BLOCKED, CLEAN, DIRTY, HAS_HOOKS, UNKNOWN or UNSTABLE, as GitHub reports it. */
  mergeStateStatus: string
  reviewDecision: (typeof REVIEW_DECISIONS)[number] | null
  viewerDidAuthor: boolean
  head: string
  headCommittedAt: string
  branch: string
  base: string
  mergeCommit: string | null
  checks: CiCheck[]
  /** The threads neither resolved nor outdated. */
  unresolvedThreads: Thread[]
}

/** A reply that is not the shape the query asks for; the message names the field. */
export class ReplyError extends Error {}

/** A JSON object of the reply and the path that reached it, as `data.repository.pullRequest`. */
type Node = { value: Record<string, unknown>; at: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function shown(value: unknown): string {
  return value === undefined ? "missing" : JSON.stringify(value)
}

/** The JSON object `reply` holds, the root its fields' paths start from; `what` names it in a problem. */
function rootOf(reply: string, what: string): Node {
  let json: unknown
  try {
    json = JSON.parse(reply)
  } catch {
    throw new ReplyError(`${what} is not JSON`)
  }
  if (!isRecord(json)) {
    throw new ReplyError(`${what} is not a JSON object`)
  }
  return { value: json, at: "" }
}

function fieldOf(node: Node, key: string): { value: unknown; at: string } {
  return { value: node.value[key], at: node.at === "" ? key : `${node.at}.${key}` }
}

function object(value: unknown, at: string): Node {
  if (!isRecord(value)) {
    throw new ReplyError(`${at} is ${shown(value)}, not an object`)
  }
  return { value, at }
}

function child(node: Node, key: string): Node {
  const { value, at } = fieldOf(node, key)
  return object(value, at)
}

function childOrNull(node: Node, key: string): Node | null {
  const { value, at } = fieldOf(node, key)
  return value === null ? null : object(value, at)
}

function string(node: Node, key: string): string {
  const { value, at } = fieldOf(node, key)
  if (typeof value !== "string") {
    throw new ReplyError(`${at} is ${shown(value)}, not a string`)
  }
  return value
}

function stringOrNull(node: Node, key: string): string | null {
  return node.value[key] === null ? null : string(node, key)
}

function boolean(node: Node, key: string): boolean {
  const { value, at } = fieldOf(node, key)
  if (typeof value !== "boolean") {
    throw new ReplyError(`${at} is ${shown(value)}, not a boolean`)
  }
  return value
}

function integerOrNull(node: Node, key: string): number | null {
  const { value, at } = fieldOf(node, key)
  if (value !== null && !Number.isInteger(value)) {
    throw new ReplyError(`${at} is ${shown(value)}, not an integer or null`)
  }
  return typeof value === "number" ? value : null
}

function isOneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return values.some((known) => known === value)
}

function oneOf<T extends string>(node: Node, key: string, values: readonly T[]): T {
  const { value, at } = fieldOf(node, key)
  if (!isOneOf(values, value)) {
    throw new ReplyError(`${at} is ${shown(value)}, not one of ${values.join(", ")}`)
  }
  return value
}

/** The objects of a connection's `nodes`. */
function nodes(node: Node, key: string): Node[] {
  const { value, at } = fieldOf(child(node, key), "nodes")
  if (!Array.isArray(value)) {
    throw new ReplyError(`${at} is ${shown(value)}, not a list`)
  }
  return value.map((item: unknown, index) => object(item, `${at}[${index}]`))
}

const FAIL = new Set(["ERROR", "FAILURE", "TIMED_OUT", "ACTION_REQUIRED", "CANCELLED", "STARTUP_FAILURE"])
const SKIPPING = new Set(["SKIPPED", "NEUTRAL"])

/** A check's bucket as `gh pr checks` sorts it: every word not passed, failed or skipped is pending. */
function bucketOf(word: string | null): Bucket {
  if (word === "SUCCESS") {
    return "pass"
  }
  if (word !== null && FAIL.has(word)) {
    return "fail"
  }
  return word !== null && SKIPPING.has(word) ? "skipping" : "pending"
}

function logCommand(link: string | null, repo: string): string[] | null {
  const job = link?.match(/\/actions\/runs\/\d+\/job\/(\d+)/)?.[1]
  return job === undefined ? null : ["gh", "run", "view", "--job", job, "-R", repo, "--log-failed"]
}

/** A CheckRun has a name and a status; a StatusContext has a context and a state. */
function checkOf(context: Node, repo: string): CiCheck {
  if ("name" in context.value) {
    const status = string(context, "status")
    const link = stringOrNull(context, "detailsUrl")
    return {
      name: string(context, "name"),
      bucket: bucketOf(status === "COMPLETED" ? stringOrNull(context, "conclusion") : status),
      required: boolean(context, "isRequired"),
      link,
      log: logCommand(link, repo),
      startedAt: stringOrNull(context, "startedAt")
    }
  }
  if ("context" in context.value) {
    const link = stringOrNull(context, "targetUrl")
    return {
      name: string(context, "context"),
      bucket: bucketOf(string(context, "state")),
      required: boolean(context, "isRequired"),
      link,
      log: logCommand(link, repo),
      startedAt: string(context, "createdAt")
    }
  }
  throw new ReplyError(`${context.at} is neither a CheckRun nor a StatusContext`)
}

/** A thread by its opening comment; a deleted account's comment has no author and reads as GitHub's ghost. */
function threadOf(thread: Node): Thread {
  const [first] = nodes(thread, "comments")
  if (first === undefined) {
    throw new ReplyError(`${thread.at}.comments.nodes is empty`)
  }
  const author = childOrNull(first, "author")
  return {
    id: string(thread, "id"),
    path: string(thread, "path"),
    line: integerOrNull(thread, "line"),
    author: author === null ? "ghost" : string(author, "login"),
    body: string(first, "body")
  }
}

/** The repository and number of the pull request whose URL `gh pr view --json url` printed. */
export function parseView(reply: string): { repo: string; number: number } {
  const url = string(rootOf(reply, "the reply of gh pr view"), "url")
  const [, repo, number] = /^https:\/\/[^/]+\/([^/]+\/[^/]+)\/pull\/(\d+)$/.exec(url) ?? []
  if (repo === undefined || number === undefined) {
    throw new ReplyError(`url is ${JSON.stringify(url)}, not a pull request's URL`)
  }
  return { repo, number: Number(number) }
}

/** The state of the pull request in `reply`, the text `gh api graphql` printed for QUERY on `repo`. */
export function parsePr(reply: string, repo: string): PrState {
  const pr = child(child(child(rootOf(reply, "the reply"), "data"), "repository"), "pullRequest")
  const [last] = nodes(pr, "commits")
  if (last === undefined) {
    throw new ReplyError(`${pr.at}.commits.nodes is empty`)
  }
  const commit = child(last, "commit")
  const rollup = childOrNull(commit, "statusCheckRollup")
  const mergeCommit = childOrNull(pr, "mergeCommit")
  return {
    url: string(pr, "url"),
    repo,
    state: oneOf(pr, "state", STATES),
    draft: boolean(pr, "isDraft"),
    mergeable: oneOf(pr, "mergeable", MERGEABLE),
    mergeStateStatus: string(pr, "mergeStateStatus"),
    reviewDecision: pr.value.reviewDecision === null ? null : oneOf(pr, "reviewDecision", REVIEW_DECISIONS),
    viewerDidAuthor: boolean(pr, "viewerDidAuthor"),
    head: string(pr, "headRefOid"),
    headCommittedAt: string(commit, "committedDate"),
    branch: string(pr, "headRefName"),
    base: string(pr, "baseRefName"),
    mergeCommit: mergeCommit === null ? null : string(mergeCommit, "oid"),
    checks: rollup === null ? [] : nodes(rollup, "contexts").map((context) => checkOf(context, repo)),
    unresolvedThreads: nodes(pr, "reviewThreads")
      .filter((thread) => !boolean(thread, "isResolved") && !boolean(thread, "isOutdated"))
      .map(threadOf)
  }
}
