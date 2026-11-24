// The Review state under footprint local, what github posts as dw-sdlc/review and dw-sdlc/gate: per pull
// request `dw-sdlc/reviews/<n>.json`, head to mark, and `dw-sdlc/gates/<n>.json`, the heads the Gate passed
// on, under the common git dir, so a Worker's worktree and the main checkout read one file, none committed.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

import { CannotRun, messageOf } from "../cannot-run.ts"
import { gitDirs } from "../git.ts"
import type { History, Posted } from "./standing.ts"
import { type CiCheck, GATE, type PullRequest, REVIEW } from "./state.ts"

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
  /** The file that holds pull request `number`'s Gate marks. */
  gatesFileOf: (number: number) => string
  /** The heads of pull request `number` the Gate passed on, as `dw-sdlc gate --mark` records them. */
  gatedOf: (number: number) => string[]
  /** Records the Gate mark on `head`, beside the heads already there. */
  recordGate: (number: number, head: string) => void
}

const REMEDY = "fix or delete the file: it holds a JSON object of head shas to clean, findings, off or accepted"
const GATES_REMEDY = "fix or delete the file: it holds a JSON array of the head shas the Gate passed on"

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

function parsed(file: string, remedy: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8"))
  } catch (error) {
    throw new CannotRun(`${file}: ${messageOf(error)}`, remedy)
  }
}

function parseGates(file: string): string[] {
  const heads = parsed(file, GATES_REMEDY)
  if (!Array.isArray(heads) || !heads.every((head) => typeof head === "string")) {
    throw new CannotRun(`${file}: not a JSON array of head shas`, GATES_REMEDY)
  }
  return heads
}

/** Writes `value` to `file` as JSON; a rename replaces the file whole, so a reader never sees half of it. */
function replace(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true })
  const written = `${file}.${process.pid}.tmp`
  writeFileSync(written, `${JSON.stringify(value, null, 2)}\n`)
  renameSync(written, file)
}

function parseMarks(file: string): Marks {
  const read = parsed(file, REMEDY)
  if (typeof read !== "object" || read === null || Array.isArray(read)) {
    throw new CannotRun(`${file}: not a JSON object`, REMEDY)
  }
  const marks: Marks = {}
  for (const [head, mark] of Object.entries(read)) {
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
  const gatesFileOf = (number: number): string => join(dirs.commonDir, "dw-sdlc", "gates", `${number}.json`)
  const marksOf = (number: number): Marks => {
    const file = fileOf(number)
    return existsSync(file) ? parseMarks(file) : {}
  }
  const gatedOf = (number: number): string[] => {
    const file = gatesFileOf(number)
    return existsSync(file) ? parseGates(file) : []
  }
  return {
    fileOf,
    marksOf,
    record: (number, head, mark) => replace(fileOf(number), { ...marksOf(number), [head]: mark }),
    gatesFileOf,
    gatedOf,
    recordGate: (number, head) => {
      const gated = gatedOf(number)
      replace(gatesFileOf(number), gated.includes(head) ? gated : [...gated, head])
    }
  }
}

/** The check the rollup lists for a head's review status: a mark with Findings fails, every other passes. */
function reviewCheck(mark: Mark): CiCheck {
  const bucket = mark === "findings" ? "fail" : "pass"
  return { name: REVIEW, bucket, required: false, link: null, log: null, startedAt: null, unstarted: false }
}

/** The check the rollup lists for a Gate mark on the head. */
const GATE_CHECK: CiCheck = {
  name: GATE,
  bucket: "pass",
  required: false,
  link: null,
  log: null,
  startedAt: null,
  unstarted: false
}

/**
 * The pull request and its history as footprint github would read them had it posted `marks` and the Gate
 * marks on `gated`: each commit's review status from the marks alone, and the head's review status and
 * Gate mark in its checks, any such status GitHub holds dropped.
 */
export function withMarks(
  { pr, history }: { pr: PullRequest; history: History },
  marks: Marks,
  gated: string[] = []
): { pr: PullRequest; history: History } {
  const postedOf = (oid: string): Posted => {
    const mark = marks[oid]
    return mark === undefined ? null : POSTED[mark]
  }
  const head = marks[pr.head]
  const own = pr.checks.filter(({ name }) => name !== REVIEW && name !== GATE)
  const checks = gated.includes(pr.head) ? [...own, GATE_CHECK] : own
  return {
    pr: { ...pr, checks: head === undefined ? checks : [...checks, reviewCheck(head)] },
    history: {
      ...history,
      commits: history.commits.map((commit) => ({ ...commit, posted: postedOf(commit.oid) })),
      leftBehind: history.leftBehind.map((commit) => ({ ...commit, posted: postedOf(commit.oid) }))
    }
  }
}
