// `decision-records`: the decisions directory stays a reliable index. Its records, the files named
// `<number>-<slug>.md`, are numbered from 1 with no gap and no number taken twice, and each has a title,
// a frontmatter status from the allowed set and the frontmatter fields the config turns on.

import { existsSync, readFileSync, statSync } from "node:fs"
import { join, matchesGlob, posix } from "node:path"

import { type FrontmatterEntry, frontmatter, frontmatterList, headings } from "../markdown.ts"
import { CannotRun, type Check, type Finding } from "./check.ts"
import { directoriesOf, treeFiles } from "./tree.ts"

/** The frontmatter fields beyond `status` a record can be held to, in the order they are judged. */
const FIELDS = ["date", "touches", "superseded-by", "amended-by"] as const

export type DecisionField = (typeof FIELDS)[number]

export type DecisionRecordsOptions = { dirs: string[]; statuses: string[]; fields: DecisionField[] }

/** The files git tracks or would track, and every path a file or a directory of them has. */
type Tree = { files: string[]; paths: Set<string> }

/** A record as its fields are judged: its file, `state` the first word of its status, its frontmatter. */
type DecisionRecord = { file: string; state: string; keys: Map<string, FrontmatterEntry> }

/** What a record's fields are judged against: the repository, its tree, the numbers the directory's records take. */
type Context = { root: string; tree: () => Tree; numbers: Set<number> }

/** A record's name in its directory: its number, a slug, `.md`, and no directory between. */
const RECORD = /^(\d+)-[^/]+\.md$/

/** The first words of a status that put a record in force, so it governs the paths under its `touches`. */
const IN_FORCE = new Set(["accepted", "active"])

/** The first words of a status that say a record once governed and no longer does. */
export const OUT_OF_FORCE = new Set(["deprecated", "superseded"])

/** A character that makes a path under `touches` a glob. */
const GLOB = /[*?[\]{}]/

const REMEDIES = {
  missing: "create the records directory, or point gate.checks.decision-records.dirs at it",
  gap: "restore the missing records, or renumber the ones after the gap",
  taken: "give each record a number of its own",
  title: "start it with a level-1 heading that names the decision",
  noDate: "give its frontmatter the day the decision was made, as date: YYYY-MM-DD",
  date: "write the day the decision was made as YYYY-MM-DD",
  noTouches: "list under touches the paths it governs",
  superseded: "drop touches: the record that replaces it governs those paths",
  path: "fix the path or drop it from touches",
  glob: "fix the glob or drop it from touches",
  ignored: "name the paths git tracks that it governs, or drop it from touches",
  noSuccessor: "name under superseded-by the number of each record that replaces it",
  successor: "name the number of each record that replaces it",
  amendment: "name the number of each record that amends it"
}

function isDirectory(path: string): boolean {
  return statSync(path, { throwIfNoEntry: false })?.isDirectory() === true
}

/**
 * The `status` of the frontmatter `text` opens with, its quotes dropped, and its 1-based line. It keeps a
 * reader apart from `frontmatter`, which a status never goes through: a ` #` is part of it.
 */
