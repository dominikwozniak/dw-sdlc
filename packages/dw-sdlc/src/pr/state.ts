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

/** The commit status `dw-sdlc gate --mark` leaves on a head the Gate passed on: the Gate mark. */
export const GATE = "dw-sdlc/gate"
/** The prefix of the contexts dw-sdlc posts itself, as `dw-sdlc/gate`: never CI. */
export const OWN_PREFIX = "dw-sdlc/"

/** How many checks and review threads the one read holds; each list's `pageInfo` says when more follow. */
const CHECKS_READ = 50
const THREADS_READ = 100
/** How many of the newest merged pull requests, by when they opened, the read times CI on, by each head's checks. */
const MERGED_READ = 10

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
      } } }
      history: commits(last: 100) { nodes { commit { oid parents { totalCount } } } }
    }
    merged: pullRequests(last: ${MERGED_READ}, states: MERGED) { nodes { commits(last: 1) { nodes { commit {
      statusCheckRollup { contexts(first: ${CHECKS_READ}) { nodes { ... on CheckRun { name startedAt completedAt } } } } } } } } }
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

/** The pull request as the reply holds it. */
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
   * The seconds CI took on the heads of the repository's last merged pull requests, from the first start
   * to the last completion among their CheckRuns; a head with none timed is left out.
   */
  ciDurations: number[]
}

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

/** The head's checks as the rollup lists them. */
function checksOf(commit: Node, repo: string): CiCheck[] {
  const rollup = childOrNull(commit, "statusCheckRollup")
  return rollup === null ? [] : nodes(rollup, "contexts").map((context) => checkOf(context, repo))
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

/** A commit of the pull request's history; `merge` when it has more than one parent. */
type Commit = { oid: string; merge: boolean }

/** The pull request's last 100 commits, oldest first. */
function historyOf(pr: Node): Commit[] {
  return nodes(pr, "history").map((node) => {
    const commit = child(node, "commit")
    return { oid: string(commit, "oid"), merge: integer(child(commit, "parents"), "totalCount") > 1 }
  })
}

/**
 * Whether a non-merge commit follows `commit` in the history, oldest first: a push answers a change
 * request made on it. A commit outside the history, after a force-push or past the last 100, is not answered.
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

/** The seconds CI took on one merged head: its CheckRuns' first start to their last completion, the script's own left out. */
function ciDurationOf(head: Node): number | null {
  const rollup = childOrNull(child(firstNode(head, "commits"), "commit"), "statusCheckRollup")
  const runs = (rollup === null ? [] : nodes(rollup, "contexts")).filter(
    // A StatusContext the query selects no field of reads as an empty node.
    (context) => "name" in context.value && !string(context, "name").startsWith(OWN_PREFIX)
  )
  const starts = runs.flatMap((run) => timeOrNull(run, "startedAt") ?? []).map(Date.parse)
  const ends = runs.flatMap((run) => timeOrNull(run, "completedAt") ?? []).map(Date.parse)
  if (starts.length === 0 || ends.length === 0) {
    return null
  }
  return Math.max(0, (Math.max(...ends) - Math.min(...starts)) / 1000)
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

/** The pull request in `reply`, the text `gh api graphql` printed for QUERY on `repo`. */
export function parsePr(reply: string, repo: string): PrState {
  const repository = child(child(rootOf(reply, "the reply"), "data"), "repository")
  const pr = child(repository, "pullRequest")
  const commit = child(firstNode(pr, "commits"), "commit")
  const rollup = childOrNull(commit, "statusCheckRollup")
  const mergeCommit = childOrNull(pr, "mergeCommit")
  const head = string(pr, "headRefOid")
  const baseRef = childOrNull(pr, "baseRef")
  const commits = historyOf(pr)
  const [ready] = nodes(pr, "ready")
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
    commits: commits.map(({ oid }) => oid),
    ciDurations: nodes(repository, "merged").flatMap((merged) => ciDurationOf(merged) ?? [])
  }
}
