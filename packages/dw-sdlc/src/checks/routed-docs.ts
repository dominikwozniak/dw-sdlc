// `routed-docs`: a task leads an agent to every document that explains it. Each document is reached by
// a Task Router row of the agent map, through a path, a directory above it or a glob, or by the docs of
// a Primitive in the catalogue. It reads the file list, the Task Router and the catalogue, never prose.

import { matchesGlob, posix } from "node:path"

import { resolveConfig } from "../agentic-config.ts"
import { readCatalogue } from "../catalogue.ts"
import { mapFile, readMap, routes } from "./agents-map.ts"
import type { Check, Finding } from "./check.ts"
import { catalogueFile } from "./primitives.ts"
import { matching, treeFiles } from "./tree.ts"

export type RoutedDocsOptions = { files: string[]; exempt: string[] }

const REMEDIES = {
  table: "add a Task Router section whose table names the docs",
  unreached: "add a Task Router row, name it in a Primitive's docs, or exempt it"
}

/** `entry` as a path from the root: its heading anchor, a leading `./` or `/` and a trailing `/` dropped. */
function fromRoot(entry: string): string {
  const [path = ""] = entry.split("#", 1)
  return posix.join(".", path).replace(/\/+$/, "")
}

/** Whether `target`, a path from the root, names `doc`, a directory above it or a glob that matches it. */
function reaches(target: string, doc: string): boolean {
  return target.includes("*") ? matchesGlob(doc, target) : doc === target || doc.startsWith(`${target}/`)
}

/** The docs entries of the catalogue's Primitives; none when it is missing or not valid. */
function catalogueDocs(root: string, file: string): string[] {
  const read = readCatalogue(root, file)
  return read.state === "valid" ? read.catalogue.primitives.flatMap(({ docs }) => docs) : []
}

function run(root: string, { files, exempt }: RoutedDocsOptions): Finding[] {
  const { checks } = resolveConfig(root).config.gate
  const map = mapFile(checks)
  const rows = routes(readMap(root, map))
  const findings: Finding[] = []
  if (rows.length === 0) {
    findings.push({ file: map, message: "has no Task Router table to reach a doc from", remedy: REMEDIES.table })
  }
  const targets = [...rows.flatMap(({ paths }) => paths), ...catalogueDocs(root, catalogueFile(checks))].map(fromRoot)
  for (const doc of matching(root, treeFiles(root), files, exempt)) {
    if (!targets.some((target) => reaches(target, doc))) {
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
