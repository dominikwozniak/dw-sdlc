// `routed-docs`: a task leads an agent to every document that explains it. Each document is reached by
// a Task Router row of the agent map, through a path, a directory above it or a glob, or by the docs of
// a Primitive in the catalogue. It reads the file list, the Task Router and the catalogue, never prose.

import { existsSync, readFileSync } from "node:fs"
import { join, matchesGlob, posix } from "node:path"

import { resolveConfig } from "../agentic-config.ts"
import { readCatalogue } from "../catalogue.ts"
import { mapFile, routes } from "./agents-map.ts"
import { CannotRun, type Check, type Finding } from "./check.ts"
import { catalogueFile } from "./primitives.ts"
import { matching, treeFiles } from "./tree.ts"

export type RoutedDocsOptions = { files: string[]; exempt: string[] }

const REMEDIES = {
  missing: "write it, or point gate.checks.agents-map.file at the map",
  table: "add a Task Router section whose table names the docs",
  unreached: "add a Task Router row, name it in a Primitive's docs, or exempt it"
}

/** Whether the path a row points at names `doc`, a directory above it or a glob that matches it. */
function reaches(path: string, doc: string): boolean {
  const target = posix.normalize(path).replace(/\/+$/, "")
  return target.includes("*") ? matchesGlob(doc, target) : doc === target || doc.startsWith(`${target}/`)
}

/** The docs the Primitives of the catalogue name, each without its heading anchor; none when it cannot be read. */
function catalogued(root: string, file: string): Set<string> {
  const read = readCatalogue(root, file)
  if (read.state !== "valid") {
    return new Set()
  }
  return new Set(read.catalogue.primitives.flatMap(({ docs }) => docs.map((entry) => entry.split("#", 1)[0] ?? "")))
}

function run(root: string, { files, exempt }: RoutedDocsOptions): Finding[] {
  const { checks } = resolveConfig(root).config.gate
  const map = mapFile(checks)
  const path = join(root, map)
  if (!existsSync(path)) {
    throw new CannotRun({ file: map, message: "the map does not exist", remedy: REMEDIES.missing })
  }
  const rows = routes(readFileSync(path, "utf8"))
  const findings: Finding[] = []
  if (rows.length === 0) {
    findings.push({ file: map, message: "has no Task Router table to reach a doc from", remedy: REMEDIES.table })
  }
  const paths = rows.flatMap((row) => row.paths)
  const named = catalogued(root, catalogueFile(checks))
  for (const doc of matching(root, treeFiles(root), files, exempt)) {
    if (!named.has(doc) && !paths.some((target) => reaches(target, doc))) {
      findings.push({ file: doc, message: "no Task Router row or Primitive reaches it", remedy: REMEDIES.unreached })
    }
  }
  return findings
}

export const routedDocs: Check<RoutedDocsOptions> = {
  name: "routed-docs",
  defaults: { files: ["docs/**/*.md"], exempt: ["docs/research/**"] },
  run
}
