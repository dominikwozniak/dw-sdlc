// One pull request as the Ship script reads it: the one GraphQL query, and its reply parsed into the
// state the decision reads. Every field the state needs is checked; a reply that fails names the field.

/** The commit status a clean review of the head leaves on it. */
export const REVIEW = "dw-sdlc/review"
/** How the description of a success the script posts under off begins: no one read that head. */
export const OFF_PREFIX = "off:"

export const QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      url number state isDraft mergeable mergeStateStatus reviewDecision headRefOid headRefName baseRefName baseRefOid
      viewerDidAuthor mergeCommit { oid }
      reviewThreads(first: 100) { nodes { id isResolved isOutdated path line
        comments(first: 1) { nodes { author { login } body } }
        latest: comments(last: 1) { nodes { viewerDidAuthor } } } }
      commits(last: 1) { nodes { commit { committedDate statusCheckRollup {
        contexts(first: 50) { nodes {
          ... on CheckRun { name status conclusion detailsUrl startedAt isRequired(pullRequestNumber: $number) }
          ... on StatusContext { context state targetUrl createdAt isRequired(pullRequestNumber: $number) } } } } } } }
      history: commits(last: 100) { nodes { commit { oid parents { totalCount } status { context(name: "${REVIEW}") { state description } } } } }
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
export type Thread = {
  id: string
  path: string
  line: number | null
  author: string
  body: string
  /** Whether the viewer, the account gh reads as, wrote the thread's last comment. */
  lastByViewer: boolean
}

const STATES = ["OPEN", "CLOSED", "MERGED"] as const
const MERGEABLE = ["MERGEABLE", "CONFLICTING", "UNKNOWN"] as const
const REVIEW_DECISIONS = ["APPROVED", "CHANGES_REQUESTED", "REVIEW_REQUIRED"] as const

export type PrState = {
  url: string
  repo: string
  number: number
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
  /** The commit the base branch points at. */
  baseOid: string
  mergeCommit: string | null
  checks: CiCheck[]
  /** The threads neither resolved nor outdated. */
  unresolvedThreads: Thread[]
  /** The oids of the pull request's last 100 commits, oldest first, the head last. */
  commits: string[]
  /** The last commit before the head with a review success not posted under off, of the last 100. */
  lastReviewed: LastReviewed | null
  /** Whether the head carries the success of `lastReviewed`: the read decides it from two compares. */
  carried: boolean
  /**
   * The files a Review would read, from `lastReviewed` or the base to the head, read only for `pr.review:
   * auto` to route on: `unsized` when the compare cannot list them all, null when not read.
   */
  changed: ChangedFile[] | "unsized" | null
  /**
   * How many commits of the base the head lacks, from the compare of the base with the head: read only
   * by the Ship script, for an open, mergeable pull request GitHub does not report BEHIND; null when not read.
   */
  behindBy: number | null
}

/**
 * A file a Review would read: its name, its name before a rename, and the lines it adds and removes,
 * null when the compare shows no patch for it, as for a binary file.
 */
export type ChangedFile = { path: string; previous: string | null; lines: number | null }

/** A reviewed commit, and whether every commit after it, the head included, is a merge. */
export type LastReviewed = { commit: string; mergesOnly: boolean }

/** A reply that is not the shape the query asks for; the message names the field. */
export class ReplyError extends Error {}

