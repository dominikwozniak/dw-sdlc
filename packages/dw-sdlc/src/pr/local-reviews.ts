// The Review state under footprint local: what footprint github posts as the dw-sdlc/review status, kept as
// one file per pull request under the git dir, `dw-sdlc/reviews/<n>.json`, a map of head to mark. The common
// git dir, so a Worker's worktree and the main checkout read one file, and nothing under it is committed.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

import { CannotRun, messageOf } from "../cannot-run.ts"
import { gitDirs } from "../git.ts"
import type { History, Posted } from "./standing.ts"
import { type CiCheck, type PullRequest, REVIEW } from "./state.ts"

/**
 * What a Review left on a head: `clean` a clean Review or a carry, `findings` the read mark, `off` a head
 * no one read under off, `accepted` the dev's acceptance with Findings open.
 */
export const MARKS = ["clean", "findings", "off", "accepted"] as const
export type Mark = (typeof MARKS)[number]
export type Marks = Record<string, Mark>

/** The Review state of one checkout's pull requests, by number. */
export type LocalReviews = {
  /** The file that holds pull request `number`'s marks. */
  fileOf: (number: number) => string
  marksOf: (number: number) => Marks
  /** Records `mark` on `head`, beside the marks already there. */
  record: (number: number, head: string, mark: Mark) => void
}

const REMEDY = "fix or delete the file: it holds a JSON object of head shas to clean, findings, off or accepted"

/** What the standing reads of a mark: the dev's acceptance counts as a success, as its status does. */
const POSTED: Record<Mark, Exclude<Posted, null>> = {
  clean: "clean",
  findings: "findings",
  off: "off",
  accepted: "clean"
}

function isMark(value: unknown): value is Mark {
  return MARKS.some((mark) => mark === value)
}

function parseMarks(file: string): Marks {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"))
  } catch (error) {
    throw new CannotRun(`${file}: ${messageOf(error)}`, REMEDY)
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new CannotRun(`${file}: not a JSON object`, REMEDY)
  }
  const marks: Marks = {}
  for (const [head, mark] of Object.entries(parsed)) {
    if (!isMark(mark)) {
      throw new CannotRun(`${file}: ${head} holds ${JSON.stringify(mark)}`, REMEDY)
    }
    marks[head] = mark
  }
  return marks
}

/** The Review state of the repository holding `root`, under its common git dir. */
export function localReviews(root: string): LocalReviews {
  const dirs = gitDirs(root)
  if (dirs === undefined) {
    throw new CannotRun(`${root} is in no git repository`, "run it from a checkout of the repository")
  }
  const fileOf = (number: number): string => join(dirs.commonDir, "dw-sdlc", "reviews", `${number}.json`)
  const marksOf = (number: number): Marks => {
    const file = fileOf(number)
    return existsSync(file) ? parseMarks(file) : {}
  }
  return {
    fileOf,
    marksOf,
    record: (number, head, mark) => {
      const file = fileOf(number)
      const next = { ...marksOf(number), [head]: mark }
      mkdirSync(dirname(file), { recursive: true })
      // A rename replaces the file whole, so a reader never sees half of it.
      const written = `${file}.${process.pid}.tmp`
      writeFileSync(written, `${JSON.stringify(next, null, 2)}\n`)
      renameSync(written, file)
    }
  }
}

/** The check the rollup lists for a head's review status: a mark with Findings fails, every other passes. */
function reviewCheck(mark: Mark): CiCheck {
  const bucket = mark === "findings" ? "fail" : "pass"
  return { name: REVIEW, bucket, required: false, link: null, log: null, startedAt: null }
}

/**
 * The pull request and its history as footprint github would read them had it posted `marks`: each commit's
 * review status from the marks alone, and the head's in its checks, any status GitHub holds dropped.
 */
export function withMarks(
  { pr, history }: { pr: PullRequest; history: History },
  marks: Marks
): { pr: PullRequest; history: History } {
  const postedOf = (oid: string): Posted => {
    const mark = marks[oid]
    return mark === undefined ? null : POSTED[mark]
  }
  const head = marks[pr.head]
  const checks = pr.checks.filter(({ name }) => name !== REVIEW)
  return {
    pr: { ...pr, checks: head === undefined ? checks : [...checks, reviewCheck(head)] },
    history: {
      ...history,
      commits: history.commits.map((commit) => ({ ...commit, posted: postedOf(commit.oid) })),
      leftBehind: history.leftBehind.map((commit) => ({ ...commit, posted: postedOf(commit.oid) }))
    }
  }
}
