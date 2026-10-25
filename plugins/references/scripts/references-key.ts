// The strict parser of the `references` key, the authority at runtime, and the reader of the committed
// config that holds it. `config/references.schema.json` documents the same contract, and
// `test/scripts/references-key.test.ts` runs one case list through both. The first problem stops the
// parse: a key that fails it syncs nothing.

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

/** The committed config, the only file the key is read from. */
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

/**
 * The References the committed config at `root` declares, `undefined` without the file or the key,
 * or the problem that stops the read: the file is not a JSON object, or the key fails the parser.
 */
export function readReferences(root: string): { references: Reference[] | undefined } | { problem: string } {
  const path = join(root, CONFIG)
  if (!existsSync(path)) {
    return { references: undefined }
  }
  let config: unknown
  try {
    config = JSON.parse(readFileSync(path, "utf8"))
  } catch (error) {
    return { problem: `${CONFIG}: not JSON: ${error instanceof Error ? error.message : String(error)}` }
  }
  if (!isObject(config)) {
    return { problem: `${CONFIG}: not a JSON object` }
  }
  if (!Object.hasOwn(config, "references")) {
    return { references: undefined }
  }
  const parsed = parseReferences(config.references)
  if ("problem" in parsed) {
    return { problem: `${CONFIG}: ${parsed.problem.path}: ${parsed.problem.message}` }
  }
  return { references: parsed.references }
}
