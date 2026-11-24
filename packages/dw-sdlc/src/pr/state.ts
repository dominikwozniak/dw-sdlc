// One pull request as the Ship script reads it: the one GraphQL query, and its reply parsed into the
// state the decision reads, the review history the Review's standing is read from beside it. Every field
// the state needs is checked; a reply that fails names the field.

import {
  boolean,
  child,
  childOrNull,
  firstNode,
  hasMore,
  integer,
  integerOrNull,
  type Node,
  nodes,
  oneOf,
  ReplyError,
  rootOf,
  string,
  stringOrNull,
  time,
  timeOrNull
} from "./reply.ts"
import type { Commit, History, LeftBehind, Posted, Standing } from "./standing.ts"

/** The commit status a clean review of the head leaves on it. */
export const REVIEW = "dw-sdlc/review"
/** The commit status `dw-sdlc gate --mark` leaves on a head the Gate passed on: the Gate mark. */
export const GATE = "dw-sdlc/gate"
/** How the description of a success the script posts under off begins: no one read that head. */
export const OFF_PREFIX = "off:"
/**
 * The read mark: the review status in this state and with this description says a Review read that
 * head and left a Finding open.
 */
export const MARK_STATE = "failure"
export const READ_MARK = "read, findings open"
/** How the description of the success the dev's `--accept` posts reads: the head, taken with its Findings open. */
export const ACCEPTED = "accepted by the dev, findings open"

/** How many checks and review threads the one read holds; each list's `pageInfo` says when more follow. */
const CHECKS_READ = 50
const THREADS_READ = 100
/**
 * How many of the last force pushes the read holds, each with the head it left behind, and how many
 * commits of that head's history.
 */
const FORCE_PUSHES_READ = 20
const LEFT_BEHIND_READ = 20

export const QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      url number state isDraft mergeable mergeStateStatus reviewDecision headRefOid headRefName headRef { name } isCrossRepository baseRefName
      baseRefOid baseRef { target { oid } } viewerDidAuthor mergeCommit { oid }
      ready: timelineItems(last: 1, itemTypes: [READY_FOR_REVIEW_EVENT]) { nodes { ... on ReadyForReviewEvent { createdAt } } }
      latestReviews(first: 100) { nodes { state author { login } commit { oid } } }
      reviewThreads(first: ${THREADS_READ}) { pageInfo { hasNextPage } nodes { id isResolved isOutdated path line
        comments(first: 1) { nodes { author { login } body } }
        latest: comments(last: 1) { nodes { viewerDidAuthor } } } }
      commits(last: 1) { nodes { commit { committedDate statusCheckRollup {
        contexts(first: ${CHECKS_READ}) { pageInfo { hasNextPage } nodes {
          ... on CheckRun { name status conclusion detailsUrl startedAt isRequired(pullRequestNumber: $number) steps(first: 1) { totalCount } }
          ... on StatusContext { context state targetUrl createdAt isRequired(pullRequestNumber: $number) } } } }
        status { context(name: "${REVIEW}") { context state targetUrl createdAt isRequired(pullRequestNumber: $number) } } } } }
      history: commits(last: 100) { nodes { commit { oid parents { totalCount } status { context(name: "${REVIEW}") { state description } } } } }
      rewritten: timelineItems(last: ${FORCE_PUSHES_READ}, itemTypes: [HEAD_REF_FORCE_PUSHED_EVENT]) { nodes { ... on HeadRefForcePushedEvent {
        beforeCommit { oid history(first: ${LEFT_BEHIND_READ}) { nodes { oid parents(first: 1) { nodes { oid } }
          status { context(name: "${REVIEW}") { state description } } } } } } } }
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
  /** A GitHub Actions job that ended failed with no step run: GitHub never ran it, as under a billing lock. */
  unstarted: boolean
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

/** A reviewer whose latest review requests changes, and whether a push has answered it. */
export type ChangeRequest = { reviewer: string; answered: boolean }

