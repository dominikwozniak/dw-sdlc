// `file-size-ratchet`: each file of code within the line limit of its group or, listed in the baseline,
// within the count recorded there. A refresh only tightens the baseline: it lowers and drops, and adds no file.

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { dirname, join, matchesGlob } from "node:path"

import { exec } from "../exec.ts"
import { CannotRun, type Check, type Finding } from "./check.ts"
import { matching, treeFiles } from "./tree.ts"

export type Group = { name: string; maxLines: number; files: string[] }
export type FileSizeRatchetOptions = { groups: Group[] }

const BASELINE = ".ai/file-size-ratchet.baseline.json"
const REFRESH = "dw-sdlc gate --update-baseline"

const REMEDIES = {
  record: `record it with ${REFRESH}`,
  shape: `make it an object of file paths and line counts, as ${REFRESH} writes it`,
  twice: "keep one entry for it, the lower count",
  stale: `run ${REFRESH}, which drops it`,
  unreadable: "fix the failures it names"
}

/** A committed baseline gone from the tree: recording a new one would let every grown file back in. */
const DELETED: Finding = {
  file: BASELINE,
  message: "the baseline is committed but gone from the tree",
  remedy: `restore it with git restore ${BASELINE}`
}

/** Each file a group holds, by path: the group and the file's lines. */
type Measured = Map<string, { group: Group; lines: number }>
/** A file the baseline lets stay over its limit: the count it may not pass, and its line in the baseline. */
type Entry = { count: number; line: number | undefined }

type BaselineRead =
  | { state: "missing"; committed: boolean }
  | { state: "invalid"; findings: Finding[] }
  | { state: "valid"; entries: Map<string, Entry> }

