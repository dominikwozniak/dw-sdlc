// One pull request as the Ship script reads it: the one GraphQL query, and its reply parsed into the
// state the decision reads. Every field the state needs is checked; a reply that fails names the field.

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

/** The commit status a clean review of the head leaves on it. */
export const REVIEW = "dw-sdlc/review"
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
/** How many of the last force pushes the read holds, each with the head it left behind. */
const FORCE_PUSHES_READ = 20

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
          ... on CheckRun { name status conclusion detailsUrl startedAt isRequired(pullRequestNumber: $number) }
          ... on StatusContext { context state targetUrl createdAt isRequired(pullRequestNumber: $number) } } } } } } }
      history: commits(last: 100) { nodes { commit { oid parents { totalCount } status { context(name: "${REVIEW}") { state description } } } } }
      rewritten: timelineItems(last: ${FORCE_PUSHES_READ}, itemTypes: [HEAD_REF_FORCE_PUSHED_EVENT]) { nodes { ... on HeadRefForcePushedEvent {
        beforeCommit { oid status { context(name: "${REVIEW}") { state description } } } } } }
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

/** A reviewer whose latest review requests changes, and whether a push has answered it. */
export type ChangeRequest = { reviewer: string; answered: boolean }

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
  /**
   * The last commit before the head a Review read, of the last 100: a review success not posted under
   * off, or a read mark. With none there, a head a force push left behind that a Review read.
   */
  lastRead: LastRead | null
  /**
   * The read marks since the last review success of any kind, of the last 100 commits, then, when they
   * hold no success, of the heads force pushes left behind.
   */
  marks: ReadMarks
  /** Whether the head carries the success of `lastRead`: the read decides it from two compares. */
  carried: boolean
  /**
   * The files a Review would read, from `lastRead` or the base to the head, read only for `pr.review:
   * auto` to route on: `unsized` when the compare cannot list them all, null when not read.
   */
  changed: ChangedFile[] | "unsized" | null
  /**
   * The files whose own change moved since `lastRead`, when a merge of the base came after it: the files
   * a fix touched, the base's own left out. Null with no such merge, or when a compare cannot show them.
   */
  scope: string[] | null
}

/**
 * A file a Review would read: its name, its name before a rename, and the lines it adds and removes,
 * null when the compare shows no patch for it, as for a binary file.
 */
export type ChangedFile = { path: string; previous: string | null; lines: number | null }

/** A commit a Review read; `clean` when that Review left a success on it, not a read mark. */
export type Read = { commit: string; clean: boolean }

/**
 * A commit a Review read; `baseOnly` when every change after it is the base's, the head included: only
 * merges of the base, or a rebase past no other read; `baseMoved` when a merge of the base or a rebase
 * came after it.
 */
export type LastRead = Read & { baseOnly: boolean; baseMoved: boolean }

/**
 * The Reviews that left a Finding open since the last review success, a success under off and the dev's
 * acceptance included: `count` their read marks, the head's own among them, and `since` that success's
 * commit, null when none of the last 100 holds one.
 */
export type ReadMarks = { count: number; since: string | null }

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

/**
 * What a commit's review status says: `clean` a success, `findings` the read mark, `off` a success
 * posted under off, which says no one read the commit, null no status of the Review.
 */