export function statusOf(text: string): { value: string; line: number } | undefined {
  const lines = text.split("\n")
  if (lines[0]?.trim() !== "---") {
    return undefined
  }
  for (let index = 1; index < lines.length && lines[index]?.trim() !== "---"; index++) {
    const value = /^status:\s*(.*?)\s*$/.exec(lines[index] ?? "")?.[1]?.replace(/^(["'])(.*)\1$/, "$2")
    if (value !== undefined && value !== "") {
      return { value, line: index + 1 }
    }
  }
  return undefined
}

/** Whether `value` is a day of the calendar written `YYYY-MM-DD`. */
function isDay(value: string): boolean {
  const date = new Date(`${value}T00:00:00Z`)
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value)
}

/**
 * The status of the decision record `path` names, whole, or "" when it has none; undefined when `path` is
 * no record of `dirs` or is not on disk. A record is a file `<number>-<slug>.md` directly under a directory.
 */
export function recordStatus(root: string, dirs: string[], path: string): string | undefined {
  const inDirs = dirs.some((dir) => {
    const prefix = `${dir.replace(/\/+$/, "")}/`
    return path.startsWith(prefix) && RECORD.test(path.slice(prefix.length))
  })
  const file = join(root, path)
  return inDirs && existsSync(file) ? (statusOf(readFileSync(file, "utf8"))?.value ?? "") : undefined
}

function judgeDate({ file, keys }: DecisionRecord): Finding[] {
  const date = keys.get("date")
  if (date === undefined || date.value === "") {
    return [{ file, message: "has no date", remedy: REMEDIES.noDate }]
  }
  if (!isDay(date.value)) {
    const message = `the date ${JSON.stringify(date.value)} is not a YYYY-MM-DD day`
    return [{ file, line: date.line, message, remedy: REMEDIES.date }]
  }
  return []
}

function judgeTouches({ file, state, keys }: DecisionRecord, { root, tree }: Context): Finding[] {
  const touches = keys.get("touches")
  const paths = frontmatterList(touches)
  if (state === "superseded") {
    if (touches === undefined || paths.length === 0) {
      return []
    }
    return [{ file, line: touches.line, message: "is superseded and still names touches", remedy: REMEDIES.superseded }]
  }
  if (paths.length === 0) {
    return IN_FORCE.has(state) ? [{ file, message: "names no path under touches", remedy: REMEDIES.noTouches }] : []
  }
  return paths.flatMap(({ value, line }): Finding[] => {
    const path = posix.normalize(value).replace(/(.)\/$/, "$1")
    const glob = GLOB.test(path)
    if (tree().paths.has(path) || (glob && tree().files.some((candidate) => matchesGlob(candidate, path)))) {
      return []
    }
    const quoted = JSON.stringify(value)
    if (path !== ".." && !path.startsWith("../") && existsSync(join(root, path))) {
      return [{ file, line, message: `touches ${quoted}, which git ignores`, remedy: REMEDIES.ignored }]
    }
    return glob
      ? [{ file, line, message: `touches ${quoted}, which matches no file`, remedy: REMEDIES.glob }]
      : [{ file, line, message: `touches ${quoted}, which does not exist`, remedy: REMEDIES.path }]
  })
}

/** Each value under the list key `name` of a record that is not the number of a record of its directory. */
function judgeNumbers(
  name: DecisionField,
  remedy: string,
  { file, keys }: DecisionRecord,
  numbers: Set<number>
): Finding[] {
  return frontmatterList(keys.get(name)).flatMap(({ value, line }): Finding[] => {
    if (/^\d+$/.test(value) && numbers.has(Number(value))) {
      return []
    }
    const message = `${name} names ${JSON.stringify(value)}, which is not the number of a record`
    return [{ file, line, message, remedy }]
  })
}

function judgeSuccessors(record: DecisionRecord, { numbers }: Context): Finding[] {
  if (record.state === "superseded" && frontmatterList(record.keys.get("superseded-by")).length === 0) {
    const message = "is superseded but names no successor under superseded-by"
    return [{ file: record.file, message, remedy: REMEDIES.noSuccessor }]
  }
  return judgeNumbers("superseded-by", REMEDIES.successor, record, numbers)
}

function judgeAmendments(record: DecisionRecord, { numbers }: Context): Finding[] {
  return judgeNumbers("amended-by", REMEDIES.amendment, record, numbers)
}

/** What is wrong with each field of a record, when the config turns that field on. */
const RULES: Record<DecisionField, (record: DecisionRecord, context: Context) => Finding[]> = {
  date: judgeDate,
  touches: judgeTouches,
  "superseded-by": judgeSuccessors,
  "amended-by": judgeAmendments
}

/** Each run of numbers from 1 to the highest that no record takes, as `0004` or `0004 to 0006`. */
function gaps(taken: Set<number>, pad: (number: number) => string): string[] {
  const runs: string[] = []
  const highest = Math.max(0, ...taken)
  let start: number | undefined
  for (let number = 1; number <= highest; number++) {
    if (!taken.has(number)) {
      start ??= number
    } else if (start !== undefined) {
      runs.push(start === number - 1 ? pad(start) : `${pad(start)} to ${pad(number - 1)}`)
      start = undefined
    }
  }
  return runs
}

/** What is wrong with the records of `dir`: the numbers they skip, then each record's number, title, status and fields. */
function judge(root: string, dir: string, { statuses, fields }: DecisionRecordsOptions, tree: () => Tree): Finding[] {
  const prefix = `${dir.replace(/\/+$/, "")}/`
  const records = treeFiles(root, [dir])
    .map((file) => ({ file, name: file.slice(prefix.length) }))
    .filter(({ name }) => RECORD.test(name))
    .map(({ file, name }) => ({ file, digits: RECORD.exec(name)?.[1] ?? "" }))
  const width = records[0]?.digits.length ?? 4
  const pad = (number: number) => String(number).padStart(width, "0")
  const owners = new Map<number, string>()
  for (const { file, digits } of records) {
    if (!owners.has(Number(digits))) {
      owners.set(Number(digits), file)
    }
  }
  const findings: Finding[] = gaps(new Set(owners.keys()), pad).map((gap) => ({
    file: dir,
    message: `no record is numbered ${gap}`,
    remedy: REMEDIES.gap
  }))
  const allowed = `one of ${statuses.join(", ")}`
  const context: Context = { root, tree, numbers: new Set(owners.keys()) }
  const judgedFields = FIELDS.filter((field) => fields.includes(field))
  for (const { file, digits } of records) {
    const owner = owners.get(Number(digits))
    if (owner !== file) {
      findings.push({ file, message: `${digits} is taken by ${owner}`, remedy: REMEDIES.taken })
    }
    const text = readFileSync(join(root, file), "utf8")
    if (!headings(text).some(({ level, text: title }) => level === 1 && title.trim() !== "")) {
      findings.push({ file, message: "has no title", remedy: REMEDIES.title })
    }
    const status = statusOf(text)
    const state = status?.value.split(/\s+/)[0] ?? ""
    if (status === undefined) {
      findings.push({ file, message: "has no status", remedy: `give its frontmatter a status, ${allowed}` })
    } else if (!statuses.includes(state)) {
      const message = `the status ${JSON.stringify(status.value)} is not allowed`
      findings.push({ file, line: status.line, message, remedy: `set it to ${allowed}` })
    }
    if (judgedFields.length > 0) {
      const record: DecisionRecord = { file, state, keys: frontmatter(text) }
      findings.push(...judgedFields.flatMap((field) => RULES[field](record, context)))
    }
  }
  return findings
}

function run(root: string, options: DecisionRecordsOptions): Finding[] {
  const present = options.dirs.filter((dir) => isDirectory(join(root, dir)))
  if (present.length === 0) {
    throw new CannotRun({ message: `none of ${options.dirs.join(", ")} exists`, remedy: REMEDIES.missing })
  }
  let cached: Tree | undefined
  const tree = (): Tree => {
    if (cached === undefined) {
      const files = treeFiles(root)
      cached = { files, paths: new Set([...files, ...directoriesOf(files)]) }
    }
    return cached
  }
  return present.flatMap((dir) => judge(root, dir, options, tree))
}

export const decisionRecords: Check<DecisionRecordsOptions> = {
  name: "decision-records",
  defaults: {
    dirs: ["docs/adr", "docs/decisions"],
    statuses: ["proposed", "accepted", "active", "deprecated", "superseded"],
    fields: []
  },
  run
}