function show(value: unknown): string {
  return JSON.stringify(value)
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`
}

function inBaseline(line: number | undefined): Pick<Finding, "file" | "line"> {
  return line === undefined ? { file: BASELINE } : { file: BASELINE, line }
}

/** The first group with a glob that matches `path`. */
function groupOf(path: string, groups: Group[]): Group | undefined {
  return groups.find(({ files }) => files.some((glob) => matchesGlob(path, glob)))
}

/** The lines of `text`, a last line without its newline counted, the empty line after a final newline not. */
function lineCount(text: string): number {
  const lines = text.split("\n").length
  return text.endsWith("\n") ? lines - 1 : lines
}

function measure(root: string, groups: Group[]): Measured {
  const measured: Measured = new Map()
  for (const path of matching(
    root,
    treeFiles(root),
    groups.flatMap(({ files }) => files)
  )) {
    const group = groupOf(path, groups)
    if (group !== undefined && statSync(join(root, path)).isFile()) {
      measured.set(path, { group, lines: lineCount(readFileSync(join(root, path), "utf8")) })
    }
  }
  return measured
}

/** The line of each `"<path>":` key in `text`; JSON keeps only the last of a key it reads twice. */
function keyLines(text: string, path: string): number[] {
  const key = show(path).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return Array.from(text.matchAll(new RegExp(`(?<!\\\\)${key}\\s*:`, "g")), ({ index }) => {
    return text.slice(0, index).split("\n").length
  })
}

function readBaseline(root: string): BaselineRead {
  const path = join(root, BASELINE)
  if (!existsSync(path)) {
    const committed = exec("git", ["-C", root, "cat-file", "-e", `HEAD:${BASELINE}`]).status === 0
    return { state: "missing", committed }
  }
  const text = readFileSync(path, "utf8")
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    const message = `not JSON: ${error instanceof Error ? error.message : String(error)}`
    return { state: "invalid", findings: [{ file: BASELINE, message, remedy: REMEDIES.shape }] }
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { state: "invalid", findings: [{ file: BASELINE, message: "not an object", remedy: REMEDIES.shape }] }
  }
  const findings: Finding[] = []
  const entries = new Map<string, Entry>()
  for (const [file, count] of Object.entries(parsed)) {
    const lines = keyLines(text, file)
    if (lines.length > 1) {
      const times = lines.length === 2 ? "twice" : `${lines.length} times`
      findings.push({ ...inBaseline(lines[1]), message: `lists ${show(file)} ${times}`, remedy: REMEDIES.twice })
    }
    if (typeof count === "number" && Number.isInteger(count) && count >= 1) {
      entries.set(file, { count, line: lines[0] })
    } else {
      const message = `${show(file)} is at ${show(count)}, not a line count`
      findings.push({ ...inBaseline(lines.at(-1)), message, remedy: REMEDIES.shape })
    }
  }
  return findings.length > 0 ? { state: "invalid", findings } : { state: "valid", entries }
}

/** The entries that excuse nothing: a file no group holds, or a count within its group's limit. */
function contradictions(entries: Map<string, Entry>, groups: Group[]): Finding[] {
  const findings: Finding[] = []
  for (const [file, { count, line }] of entries) {
    const group = groupOf(file, groups)
    if (group === undefined) {
      const message = `lists ${show(file)}, which no group holds`
      findings.push({ ...inBaseline(line), message, remedy: REMEDIES.stale })
    } else if (count <= group.maxLines) {
      const message = `lists ${show(file)} at ${count} lines, within the ${group.maxLines}-line limit of the ${group.name} group`
      findings.push({ ...inBaseline(line), message, remedy: REMEDIES.stale })
    }
  }
  return findings
}

function run(root: string, { groups }: FileSizeRatchetOptions): Finding[] {
  const read = readBaseline(root)
  if (read.state === "missing") {
    const missing = { file: BASELINE, message: "the baseline does not exist", remedy: REMEDIES.record }
    throw new CannotRun(read.committed ? DELETED : missing)
  }
  if (read.state === "invalid") {
    return read.findings
  }
  const findings = contradictions(read.entries, groups)
  for (const [file, { group, lines }] of measure(root, groups)) {
    const recorded = read.entries.get(file)?.count
    if (recorded !== undefined && lines > recorded) {
      const message = `${lines} lines, over the ${recorded} the baseline holds it to`
      findings.push({ file, message, remedy: `cut it back to ${recorded} lines or fewer` })
    } else if (recorded === undefined && lines > group.maxLines) {
      const message = `${lines} lines, over the ${group.maxLines}-line limit of the ${group.name} group`
      findings.push({ file, message, remedy: `split it, or cut it to ${group.maxLines} lines` })
    }
  }
  return findings
}

function write(root: string, entries: [string, number][]): void {
  const sorted = entries.toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  mkdirSync(dirname(join(root, BASELINE)), { recursive: true })
  writeFileSync(join(root, BASELINE), `${JSON.stringify(Object.fromEntries(sorted), null, 2)}\n`)
}

/**
 * Records every file over its limit where there is no baseline; else lowers each count that shrank
 * and drops each entry that excuses nothing, adding none.
 */
function refresh(root: string, { groups }: FileSizeRatchetOptions): string {
  const read = readBaseline(root)
  if (read.state === "invalid") {
    throw new CannotRun({
      file: BASELINE,
      message: "it is not a baseline the Ratchet can read",
      remedy: REMEDIES.unreadable
    })
  }
  if (read.state === "missing" && read.committed) {
    throw new CannotRun(DELETED)
  }
  const measured = measure(root, groups)
  if (read.state === "missing") {
    const over = [...measured].filter(([, { group, lines }]) => lines > group.maxLines)
    write(
      root,
      over.map(([file, { lines }]) => [file, lines])
    )
    return `recorded — ${plural(over.length, "file")} over ${over.length === 1 ? "its" : "their"} limit`
  }
  const kept: [string, number][] = []
  let dropped = 0
  let lowered = 0
  for (const [file, { count }] of read.entries) {
    const now = measured.get(file)
    const tighter = now === undefined ? 0 : Math.min(now.lines, count)
    if (now === undefined || tighter <= now.group.maxLines) {
      dropped += 1
    } else {
      lowered += tighter < count ? 1 : 0
      kept.push([file, tighter])
    }
  }
  if (dropped === 0 && lowered === 0) {
    return "unchanged"
  }
  write(root, kept)
  const parts = [
    ...(dropped > 0 ? [`${plural(dropped, "file")} dropped`] : []),
    ...(lowered > 0 ? [`${plural(lowered, "count")} lowered`] : [])
  ]
  return `tightened — ${parts.join(", ")}`
}

const TESTS = ["**/{test,tests,__tests__}/**", "**/*.{test,spec}.*"]
const SOURCE = ["**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs,sh}"]

export const fileSizeRatchet: Check<FileSizeRatchetOptions> = {
  name: "file-size-ratchet",
  defaults: {
    groups: [
      { name: "tests", maxLines: 2000, files: TESTS },
      { name: "source", maxLines: 500, files: SOURCE }
    ]
  },
  run,
  baseline: { file: BASELINE, refresh }
}