/** The pull request as the reply holds it, before the Review's standing is read. */
export type PullRequest = {
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
  /** When the pull request last left draft; null when it never was one. */
  readyAt: string | null
  branch: string
  /** Whether the head branch still stands on the remote: GitHub reports no `headRef` once it is gone. */
  branchStands: boolean
  /** Whether the pull request comes from a fork: its head branch lives on the fork, not on `origin`. */
  fromFork: boolean
  base: string
  /**
   * The commit the base branch points at, read from the branch itself: GitHub's `baseRefOid` lags a
   * base that just moved. A deleted base branch leaves `baseRefOid`.
   */
  baseOid: string
  mergeCommit: string | null
  checks: CiCheck[]
  /** The threads neither resolved nor outdated. */
  unresolvedThreads: Thread[]
  /** Each reviewer's latest review that requests changes, in the order GitHub lists them. */
  changeRequests: ChangeRequest[]
  /** What the read holds of each list with more after it, as `the first 50 checks`; empty when it holds all. */
  cutOff: string[]
  /** The oids of the pull request's last 100 commits, oldest first, the head last. */
  commits: string[]
}

/** The pull request and the Review's standing at its head. */
export type PrState = PullRequest & Standing

const FAIL = new Set(["ERROR", "FAILURE", "TIMED_OUT", "ACTION_REQUIRED", "CANCELLED", "STARTUP_FAILURE"])
const SKIPPING = new Set(["SKIPPED", "NEUTRAL"])
/** The conclusions of a job GitHub refused to run: with no step run, no test failed. */
const REFUSED = new Set(["FAILURE", "STARTUP_FAILURE"])
const ACTIONS_RUN = /\/actions\/runs\/\d+/

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
    const conclusion = status === "COMPLETED" ? stringOrNull(context, "conclusion") : status
    // Another app's check run reports no steps at all: only a GitHub Actions job's zero means none ran.
    const stepless = integer(child(context, "steps"), "totalCount") === 0
    return {
      name: string(context, "name"),
      bucket: bucketOf(conclusion),
      required: boolean(context, "isRequired"),
      link,
      log: logCommand(link, repo),
      startedAt: timeOrNull(context, "startedAt"),
      unstarted: conclusion !== null && REFUSED.has(conclusion) && stepless && link !== null && ACTIONS_RUN.test(link)
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
      startedAt: time(context, "createdAt"),
      unstarted: false
    }
  }
  throw new ReplyError(`${context.at} is neither a CheckRun nor a StatusContext`)
}

/**
 * The head's checks as the rollup lists them. With more past its first 50, the review status is read by
 * its name too, so whether the head is reviewed never hangs on where the rollup lists it.
 */
