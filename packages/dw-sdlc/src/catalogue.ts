// The Primitives catalogue: what a repository exposes to an agent, where the code of each lives and
// which documents explain it. Read and held to its shape here; the `primitives` Check judges what it
// says and `dw-sdlc primitives --paths` answers from it.

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { validate } from "./json-schema.ts"

export type Group = { id: string; name: string }
export type Primitive = { id: string; name: string; group: string; summary: string; code: string[]; docs: string[] }
export type Catalogue = { version: 1; groups: Group[]; primitives: Primitive[] }

/** Where a repository keeps its catalogue unless its config says otherwise. */
export const CATALOGUE_FILE = ".ai/primitives.json"

const STRINGS = { type: "array", items: { type: "string", minLength: 1 }, minItems: 1 }
const NAMED = { type: "string", minLength: 1 }
const SCHEMA = {
  type: "object",
  required: ["version", "groups", "primitives"],
  properties: {
    version: { const: 1 },
    groups: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "name"],
        properties: { id: NAMED, name: NAMED },
        additionalProperties: false
      }
    },
    primitives: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "name", "group", "summary", "code", "docs"],
        properties: { id: NAMED, name: NAMED, group: NAMED, summary: NAMED, code: STRINGS, docs: STRINGS },
        additionalProperties: false
      }
    }
  },
  additionalProperties: false
}

export type CatalogueRead =
  | { state: "missing" }
  | { state: "invalid"; problems: string[] }
  | { state: "valid"; catalogue: Catalogue; text: string }

/** The catalogue `text` holds, or why it is not one. */
export function parseCatalogue(text: string): Exclude<CatalogueRead, { state: "missing" }> {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    return { state: "invalid", problems: [`not JSON: ${error instanceof Error ? error.message : String(error)}`] }
  }
  const problems = validate(SCHEMA, parsed).map(({ path: at, message }) => (at === "" ? message : `${at}: ${message}`))
  if (problems.length > 0) {
    return { state: "invalid", problems }
  }
  // The schema above is the runtime twin of `Catalogue`: a document it accepts has this shape.
  return { state: "valid", catalogue: parsed as Catalogue, text }
}

/** The catalogue at `file` under `root`, or why there is none to read. */
export function readCatalogue(root: string, file: string): CatalogueRead {
  const path = join(root, file)
  return existsSync(path) ? parseCatalogue(readFileSync(path, "utf8")) : { state: "missing" }
}

/**
 * How near the `code` entry `entry`, a file or a directory, names `path`: the length of the entry when
 * it is the path or a directory above it, -1 when it is neither.
 */
function covers(entry: string, path: string): number {
  const prefix = entry.replace(/\/+$/, "")
  return path === prefix || path.startsWith(`${prefix}/`) ? prefix.length : -1
}

/**
 * The Primitives whose `code` names `path`, relative to the repository root: of those, the ones whose
 * entry is nearest the path, so a file wins over the directory holding it. Empty when none names it.
 */
export function primitivesNaming(catalogue: Catalogue, path: string): Primitive[] {
  const nearest = catalogue.primitives.map((primitive) =>
    Math.max(-1, ...primitive.code.map((entry) => covers(entry, path)))
  )
  const best = Math.max(-1, ...nearest)
  return best === -1 ? [] : catalogue.primitives.filter((_, index) => nearest[index] === best)
}
