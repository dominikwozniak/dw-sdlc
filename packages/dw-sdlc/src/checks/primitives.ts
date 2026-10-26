// `primitives`: the catalogue says what is true of the tree. Unique ids, a known group, a one-line
// summary, every code and docs path on disk with its anchor resolving, and every file under the roots
// named by a Primitive.

import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { type Catalogue, CATALOGUE_FILE, type Primitive, primitivesNaming, readCatalogue } from "../catalogue.ts"
import { headings } from "../markdown.ts"
import { CannotRun, type Check, type Finding, optionsOf } from "./check.ts"

export type PrimitivesOptions = { file: string; roots: string[] }

const MAX_SUMMARY = 120
/** A file a test runs, never shipped: under a test directory, or named as a test. */
const TEST_FILE = /(^|\/)(test|tests|__tests__)\/|\.(test|spec)\.[^/]+$/

const REMEDIES = {
  missing: "create it, or point gate.checks.primitives.file at the catalogue",
  shape:
    "give it the catalogue's shape: version 1, groups of id and name, primitives of id, name, group, summary, code and docs",
  duplicate: "give each Primitive an id of its own",
  group: "add the group to groups, or move the Primitive into one listed there",
  summary: `keep the summary to one line of ${MAX_SUMMARY} characters or fewer`,
  path: "fix the path or drop it",
  anchor: "point the entry at a heading the file has",
  notGit: "run the Gate inside a git repository"
}

function show(value: string): string {
  return JSON.stringify(value)
}

/** The line of the `nth` (0-based) `"id": "<id>"` in `text`, where the catalogue declares a Primitive. */
function lineOf(text: string, id: string, nth: number): number | undefined {
  const pattern = new RegExp(`"id"\\s*:\\s*${JSON.stringify(id).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "g")
  const match = Array.from(text.matchAll(pattern))[nth]
  return match?.index === undefined ? undefined : text.slice(0, match.index).split("\n").length
}

/** The anchors of each markdown file read so far, by path. */
type Anchors = Map<string, Set<string>>

function anchorsOf(root: string, path: string, cache: Anchors): Set<string> {
  let anchors = cache.get(path)
  if (anchors === undefined) {
    anchors = new Set(headings(readFileSync(join(root, path), "utf8")).map(({ anchor }) => anchor))
    cache.set(path, anchors)
  }
  return anchors
}

type Problem = { message: string; remedy: string }

/** What is wrong with one Primitive: its group, its summary, each code and docs entry. */
function judge(root: string, catalogue: Catalogue, primitive: Primitive, cache: Anchors): Problem[] {
  const { id, group, summary, code, docs } = primitive
  const problems: Problem[] = []
  if (!catalogue.groups.some((known) => known.id === group)) {
    problems.push({
      message: `${show(id)} is in group ${show(group)}, which groups does not list`,
      remedy: REMEDIES.group
    })
  }
  const summaryLines = summary.split("\n").length
  if (summaryLines > 1) {
    problems.push({ message: `the summary of ${show(id)} runs over ${summaryLines} lines`, remedy: REMEDIES.summary })
  } else if ([...summary].length > MAX_SUMMARY) {
    problems.push({
      message: `the summary of ${show(id)} is ${[...summary].length} characters, over ${MAX_SUMMARY}`,
      remedy: REMEDIES.summary
    })
  }
  for (const entry of code) {
    if (!existsSync(join(root, entry))) {
      problems.push({
        message: `${show(id)} names code at ${show(entry)}, which does not exist`,
        remedy: REMEDIES.path
      })
    }
  }
  for (const entry of docs) {
    const [path = "", anchor] = entry.split("#", 2)
    if (!existsSync(join(root, path))) {
      problems.push({
        message: `${show(id)} names the doc ${show(entry)}, which does not exist`,
        remedy: REMEDIES.path
      })
    } else if (anchor !== undefined && !anchorsOf(root, path, cache).has(anchor)) {
      problems.push({
        message: `${show(id)} names the doc ${show(entry)}, which has no heading with that anchor`,
        remedy: REMEDIES.anchor
      })
    }
  }
  return problems
}

/** Every file under `roots` that git tracks or would track, and that is on disk. */
function filesUnder(root: string, roots: string[]): string[] {
  const args = ["-C", root, "ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ...roots]
  const listed = spawnSync("git", args, { encoding: "utf8" })
  if (listed.status !== 0) {
    throw new CannotRun({
      message: `cannot list the files under ${roots.join(", ")}: not a git repository`,
      remedy: REMEDIES.notGit
    })
  }
  return [...new Set(listed.stdout.split("\0").filter((path) => path !== ""))]
    .filter((path) => existsSync(join(root, path)))
    .toSorted()
}

function run(root: string, { file, roots }: PrimitivesOptions): Finding[] {
  const read = readCatalogue(root, file)
  if (read.state === "missing") {
    throw new CannotRun({ file, message: "the catalogue does not exist", remedy: REMEDIES.missing })
  }
  if (read.state === "invalid") {
    return read.problems.map((message) => ({ file, message, remedy: REMEDIES.shape }))
  }
  const { catalogue, text } = read
  const findings: Finding[] = []
  const seen = new Map<string, number>()
  const cache: Anchors = new Map()
  for (const primitive of catalogue.primitives) {
    const nth = seen.get(primitive.id) ?? 0
    seen.set(primitive.id, nth + 1)
    const line = lineOf(text, primitive.id, nth)
    const at = line === undefined ? { file } : { file, line }
    if (nth > 0) {
      findings.push({
        ...at,
        message: `id ${show(primitive.id)} is taken by an earlier Primitive`,
        remedy: REMEDIES.duplicate
      })
    }
    findings.push(...judge(root, catalogue, primitive, cache).map((problem) => ({ ...at, ...problem })))
  }
  for (const path of filesUnder(root, roots)) {
    if (!TEST_FILE.test(path) && primitivesNaming(catalogue, path).length === 0) {
      const remedy = `name it, or a directory above it, in the code of a Primitive in ${file}`
      findings.push({ file: path, message: "no Primitive names this file", remedy })
    }
  }
  return findings
}

export const primitives: Check<PrimitivesOptions> = {
  name: "primitives",
  defaults: { file: CATALOGUE_FILE, roots: ["packages", "plugins", "scripts", "src"] },
  run
}

/** The catalogue a resolved `gate.checks` points at: the `primitives` Check's file, on or off. */
export function catalogueFile(checks: Record<string, unknown>): string {
  return (optionsOf(primitives, checks.primitives) ?? primitives.defaults).file
}
