// `decision-records`: the decisions directory stays a reliable index. Its records, the files named
// `<number>-<slug>.md`, are numbered from 1 with no gap and no number taken twice, and each has a title
// and a frontmatter status from the allowed set.

import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

import { headings } from "../markdown.ts"
import { CannotRun, type Check, type Finding } from "./check.ts"

export type DecisionRecordsOptions = { dirs: string[]; statuses: string[] }

const RECORD = /^(\d+)-.+\.md$/

const REMEDIES = {
  missing: "create the records directory, or point gate.checks.decision-records.dirs at it",
  gap: "restore the missing records, or renumber the ones after the gap",
  taken: "give each record a number of its own",
  title: "start it with a level-1 heading that names the decision"
}

function isDirectory(path: string): boolean {
  return statSync(path, { throwIfNoEntry: false })?.isDirectory() === true
}

/** The `status` of the frontmatter `text` opens with, its quotes dropped, and its 1-based line. */
function statusOf(text: string): { value: string; line: number } | undefined {
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

/** What is wrong with the records of `dir`: the numbers they skip, then each record's number, title and status. */
function judge(root: string, dir: string, statuses: string[]): Finding[] {
  const records = readdirSync(join(root, dir))
    .filter((name) => RECORD.test(name) && statSync(join(root, dir, name)).isFile())
    .toSorted()
    .map((name) => ({ file: `${dir}/${name}`, digits: RECORD.exec(name)?.[1] ?? "" }))
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
    if (status === undefined) {
      findings.push({ file, message: "has no status", remedy: `give its frontmatter a status, ${allowed}` })
    } else if (!statuses.includes(status.value.split(/\s+/)[0] ?? "")) {
      const message = `the status ${JSON.stringify(status.value)} is not allowed`
      findings.push({ file, line: status.line, message, remedy: `set it to ${allowed}` })
    }
  }
  return findings
}

function run(root: string, { dirs, statuses }: DecisionRecordsOptions): Finding[] {
  const present = dirs.filter((dir) => isDirectory(join(root, dir)))
  if (present.length === 0) {
    throw new CannotRun({ message: `none of ${dirs.join(", ")} exists`, remedy: REMEDIES.missing })
  }
  return present.flatMap((dir) => judge(root, dir, statuses))
}

export const decisionRecords: Check<DecisionRecordsOptions> = {
  name: "decision-records",
  defaults: {
    dirs: ["docs/adr", "docs/decisions"],
    statuses: ["proposed", "accepted", "active", "deprecated", "superseded"]
  },
  run
}
