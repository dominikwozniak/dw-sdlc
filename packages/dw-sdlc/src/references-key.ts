// The strict parser of `.ai/references.json`, the authority at runtime, and its reader. The file's
// `references` key holds the entries. `config/references.schema.json` documents the same contract,
// and `test/references-key.test.ts` runs one case list through both. The first problem stops the parse.

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

/** The committed file the References are read from; no local layer adds to it. */
export const REFERENCES_FILE = ".ai/references.json"
/** The committed agentic config: a `references` key in it is refused, so the file stays the one list. */
export const CONFIG = ".ai/agentic.config.json"

export type Reference = {
  dir: string
  repository: string
  ref: string
  only: string[]
  skip: string[]
  what: string
  when: string
}

export type KeyProblem = { path: string; message: string }

const FILE_FIELDS = ["$schema", "version", "references"]
const FIELDS = ["dir", "repository", "ref", "only", "skip", "what", "when"]
const REQUIRED = ["dir", "repository", "ref", "what", "when"]

const DIR_NAME = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/
// No whitespace and no leading `-`, which git would read as an option.
const GIT_ARGUMENT = /^[^\s-]\S*$/
const INSIDE_CLONE = /^(?!\/)(?!(?:.*\/)?\.\.(?:\/|$)).+$/

class KeyError extends Error {
  readonly path: string
  constructor(path: string, message: string) {
    super(message)
    this.path = path
  }
}