function postedOn(commit: Node): "clean" | "findings" | "off" | null {
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

/** A commit and the review status it carries. */
type Marked = { oid: string; posted: ReturnType<typeof postedOn> }
type Posted = Marked & { merge: boolean }

/** The pull request's last 100 commits, oldest first, each with the review status it carries. */
function historyOf(pr: Node): Posted[] {
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
 * The last commit before `head` a Review read, the history oldest first. A read mark with only merges
 * after it is passed over: no fix answers its Findings yet, and a Review from it would read only the
 * base's changes, so the Review reads from the read before it and finds them again.
 */
function lastReadOf(history: Posted[], head: string): LastRead | null {
  const commits = history.map(({ oid, posted, merge }) => ({
    oid,
    read: oid === head || posted === "off" ? null : posted,
    merge
  }))
  const mergesOnlyAfter = (index: number): boolean => commits.slice(index + 1).every(({ merge }) => merge)
  const index = commits.findLastIndex(
    ({ read }, at) => read === "clean" || (read === "findings" && !mergesOnlyAfter(at))
  )
  const last = commits[index]
  if (last === undefined) {
    return null
  }
  return {
    commit: last.oid,
    clean: last.read === "clean",
    baseOnly: mergesOnlyAfter(index),
    baseMoved: commits.slice(index + 1).some(({ merge }) => merge)
  }
}

/**
 * The heads the force pushes left behind, newest first, each once and none the history still holds:
 * an amend leaves the commits before the head in place.
 */
function forcePushedOf(pr: Node, history: Posted[]): Marked[] {
  const inHistory = new Set(history.map(({ oid }) => oid))
  const heads = nodes(pr, "rewritten").flatMap((event) => {
    const left = childOrNull(event, "beforeCommit")
    return left === null ? [] : [{ oid: string(left, "oid"), posted: postedOn(left) }]
  })
  const newest = heads.toReversed()
  return newest.filter(
    ({ oid }, index) => !inHistory.has(oid) && newest.findIndex((head) => head.oid === oid) === index
  )
}

/** The heads of `forcePushed` a Review read, a success under off passed over as the history passes it. */
function rewrittenOf(forcePushed: Marked[]): Read[] {
  return forcePushed.flatMap(({ oid, posted }) =>
    posted === "clean" || posted === "findings" ? [{ commit: oid, clean: posted === "clean" }] : []
  )
}

/**
 * Whether a non-merge commit follows `commit` in the history, oldest first, as `lastReadOf` judges a read
 * mark. A commit outside the history, after a force-push or past the last 100, is not answered.
 */
function answeredAfter(history: Posted[], commit: string | null): boolean {
  const index = history.findIndex(({ oid }) => oid === commit)
  return index >= 0 && history.slice(index + 1).some(({ merge }) => !merge)
}

/** The reviewers whose latest review requests changes, each judged against the history. */
function changeRequestsOf(pr: Node, history: Posted[]): ChangeRequest[] {
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

/**
 * The read marks since the last success, the history's first; with no success there, the marks on the
 * heads force pushes left behind go on the count, newest first, up to the first success among them.
 */
function readMarksOf(history: Posted[], forcePushed: Marked[]): ReadMarks {
  const isSuccess = ({ posted }: Marked): boolean => posted === "clean" || posted === "off"
  const findings = (commits: Marked[]): number => commits.filter(({ posted }) => posted === "findings").length
  const success = history.findLastIndex(isSuccess)
  const count = findings(history.slice(success + 1))
  const lastSuccess = history[success]
  if (lastSuccess !== undefined) {
    return { count, since: lastSuccess.oid }
  }
  const pushedSuccess = forcePushed.findIndex(isSuccess)
  const sincePushed = pushedSuccess < 0 ? forcePushed : forcePushed.slice(0, pushedSuccess)
  return { count: count + findings(sincePushed), since: forcePushed[pushedSuccess]?.oid ?? null }
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

/** The state as the reply holds it, before the compares decide what the head carries and a Review reads. */
export type Parsed = Omit<PrState, "carried" | "changed" | "scope">

/**
 * The state of the pull request in `reply`, the text `gh api graphql` printed for QUERY on `repo`, and
 * `rewritten`: the heads the last 20 force pushes left behind that a Review read, newest first, none the
 * history still holds, where a Review's read stands once a rebase rewrote every commit it read.
 */
export function parsePr(reply: string, repo: string): { pr: Parsed; rewritten: Read[] } {
  const pr = child(child(child(rootOf(reply, "the reply"), "data"), "repository"), "pullRequest")
  const commit = child(firstNode(pr, "commits"), "commit")
  const rollup = childOrNull(commit, "statusCheckRollup")
  const mergeCommit = childOrNull(pr, "mergeCommit")
  const head = string(pr, "headRefOid")
  const baseRef = childOrNull(pr, "baseRef")
  const history = historyOf(pr)
  const [ready] = nodes(pr, "ready")
  const state = {
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
    checks: rollup === null ? [] : nodes(rollup, "contexts").map((context) => checkOf(context, repo)),
    unresolvedThreads: nodes(pr, "reviewThreads")
      .filter((thread) => !boolean(thread, "isResolved") && !boolean(thread, "isOutdated"))
      .map(threadOf),
    changeRequests: changeRequestsOf(pr, history),
    cutOff: [
      ...(rollup !== null && hasMore(rollup, "contexts") ? [`the first ${CHECKS_READ} checks`] : []),
      ...(hasMore(pr, "reviewThreads") ? [`the first ${THREADS_READ} threads`] : [])
    ],
    commits: history.map(({ oid }) => oid),
    lastRead: lastReadOf(history, head)
  }
  const forcePushed = forcePushedOf(pr, history)
  return { pr: { ...state, marks: readMarksOf(history, forcePushed) }, rewritten: rewrittenOf(forcePushed) }
}
