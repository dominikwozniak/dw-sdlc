// The Review's standing at a pull request's head: what the Reviews before it read, from the review status
// each commit carries and the commits force pushes left behind; what the head carries of them; what the
// next Review reads, through a port onto GitHub's compares; and so the Review the head gets.

import type { PrReview, ReviewDepth } from "../agentic-config.ts"
import { type ChangedFile, route } from "./route.ts"

/**
 * How many Reviews that each left a Finding open, with no success between them, the script lets run: the
 * next call parks the pull request for the dev. A constant, like the depth rules, so no repository turns
 * the loop back on.
 */
const REVIEW_LIMIT = 3

/** What a commit's review status says: a success, the read mark, a success posted under off, or none. */
export type Posted = "clean" | "findings" | "off" | null
/** A commit of the history and the review status it carries; `merge` when it has more than one parent. */
export type Commit = { oid: string; posted: Posted; merge: boolean }
/**
 * A commit a force push left behind and its review status; `forksAt` the index in the history of the
 * commit its line was pushed on, as under an amend, -1 when its line holds none, as after a rebase.
 */
export type LeftBehind = { oid: string; posted: Posted; forksAt: number }

/** What the standing is read from. */
export type History = {
  /** The pull request's last 100 commits, oldest first, the head last. */
  commits: Commit[]
  /** The commits the last force pushes left behind, newest push first, none of them among `commits`. */
  leftBehind: LeftBehind[]
  head: string
  /** The commit the base branch points at, the one the own changes are compared with. */
  base: string
}

/**
 * A file's own change: its name, its status, its name before a rename, and the lines its patch adds and
 * removes, in order, without the hunk headers and context a moved base shifts.
 */
export type OwnChange = { path: string; status: string; previous: string | null; lines: string[] }

/** GitHub's compares as the standing asks them. A compare of two commits never changes: an adapter may keep it. */
export type Compares = {
  /** The pull request's own changes at `commit`, from `base`; null when the compare cannot show them whole. */
  ownChanges: (base: string, commit: string) => OwnChange[] | null
  /** The files from `from` to `head` and their changed lines; `unsized` when the compare may hold some back. */
  changed: (from: string, head: string) => ChangedFile[] | "unsized"
}

/**
 * A commit a Review read, `clean` when it left a success there and not a read mark; `baseOnly` when every
 * change after it is the base's, the head included: only merges of the base, or a rebase past no other
 * read; `baseMoved` when a merge of the base or a rebase came after it.
 */
export type LastRead = { commit: string; clean: boolean; baseOnly: boolean; baseMoved: boolean }

/**
 * The Reviews that left a Finding open since the last review success, a success under off and the dev's
 * acceptance included: `count` their read marks, the head's own among them, and `since` that success's
 * commit, null when no commit read holds one.
 */
export type ReadMarks = { count: number; since: string | null }

/** The Review's standing at the head, as the decision reads it and `pr ship --verbose` shows it. */
export type Standing = {
  /**
   * A read mark force pushes left behind after every read of the history, else the last commit before the
   * head a Review read, else a commit force pushes left behind that one read.
   */
  lastRead: LastRead | null
  /**
   * A read mark whose Findings no later commit answers: the head's own, or one the commits since leave with
   * no fix showing, merges of the base and rebases among them. Then `lastRead` is null and nothing carries
   * (ADR 0023).
   */
  open: string | null
  /** The read marks posted since the last success, on the history and on the commits force pushes left behind. */
  marks: ReadMarks
  /** Whether the head carries the success of `lastRead`, which two compares decide. */
  carried: boolean
  /**
   * The files a Review would read, from `lastRead` or the base to the head, read only for `pr.review:
   * auto` to route on: `unsized` when the compare cannot list them all, null when not read.
   */
  changed: ChangedFile[] | "unsized" | null
  /**
   * The files whose own change moved since `lastRead`, when a merge of the base or a rebase came after it:
   * the files a fix touched, the base's own left out. Null with neither, or when a compare cannot show them.
   */
  scope: string[] | null
}

/** A change as a key, equal exactly when the two changes are. */
function keyOf({ path, status, previous, lines }: OwnChange): string {
  return JSON.stringify([path, status, previous, lines])
}

/** Whether the own changes at the head are those at the reviewed commit; unknown changes never are. */
function sameChanges(then: OwnChange[] | null, now: OwnChange[] | null): boolean {
  if (then === null || now === null) {
    return false
  }
  return JSON.stringify(then.map(keyOf).toSorted()) === JSON.stringify(now.map(keyOf).toSorted())
}