function kind(value: unknown): string {
  if (value === null) {
    return "null"
  }
  if (Array.isArray(value)) {
    return "a list"
  }
  return typeof value === "object" ? "an object" : `a ${typeof value}`
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function nonEmpty(value: unknown, path: string): string {
  if (typeof value !== "string") {
    throw new KeyError(path, `must be a string, not ${kind(value)}`)
  }
  if (value === "") {
    throw new KeyError(path, "must not be empty")
  }
  return value
}

function matching(value: unknown, path: string, pattern: RegExp, rule: string): string {
  const string = nonEmpty(value, path)
  if (!pattern.test(string)) {
    throw new KeyError(path, `${JSON.stringify(string)} must be ${rule}`)
  }
  return string
}

/** A list of paths inside the clone, empty when absent. */
function paths(value: unknown, path: string): string[] {
  if (value === undefined) {
    return []
  }
  if (!Array.isArray(value)) {
    throw new KeyError(path, `must be a list of paths, not ${kind(value)}`)
  }
  return value.map((item, index) =>
    matching(item, `${path}[${index}]`, INSIDE_CLONE, "relative to the clone and stay inside it")
  )
}

/** `only`: absent, or at least one path, so a typo never checks out nothing. */
function onlyPaths(value: unknown, path: string): string[] {
  if (Array.isArray(value) && value.length === 0) {
    throw new KeyError(path, "must name at least one path")
  }
  return paths(value, path)
}

/** Whether `path` lies below the directory `dir`, a trailing `/` on either aside. */
function below(path: string, dir: string): boolean {
  return path.replace(/\/+$/, "").startsWith(`${dir.replace(/\/+$/, "")}/`)
}

function parseEntry(value: unknown, path: string): Reference {
  if (!isObject(value)) {
    throw new KeyError(path, `must be an object, not ${kind(value)}`)
  }
  const unknown = Object.keys(value).find((field) => !FIELDS.includes(field))
  if (unknown !== undefined) {
    throw new KeyError(path, `unknown field ${JSON.stringify(unknown)}`)
  }
  const missing = REQUIRED.find((field) => !Object.hasOwn(value, field))
  if (missing !== undefined) {
    throw new KeyError(path, `missing field ${JSON.stringify(missing)}`)
  }
  const reference = {
    dir: matching(
      value.dir,
      `${path}.dir`,
      DIR_NAME,
      "one directory name: letters, digits, _, . and -, not starting with . or -"
    ),
    repository: matching(
      value.repository,
      `${path}.repository`,
      GIT_ARGUMENT,
      "a URL git can fetch, with no whitespace and no leading -"
    ),
    ref: matching(value.ref, `${path}.ref`, GIT_ARGUMENT, "a branch or a tag, with no whitespace and no leading -"),
    only: onlyPaths(value.only, `${path}.only`),
    skip: paths(value.skip, `${path}.skip`),
    what: nonEmpty(value.what, `${path}.what`),
    when: nonEmpty(value.when, `${path}.when`)
  }
  const { only, skip } = reference
  const outside = only.length === 0 ? -1 : skip.findIndex((skipped) => !only.some((kept) => below(skipped, kept)))
  if (outside !== -1) {
    throw new KeyError(
      `${path}.skip[${outside}]`,
      `${JSON.stringify(skip[outside])} must lie inside one of the only paths`
    )
  }
  return reference
}

/** The References `value` declares, or the first problem in it, named by its path under the key. */
export function parseReferences(value: unknown): { references: Reference[] } | { problem: KeyProblem } {
  try {
    if (!Array.isArray(value)) {
      throw new KeyError("references", `must be a list of entries, not ${kind(value)}`)
    }
    const references: Reference[] = []
    for (const [index, item] of value.entries()) {
      const reference = parseEntry(item, `references[${index}]`)
      const holder = references.findIndex(({ dir }) => dir === reference.dir)
      if (holder !== -1) {
        throw new KeyError(
          `references[${index}].dir`,
          `${JSON.stringify(reference.dir)} is the dir of references[${holder}] too`
        )
      }
      references.push(reference)
    }
    return { references }
  } catch (error) {
    if (error instanceof KeyError) {
      return { problem: { path: error.path, message: error.message } }
    }
    throw error
  }
}

/** The References the file's parsed `value` declares, or the first problem in it; `""` names its root. */
export function parseFile(value: unknown): { references: Reference[] } | { problem: KeyProblem } {
  if (!isObject(value)) {
    return { problem: { path: "", message: `must be an object, not ${kind(value)}` } }
  }
  const unknown = Object.keys(value).find((field) => !FILE_FIELDS.includes(field))
  if (unknown !== undefined) {
    return { problem: { path: "", message: `unknown key ${JSON.stringify(unknown)}` } }
  }
  const missing = ["version", "references"].find((field) => !Object.hasOwn(value, field))
  if (missing !== undefined) {
    return { problem: { path: "", message: `missing key ${JSON.stringify(missing)}` } }
  }
  if (value.$schema !== undefined && typeof value.$schema !== "string") {
    return { problem: { path: "$schema", message: `must be a string, not ${kind(value.$schema)}` } }
  }
  if (value.version !== 1) {
    return { problem: { path: "version", message: `must be 1, not ${JSON.stringify(value.version)}` } }
  }
  return parseReferences(value.references)
}

/** The JSON object at `path`, `undefined` without the file, or why it is not one. */
function readObject(path: string, name: string): { value: Record<string, unknown> | undefined } | { problem: string } {
  if (!existsSync(path)) {
    return { value: undefined }
  }
  let value: unknown
  try {
    value = JSON.parse(readFileSync(path, "utf8"))
  } catch (error) {
    return { problem: `${name}: not JSON: ${error instanceof Error ? error.message : String(error)}` }
  }
  return isObject(value) ? { value } : { problem: `${name}: not a JSON object` }
}

/** The `references` key the agentic config at `root` still holds, `undefined` without one or the config. */
export function leftoverKey(root: string): unknown {
  const read = readObject(join(root, CONFIG), CONFIG)
  return "value" in read && read.value !== undefined && Object.hasOwn(read.value, "references")
    ? read.value.references
    : undefined
}

/** Why a `references` key left in the config stops a read, by whether the file is there beside it. */
export function leftoverProblem(fileExists: boolean): string {
  return fileExists
    ? `${CONFIG} has a references key beside ${REFERENCES_FILE}; merge it into the file and remove the key by hand`
    : `${CONFIG}: the references key belongs in ${REFERENCES_FILE}; move it there with \`dw-sdlc references setup\``
}

/**
 * The References the file at `root` declares, `undefined` without the file, or the problem that stops
 * the read: a `references` key left in the agentic config, a file that is not JSON, or one the parser
 * refuses. A config that is not JSON is the guards' to report, not the read's.
 */
export function readReferences(root: string): { references: Reference[] | undefined } | { problem: string } {
  if (leftoverKey(root) !== undefined) {
    return { problem: leftoverProblem(existsSync(join(root, REFERENCES_FILE))) }
  }
  return readFile(root)
}

/** The References the file at `root` declares, `undefined` without it, the agentic config unread. */
export function readFile(root: string): { references: Reference[] | undefined } | { problem: string } {
  const read = readObject(join(root, REFERENCES_FILE), REFERENCES_FILE)
  if ("problem" in read) {
    return read
  }
  if (read.value === undefined) {
    return { references: undefined }
  }
  const parsed = parseFile(read.value)
  if ("problem" in parsed) {
    const where = parsed.problem.path === "" ? "" : `${parsed.problem.path}: `
    return { problem: `${REFERENCES_FILE}: ${where}${parsed.problem.message}` }
  }
  return { references: parsed.references }
}