function checksOf(commit: Node, repo: string): CiCheck[] {
  const rollup = childOrNull(commit, "statusCheckRollup")
  if (rollup === null) {
    return []
  }
  const listed = nodes(rollup, "contexts").map((context) => checkOf(context, repo))
  if (!hasMore(rollup, "contexts") || listed.some(({ name }) => name === REVIEW)) {
    return listed
  }
  const status = childOrNull(commit, "status")
  const review = status === null ? null : childOrNull(status, "context")
  return review === null ? listed : [...listed, checkOf(review, repo)]
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

/**
 * What a commit's review status says: `clean` a success, `findings` the read mark, `off` a success
 * posted under off, which says no one read the commit, null no status of the Review.
 */
function postedOn(commit: Node): Posted {
  const status = childOrNull(commit, "status")
  const context = status === null ? null : childOrNull(status, "context")
  if (context === null) {
    return null
  }
  const state = string(context, "state")
  const description = stringOrNull(context, "description") ?? ""
  if (state === "SUCCESS") {
    return description.startsWith(OFF_PREFIX) ? "off" : "clean"
  }
  return state === MARK_STATE.toUpperCase() && description === READ_MARK ? "findings" : null
}

/** The pull request's last 100 commits, oldest first, each with the review status it carries. */
function historyOf(pr: Node): Commit[] {
  return nodes(pr, "history").map((node) => {
    const commit = child(node, "commit")
    return {
      oid: string(commit, "oid"),
      posted: postedOn(commit),
      merge: integer(child(commit, "parents"), "totalCount") > 1
    }
  })
}

/**
 * The commits a force push left behind: the head, then down its first parents within the history the
 * read holds of it. A merge's first parent is the branch, so the walk stays off the base's side.
 */
function lineOf(left: Node): Omit<LeftBehind, "forksAt">[] {
  const held = new Map(nodes(left, "history").map((commit) => [string(commit, "oid"), commit]))
  const line: Omit<LeftBehind, "forksAt">[] = []
  let commit = held.get(string(left, "oid"))
  while (commit !== undefined && line.length < held.size) {
    line.push({ oid: string(commit, "oid"), posted: postedOn(commit) })
    const [parent] = nodes(commit, "parents")
    commit = parent === undefined ? undefined : held.get(string(parent, "oid"))
  }
  return line
}

/**
 * The commits the force pushes left behind, newest push first, each once and none the history still
 * holds: a line stops where it meets the history, as under an amend, or a newer push's line, and forks
 * where the commit it meets does.
 */
function leftBehindOf(pr: Node, history: Commit[]): LeftBehind[] {
  const forks = new Map(history.map(({ oid }, index) => [oid, index]))
  const left: LeftBehind[] = []
  for (const event of nodes(pr, "rewritten").toReversed()) {
    const head = childOrNull(event, "beforeCommit")
    const line = head === null ? [] : lineOf(head)
    const met = line.findIndex(({ oid }) => forks.has(oid))
    const meets = line[met]
    const forksAt = meets === undefined ? -1 : (forks.get(meets.oid) ?? -1)
    for (const commit of meets === undefined ? line : line.slice(0, met)) {
      forks.set(commit.oid, forksAt)
      left.push({ ...commit, forksAt })
    }
  }
  return left
}

/**
 * Whether a non-merge commit follows `commit` in the history, oldest first, as the standing judges a read
 * mark. A commit outside the history, after a force-push or past the last 100, is not answered.
 */
function answeredAfter(history: Commit[], commit: string | null): boolean {
  const index = history.findIndex(({ oid }) => oid === commit)
  return index >= 0 && history.slice(index + 1).some(({ merge }) => !merge)
}

/** The reviewers whose latest review requests changes, each judged against the history. */
function changeRequestsOf(pr: Node, history: Commit[]): ChangeRequest[] {
  return nodes(pr, "latestReviews")
    .filter((review) => string(review, "state") === "CHANGES_REQUESTED")
    .map((review) => {
      const author = childOrNull(review, "author")
      const commit = childOrNull(review, "commit")
      return {
        reviewer: author === null ? "ghost" : string(author, "login"),
        answered: answeredAfter(history, commit === null ? null : string(commit, "oid"))
      }
    })
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

/**
 * The pull request in `reply`, the text `gh api graphql` printed for QUERY on `repo`, and the history the
 * Review's standing at its head is read from.
 */
export function parsePr(reply: string, repo: string): { pr: PullRequest; history: History } {
  const pr = child(child(child(rootOf(reply, "the reply"), "data"), "repository"), "pullRequest")
  const commit = child(firstNode(pr, "commits"), "commit")
  const rollup = childOrNull(commit, "statusCheckRollup")
  const mergeCommit = childOrNull(pr, "mergeCommit")
  const head = string(pr, "headRefOid")
  const baseRef = childOrNull(pr, "baseRef")
  const commits = historyOf(pr)
  const [ready] = nodes(pr, "ready")
  const parsed: PullRequest = {
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
    readyAt: ready === undefined ? null : time(ready, "createdAt"),
    branch: string(pr, "headRefName"),
    branchStands: childOrNull(pr, "headRef") !== null,
    fromFork: boolean(pr, "isCrossRepository"),
    base: string(pr, "baseRefName"),
    baseOid: baseRef === null ? string(pr, "baseRefOid") : string(child(baseRef, "target"), "oid"),
    mergeCommit: mergeCommit === null ? null : string(mergeCommit, "oid"),
    checks: checksOf(commit, repo),
    unresolvedThreads: nodes(pr, "reviewThreads")
      .filter((thread) => !boolean(thread, "isResolved") && !boolean(thread, "isOutdated"))
      .map(threadOf),
    changeRequests: changeRequestsOf(pr, commits),
    cutOff: [
      ...(rollup !== null && hasMore(rollup, "contexts") ? [`the first ${CHECKS_READ} checks`] : []),
      ...(hasMore(pr, "reviewThreads") ? [`the first ${THREADS_READ} threads`] : [])
    ],
    commits: commits.map(({ oid }) => oid)
  }
  const history = { commits, leftBehind: leftBehindOf(pr, commits), head, base: parsed.baseOid }
  return { pr: parsed, history }
}