/**
 * The files whose own change differs between `before` and `after`, a rename under both names; null when a
 * compare cannot show either whole.
 */
function movedFiles(before: OwnChange[] | null, after: OwnChange[] | null): string[] | null {
  if (before === null || after === null) {
    return null
  }
  const was = new Set(before.map(keyOf))
  const is = new Set(after.map(keyOf))
  const moved = [
    ...after.filter((change) => !was.has(keyOf(change))),
    ...before.filter((change) => !is.has(keyOf(change)))
  ]
  const names = moved.flatMap(({ path, previous }) => (previous === null ? [path] : [path, previous]))
  return [...new Set(names)].toSorted()
}

/**
 * The last commit before the head a Review read, a success under off passed over, or `open`: a read mark
 * on the head, or one with only merges after it. No fix answers its Findings, so no read stands in.
 */
function lastReadOf({ commits, head }: History): Pick<Standing, "lastRead" | "open"> {
  if (commits.some(({ oid, posted }) => oid === head && posted === "findings")) {
    return { lastRead: null, open: head }
  }
  const index = commits.findLastIndex(
    ({ oid, posted }) => oid !== head && (posted === "clean" || posted === "findings")
  )
  const last = commits[index]
  if (last === undefined) {
    return { lastRead: null, open: null }
  }
  const after = commits.slice(index + 1)
  const baseOnly = after.every(({ merge }) => merge)
  if (last.posted === "findings" && baseOnly) {
    return { lastRead: null, open: last.oid }
  }
  const baseMoved = after.some(({ merge }) => merge)
  return { lastRead: { commit: last.oid, clean: last.posted === "clean", baseOnly, baseMoved }, open: null }
}

/** The newest commit force pushes left behind that a Review read: a rebase moved the base under it. */
function leftBehindRead({ leftBehind }: History): LastRead | null {
  const read = leftBehind.find(({ posted }) => posted === "clean" || posted === "findings")
  return read === undefined
    ? null
    : { commit: read.oid, clean: read.posted === "clean", baseOnly: true, baseMoved: true }
}

/**
 * A read mark a force push left behind and posted after every read of the history: the Review the head
 * needs reads from it, not from the history's last read, whose clean status no longer stands.
 */
function leftBehindMark(history: History): LastRead | null {
  const newest = inPostedOrder(history).findLast(({ posted }) => posted === "clean" || posted === "findings")
  if (newest?.posted !== "findings" || history.commits.some(({ oid }) => oid === newest.oid)) {
    return null
  }
  return { commit: newest.oid, clean: false, baseOnly: true, baseMoved: true }
}

/**
 * The read mark `read` left open, no fix showing after it (ADR 0023): no change since it after the branch's
 * own commits alone, else the same own changes at both commits or a compare that cannot show them whole.
 * Null for any other read.
 */
function openAt(
  read: LastRead | null,
  { changed }: Compares,
  own: (commit: string) => OwnChange[] | null,
  head: string
): string | null {
  if (read === null || read.clean) {
    return null
  }
  if (!read.baseMoved) {
    const since = changed(read.commit, head)
    return since !== "unsized" && since.length === 0 ? read.commit : null
  }
  const atRead = own(read.commit)
  const atHead = own(head)
  return atRead !== null && atHead !== null && !sameChanges(atRead, atHead) ? null : read.commit
}

/** Whether a commit carries a review success of any kind. */
function isSuccess({ posted }: { posted: Posted }): boolean {
  return posted === "clean" || posted === "off"
}

/** How many of `marked` carry a read mark. */
function findings(marked: { posted: Posted }[]): number {
  return marked.filter(({ posted }) => posted === "findings").length
}

/**
 * The commits in the order their review statuses were posted: each line a force push left behind just
 * after the commit of the history it was pushed on, older pushes first, and a line that holds none of
 * the history before all of it.
 */
function inPostedOrder({ commits, leftBehind }: History): { oid: string; posted: Posted }[] {
  const oldestFirst = leftBehind.toReversed()
  const pushedOn = (index: number): LeftBehind[] => oldestFirst.filter(({ forksAt }) => forksAt === index)
  return [...pushedOn(-1), ...commits.flatMap((commit, index) => [commit, ...pushedOn(index)])]
}

/** The read marks posted after the last success, of the history and of the commits force pushes left behind. */
function readMarksOf(history: History): ReadMarks {
  const posted = inPostedOrder(history)
  const success = posted.findLastIndex(isSuccess)
  return { count: findings(posted.slice(success + 1)), since: posted[success]?.oid ?? null }
}