/** A JSON object of the reply and the path that reached it, as `data.repository.pullRequest`. */
export type Node = { value: Record<string, unknown>; at: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function shown(value: unknown): string {
  return value === undefined ? "missing" : JSON.stringify(value)
}

/** The JSON object `reply` holds, the root its fields' paths start from; `what` names it in a problem. */
export function rootOf(reply: string, what: string): Node {
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

export function fieldOf(node: Node, key: string): { value: unknown; at: string } {
  return { value: node.value[key], at: node.at === "" ? key : `${node.at}.${key}` }
}

export function object(value: unknown, at: string): Node {
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

export function string(node: Node, key: string): string {
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

export function integer(node: Node, key: string): number {
  const { value, at } = fieldOf(node, key)
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new ReplyError(`${at} is ${shown(value)}, not an integer`)
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

/** A time as GitHub writes it, ISO 8601; the decision reads it as one. */
function time(node: Node, key: string): string {
  const value = string(node, key)
  if (Number.isNaN(Date.parse(value))) {
    throw new ReplyError(`${fieldOf(node, key).at} is ${shown(value)}, not a time`)
  }
  return value
}

function timeOrNull(node: Node, key: string): string | null {
  return node.value[key] === null ? null : time(node, key)
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

/** The first object of a connection's `nodes`; an empty connection does not parse. */
function firstNode(node: Node, key: string): Node {
  const [first] = nodes(node, key)
  if (first === undefined) {
    throw new ReplyError(`${node.at}.${key}.nodes is empty`)
  }
  return first
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
      startedAt: timeOrNull(context, "startedAt")
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
      startedAt: time(context, "createdAt")
    }
  }
  throw new ReplyError(`${context.at} is neither a CheckRun nor a StatusContext`)
}

/** A thread by its opening comment; a deleted account's comment has no author and reads as GitHub's ghost. */
function threadOf(thread: Node): Thread {
  const first = firstNode(thread, "comments")
  const author = childOrNull(first, "author")
  return {
    id: string(thread, "id"),
    path: string(thread, "path"),
    line: integerOrNull(thread, "line"),
    author: author === null ? "ghost" : string(author, "login"),
    body: string(first, "body"),
    lastByViewer: boolean(firstNode(thread, "latest"), "viewerDidAuthor")
  }
}

/** The viewer's own pull request without a review success on its head: the one a Review reads. */
export function awaitsReview(pr: Pick<PrState, "viewerDidAuthor" | "checks">): boolean {
  return pr.viewerDidAuthor && !pr.checks.some((check) => check.name === REVIEW && check.bucket === "pass")
}

/** A commit whose review success says someone read it: a status posted under off never does. */
function isReviewed(commit: Node): boolean {
  const status = childOrNull(commit, "status")
  const context = status === null ? null : childOrNull(status, "context")
  if (context === null || string(context, "state") !== "SUCCESS") {
    return false
  }
  return !(stringOrNull(context, "description") ?? "").startsWith(OFF_PREFIX)
}

/** The last commit before `head` that `isReviewed` takes, the history oldest first. */
function lastReviewedOf(pr: Node, head: string): LastReviewed | null {
  const commits = nodes(pr, "history").map((node) => child(node, "commit"))
  const index = commits.findLastIndex((commit) => string(commit, "oid") !== head && isReviewed(commit))
  const reviewed = commits[index]
  if (reviewed === undefined) {
    return null
  }
  const after = commits.slice(index + 1)
  const mergesOnly = after.every((commit) => integer(child(commit, "parents"), "totalCount") > 1)
  return { commit: string(reviewed, "oid"), mergesOnly }
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

/** The default branch of the repository whose `gh repo view --json defaultBranchRef` printed `reply`. */
export function parseDefaultBranch(reply: string): string {
  return string(child(rootOf(reply, "the reply of gh repo view"), "defaultBranchRef"), "name")
}

/** The state of the pull request in `reply`, the text `gh api graphql` printed for QUERY on `repo`. */
export function parsePr(reply: string, repo: string): Omit<PrState, "carried" | "changed" | "behindBy"> {
  const pr = child(child(child(rootOf(reply, "the reply"), "data"), "repository"), "pullRequest")
  const commit = child(firstNode(pr, "commits"), "commit")
  const rollup = childOrNull(commit, "statusCheckRollup")
  const mergeCommit = childOrNull(pr, "mergeCommit")
  const head = string(pr, "headRefOid")
  return {
    url: string(pr, "url"),
    repo,
    number: integer(pr, "number"),
    state: oneOf(pr, "state", STATES),
    draft: boolean(pr, "isDraft"),
    mergeable: oneOf(pr, "mergeable", MERGEABLE),
    mergeStateStatus: string(pr, "mergeStateStatus"),
    reviewDecision: pr.value.reviewDecision === null ? null : oneOf(pr, "reviewDecision", REVIEW_DECISIONS),
    viewerDidAuthor: boolean(pr, "viewerDidAuthor"),
    head,
    headCommittedAt: time(commit, "committedDate"),
    branch: string(pr, "headRefName"),
    base: string(pr, "baseRefName"),
    baseOid: string(pr, "baseRefOid"),
    mergeCommit: mergeCommit === null ? null : string(mergeCommit, "oid"),
    checks: rollup === null ? [] : nodes(rollup, "contexts").map((context) => checkOf(context, repo)),
    unresolvedThreads: nodes(pr, "reviewThreads")
      .filter((thread) => !boolean(thread, "isResolved") && !boolean(thread, "isOutdated"))
      .map(threadOf),
    commits: nodes(pr, "history").map((node) => string(child(node, "commit"), "oid")),
    lastReviewed: lastReviewedOf(pr, head)
  }
}
