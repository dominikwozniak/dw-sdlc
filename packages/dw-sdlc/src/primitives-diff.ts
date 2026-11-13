// The Primitives a change removes, adds or extends, decided from the paths it changes and the catalogue
// at both ends of `base...HEAD`: nothing is judged. `dw-sdlc primitives --diff` prints it and `recap`
// rolls it up for the session's branch.

import { resolveConfig } from "./agentic-config.ts"
import { type Catalogue, type CatalogueRead, parseCatalogue, type Primitive, primitivesNaming } from "./catalogue.ts"
import { catalogueFile } from "./checks/primitives.ts"
import { asked, git } from "./working-tree.ts"

export type PrimitiveClass = "removes" | "adds" | "extends"

export type Change = {
  id: string
  name: string
  class: PrimitiveClass
  /** The changed files the Primitive owns. */
  files: number
  summary: string
  /** Each `docs` entry, and whether the diff changes its file, whatever its anchor. */
  docs: { entry: string; touched: boolean }[]
}

export type PrimitivesDiff = { base: string; primitives: Change[]; outside: number }

/** Why a diff cannot be answered: each problem with its remedy. */
export type Refusal = { problems: string[] }

const CLASSES: PrimitiveClass[] = ["removes", "adds", "extends"]

const REMEDIES = {
  missing: "create it, or point gate.checks.primitives.file at the catalogue",
  invalid: "fix the catalogue; dw-sdlc gate names each problem under the primitives Check",
  base: "fetch it, or name a ref that exists",
  git: "check the repository with git status"
}

function refuse(problem: string, remedy: string): Refusal {
  return { problems: [`${problem} — ${remedy}`] }
}

/** The catalogue `file` holds at `rev`, `missing` when `rev` has no such file. */
function readAt(root: string, rev: string, file: string): CatalogueRead {
  if (asked(root, ["cat-file", "-e", `${rev}:${file}`]) === undefined) {
    return { state: "missing" }
  }
  const shown = git(root, ["show", `${rev}:${file}`])
  return "error" in shown ? { state: "invalid", problems: [shown.error] } : parseCatalogue(shown.out)
}

/** The merge-base of `base` and `HEAD`, and the files `base...HEAD` changes: a deleted one and both ends of a rename too. */
function changeSince(root: string, base: string): { mergeBase: string; files: string[] } | Refusal {
  const resolved = asked(root, ["rev-parse", "--verify", "--quiet", `${base}^{commit}`])
  if (resolved === undefined) {
    return refuse(`the base ${JSON.stringify(base)} does not resolve to a commit`, REMEDIES.base)
  }
  const mergeBase = asked(root, ["merge-base", resolved, "HEAD"])
  if (mergeBase === undefined) {
    return refuse(`the base ${JSON.stringify(base)} shares no history with HEAD`, REMEDIES.base)
  }
  const diff = git(root, ["diff", "--name-only", "-z", "--no-renames", mergeBase, "HEAD"])
  if ("error" in diff) {
    return refuse(diff.error, REMEDIES.git)
  }
  return { mergeBase, files: diff.out.split("\0").filter((path) => path !== "") }
}

/** How many of `files` the Primitive `id` owns in `catalogue`. */
function owned(catalogue: Catalogue, files: string[], id: string): number {
  return files.filter((file) => primitivesNaming(catalogue, file).some((primitive) => primitive.id === id)).length
}

function describe(primitive: Primitive, kind: PrimitiveClass, files: number, changed: Set<string>): Change {
  const docs = primitive.docs.map((entry) => ({ entry, touched: changed.has(entry.split("#")[0] ?? entry) }))
  return { id: primitive.id, name: primitive.name, class: kind, files, summary: primitive.summary, docs }
}

/**
 * The Primitives `base...HEAD` removes, adds and extends. The catalogue's path comes from the config of
 * the checkout; the catalogue is read at `HEAD` and at the merge-base, from the commits and not the tree.
 * A file's owners are the nearest entries of the catalogue it is read against, as `--paths` answers.
 */
export function primitivesDiff(root: string, base: string): PrimitivesDiff | Refusal {
  const file = catalogueFile(resolveConfig(root).config.gate.checks)
  const head = readAt(root, "HEAD", file)
  if (head.state === "missing") {
    return refuse(`${file}: the catalogue does not exist at HEAD`, REMEDIES.missing)
  }
  if (head.state === "invalid") {
    return { problems: head.problems.map((problem) => `${file}: ${problem} — ${REMEDIES.invalid}`) }
  }
  const since = changeSince(root, base)
  if ("problems" in since) {
    return since
  }
  const { mergeBase, files } = since
  const before = readAt(root, mergeBase, file)
  if (before.state === "invalid") {
    const at = `${file} at ${JSON.stringify(base)}`
    return { problems: before.problems.map((problem) => `${at}: ${problem} — ${REMEDIES.invalid}`) }
  }
  const atBase: Catalogue = before.state === "valid" ? before.catalogue : { version: 1, groups: [], primitives: [] }
  const atHead = head.catalogue
  const changed = new Set(files)
  const inBase = new Set(atBase.primitives.map(({ id }) => id))
  const inHead = new Set(atHead.primitives.map(({ id }) => id))
  const changes: Change[] = [
    ...atBase.primitives
      .filter(({ id }) => !inHead.has(id))
      .map((primitive) => describe(primitive, "removes", owned(atBase, files, primitive.id), changed)),
    ...atHead.primitives.flatMap((primitive): Change[] => {
      const kind: PrimitiveClass = inBase.has(primitive.id) ? "extends" : "adds"
      const count = owned(atHead, files, primitive.id)
      return kind === "adds" || count > 0 ? [describe(primitive, kind, count, changed)] : []
    })
  ]
  const outside = files.filter(
    (path) => primitivesNaming(atHead, path).length + primitivesNaming(atBase, path).length === 0
  )
  const rank = ({ class: kind }: Change) => CLASSES.indexOf(kind)
  changes.sort((a, b) => rank(a) - rank(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return { base, primitives: changes, outside: outside.length }
}

function plural(howMany: number, word: string): string {
  return `${howMany} ${word}${howMany === 1 ? "" : "s"}`
}

function cell(text: string): string {
  return text.replaceAll("|", "\\|")
}

/** The markdown block between its markers, which a later run replaces whole. */
export function blockOf({ primitives, outside }: PrimitivesDiff): string {
  const start = "<!-- primitives:start -->"
  const end = "<!-- primitives:end -->"
  if (primitives.length === 0) {
    return [start, "No Primitive changes.", end].join("\n")
  }
  const counts = CLASSES.map((kind) => ({ kind, howMany: primitives.filter((change) => change.class === kind).length }))
  const clauses = counts
    .filter(({ howMany }) => howMany > 0)
    .map(({ kind, howMany }, position) =>
      position === 0
        ? `${kind[0]?.toUpperCase()}${kind.slice(1)} ${plural(howMany, "Primitive")}`
        : `${kind} ${howMany}`
    )
  const rows = primitives.map(
    (change) => `| \`${cell(change.id)}\` (${cell(change.name)}) | ${change.class} | ${change.files} |`
  )
  return [
    start,
    `**${clauses.join(", ")}.** ${plural(outside, "file")} outside the catalogue.`,
    "",
    "| Primitive | Class | Files |",
    "| --- | --- | --- |",
    ...rows,
    end
  ].join("\n")
}
