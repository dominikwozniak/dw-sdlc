// `primitives`: the catalogue says what is true of the tree. Unique ids, a known group, a one-line
// summary, every code and docs path on disk with its anchor resolving, and every file under the roots
// named by a Primitive.

import { existsSync } from "node:fs"
import { join } from "node:path"

import { type Catalogue, CATALOGUE_FILE, type Primitive, primitivesNaming, readCatalogue } from "../catalogue.ts"
import { type Anchors, anchorsOf } from "../markdown.ts"
import { CannotRun, type Check, type Finding, optionsOf } from "./check.ts"
import { treeFiles } from "./tree.ts"

export type PrimitivesOptions = { file: string; roots: string[] }
/** Where in the catalogue a Primitive is declared. */
type Location = Pick<Finding, "file" | "line">

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
  anchor: "point the entry at a heading the file has"
}

function show(value: string): string {
  return JSON.stringify(value)
}

/** The line of the `nth` (0-based) `"id": "<id>"` under the `primitives` key, where a Primitive is declared. */
function lineOf(text: string, id: string, nth: number): number | undefined {
  const start = Math.max(0, text.indexOf('"primitives"'))
  const pattern = new RegExp(`"id"\\s*:\\s*${JSON.stringify(id).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "g")
  const match = Array.from(text.slice(start).matchAll(pattern))[nth]
  return match?.index === undefined ? undefined : text.slice(0, start + match.index).split("\n").length
}

/** What is wrong with one Primitive, declared at `at`: its group, its summary, each code and docs entry. */
function judge(root: string, catalogue: Catalogue, primitive: Primitive, at: Location, cache: Anchors): Finding[] {
  const { id, group, summary, code, docs } = primitive
  const findings: Finding[] = []
  const fail = (message: string, remedy: string) => findings.push({ ...at, message, remedy })
  if (!catalogue.groups.some((known) => known.id === group)) {
    fail(`${show(id)} is in group ${show(group)}, which groups does not list`, REMEDIES.group)
  }
  const summaryLines = summary.split("\n").length
  if (summaryLines > 1) {
    fail(`the summary of ${show(id)} runs over ${summaryLines} lines`, REMEDIES.summary)
  } else if ([...summary].length > MAX_SUMMARY) {
    fail(`the summary of ${show(id)} is ${[...summary].length} characters, over ${MAX_SUMMARY}`, REMEDIES.summary)
  }
  for (const entry of code.filter((path) => !existsSync(join(root, path)))) {
    fail(`${show(id)} names code at ${show(entry)}, which does not exist`, REMEDIES.path)
  }
  for (const entry of docs) {
    const [path = "", anchor] = entry.split("#", 2)
    if (!existsSync(join(root, path))) {
      fail(`${show(id)} names the doc ${show(entry)}, which does not exist`, REMEDIES.path)
    } else if (anchor !== undefined && !anchorsOf(root, path, cache).has(anchor)) {
      fail(`${show(id)} names the doc ${show(entry)}, which has no heading with that anchor`, REMEDIES.anchor)
    }
  }
  return findings
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
    const at: Location = line === undefined ? { file } : { file, line }
    if (nth > 0) {
      findings.push({
        ...at,
        message: `id ${show(primitive.id)} is taken by an earlier Primitive`,
        remedy: REMEDIES.duplicate
      })
    }
    findings.push(...judge(root, catalogue, primitive, at, cache))
  }
  for (const path of treeFiles(root, roots)) {
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