/**
 * The standing at the head of `history`. The compares run only when a Review `awaits` the head, and the
 * files that Review would read are read only when `sized`, as `pr.review: auto` routes on them.
 */
export function standingOf(
  history: History,
  compares: Compares,
  { awaits, sized }: { awaits: boolean; sized: boolean }
): Standing {
  const marks = readMarksOf(history)
  const inHistory = lastReadOf(history)
  const read =
    inHistory.open === null ? (leftBehindMark(history) ?? inHistory.lastRead ?? leftBehindRead(history)) : null
  if (!awaits) {
    return { lastRead: read, open: inHistory.open, marks, carried: false, changed: null, scope: null }
  }
  const { head, base } = history
  const own = (commit: string): OwnChange[] | null => compares.ownChanges(base, commit)
  const open = inHistory.open ?? openAt(read, compares, own, head)
  const lastRead = open === null ? read : null
  const reads = { lastRead, open, marks }
  // A clean read carries over the base's changes alone.
  const carried =
    lastRead !== null && lastRead.clean && lastRead.baseOnly && sameChanges(own(lastRead.commit), own(head))
  if (carried) {
    return { ...reads, carried, changed: null, scope: null }
  }
  const scope = lastRead?.baseMoved === true ? movedFiles(own(lastRead.commit), own(head)) : null
  if (!sized) {
    return { ...reads, carried, changed: null, scope }
  }
  const changed = compares.changed(lastRead?.commit ?? base, head)
  if (scope === null || changed === "unsized") {
    return { ...reads, carried, changed, scope }
  }
  const within = changed.filter(
    ({ path, previous }) => scope.includes(path) || (previous !== null && scope.includes(previous))
  )
  return { ...reads, carried, changed: within, scope }
}

/** Who set the depth: the dev's `--review` for this call, or `pr.review`, a depth or `auto`. */
export type ReviewPolicy = { depth: ReviewDepth; source: "flag" } | { depth: PrReview; source: "config" }
/** Where a Review depth comes from: the dev's word, `pr.review`, or the rules `pr.review: auto` routes by. */
export type DepthSource = "flag" | "config" | "auto"
/** A depth as the answer names it, and under off why no one reads the head. */
export type Depth =
  | { depth: Exclude<ReviewDepth, "off">; source: DepthSource }
  | { depth: "off"; source: DepthSource; why: string }

/**
 * The Review the head gets: the success of the read it carries; a Review at a depth that reads from `since`,
 * kept to `paths`, over the read mark left `open`, where under off the script posts the success; or the park.
 */
export type ReviewCall =
  | { kind: "carry"; from: string }
  | (Depth & { kind: "review"; since: string | null; paths: string[] | null; open: string | null })
  | (ReadMarks & { kind: "limit" })

/** Whether a Finding stands: a read mark since the last success, as the last read, or left open (ADR 0016). */
function findingsOpen({ marks, lastRead, open }: Standing): boolean {
  return marks.count > 0 || lastRead?.clean === false || open !== null
}

/** The depth the head is read at: the dev's or the one `pr.review` sets, else the one the rules route. */
function depthOf({ depth, source }: ReviewPolicy, standing: Standing): Depth {
  if (depth === "off") {
    return { depth, source, why: source === "flag" ? "--review off" : "pr.review" }
  }
  if (depth !== "auto") {
    return { depth, source }
  }
  return { ...route(standing.changed, findingsOpen(standing)), source: "auto" }
}

/** The Review the head gets at `standing` under `review`; the dev's word goes over a carry. */
export function reviewCall(standing: Standing, review: ReviewPolicy): ReviewCall {
  const { lastRead, open, marks, carried, scope } = standing
  const flagged = review.source === "flag"
  if (carried && lastRead !== null && !flagged) {
    return { kind: "carry", from: lastRead.commit }
  }
  const depth = depthOf(review, standing)
  // The dev's own depth buys one Review past the limit, and only one: the flag rides on every
  // later call. Their --review off posts past it: no one reads, by their word.
  const limit = flagged ? REVIEW_LIMIT + 1 : REVIEW_LIMIT
  if (!(flagged && depth.depth === "off") && marks.count >= limit) {
    return { ...marks, kind: "limit" }
  }
  // Over a carry the dev's depth reads the whole diff: the changes after the read are only the base's.
  return { ...depth, kind: "review", since: carried ? null : (lastRead?.commit ?? null), paths: scope, open }
}
