// The Gate marks under footprint local, what github posts as dw-sdlc/gate: per pull request
// `dw-sdlc/gates/<n>.json`, the heads the Gate passed on, under the common git dir, so a Worker's worktree
// and the main checkout read one file, none committed.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

import { CannotRun, messageOf } from "../cannot-run.ts"
import { gitDirs } from "../git.ts"
import { type CiCheck, GATE, type PrState } from "./state.ts"

/** The Gate marks of one checkout's pull requests, by number. */
export type GateMarks = {
  /** The file that holds pull request `number`'s Gate marks. */
  fileOf: (number: number) => string
  /** The heads of pull request `number` the Gate passed on, as `dw-sdlc gate --mark` records them. */
  headsOf: (number: number) => string[]
  /** Records the Gate mark on `head`, beside the heads already there. */
  record: (number: number, head: string) => void
}

const REMEDY = "fix or delete the file: it holds a JSON array of the head shas the Gate passed on"

function parseHeads(file: string): string[] {
  let heads: unknown
  try {
    heads = JSON.parse(readFileSync(file, "utf8"))
  } catch (error) {
    throw new CannotRun(`${file}: ${messageOf(error)}`, REMEDY)
  }
  if (!Array.isArray(heads) || !heads.every((head) => typeof head === "string")) {
    throw new CannotRun(`${file}: not a JSON array of head shas`, REMEDY)
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

/** The Gate marks of the repository holding `root`, under its common git dir. */
export function gateMarks(root: string): GateMarks {
  const dirs = gitDirs(root)
  if (dirs === undefined) {
    throw new CannotRun(`${root} is in no git repository`, "run it from a checkout of the repository")
  }
  const fileOf = (number: number): string => join(dirs.commonDir, "dw-sdlc", "gates", `${number}.json`)
  const headsOf = (number: number): string[] => {
    const file = fileOf(number)
    return existsSync(file) ? parseHeads(file) : []
  }
  return {
    fileOf,
    headsOf,
    record: (number, head) => {
      const gated = headsOf(number)
      replace(fileOf(number), gated.includes(head) ? gated : [...gated, head])
    }
  }
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
 * The pull request as footprint github would read it had it posted a Gate mark on every head of `gated`:
 * the Gate mark in the head's checks, any `dw-sdlc/gate` status GitHub holds dropped.
 */
export function withGateMarks(pr: PrState, gated: string[]): PrState {
  const marked = (oid: string, checks: CiCheck[]): CiCheck[] => {
    const own = checks.filter(({ name }) => name !== GATE)
    return gated.includes(oid) ? [...own, GATE_CHECK] : own
  }
  return {
    ...pr,
    checks: marked(pr.head, pr.checks),
    ciHistory: pr.ciHistory.map(({ oid, checks }) => ({ oid, checks: marked(oid, checks) }))
  }
}
