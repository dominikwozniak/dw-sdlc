// `dw-sdlc references setup` sets a repository up to declare References: the files its USAGE names,
// each written only when it would change. A list gains the entries it lacks at its end; the one removal
// is a `references` key moving out of the agentic config. A file it cannot read as expected is refused.

import { spawnSync } from "node:child_process"
import { existsSync, lstatSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { parseArgs } from "node:util"

import { parseObject, removeKey, render } from "../json-text.ts"
import {
  CONFIG,
  REFERENCES_FILE,
  leftoverKey,
  leftoverProblem,
  parseReferences,
  readFile,
  type Reference
} from "../references-key.ts"
import { renderBlock, withBlock } from "../router-block.ts"

const ROUTER = "references/AGENTS.md"
/** A symlink to the Router, so Claude Code loads it. */
const ROUTER_LINK = "references/CLAUDE.md"
const SETTINGS = ".claude/settings.json"
const IGNORE = ".gitignore"
const TEMPLATE = join(import.meta.dirname, "..", "..", "templates", "router.md")
/** Where a file the setup creates points `$schema`: the schema the pinned package installs. */
const SCHEMA = "../node_modules/dw-sdlc/config/references.schema.json"

/** A clone's own agent files at any depth; Claude Code matches the globs against absolute paths. */
const EXCLUDES = [
  "**/references/*/CLAUDE.md",
  "**/references/*/**/CLAUDE.md",
  "**/references/*/AGENTS.md",
  "**/references/*/**/AGENTS.md"
]

/** Every clone ignored, then the Router and its symlink tracked: an exception counts after its pattern. */
const IGNORED = "references/*"
const TRACKED = ["!references/AGENTS.md", "!references/CLAUDE.md"]
/** Lines that ignore references/ itself: git never looks inside it, so no exception tracks the Router. */
const WHOLE = new Set(["references", "references/", "/references", "/references/"])
const IGNORE_COMMENT = "# References are cloned on each machine by the sdlc plugin; only the Router is tracked."

export const summary = "set a repository up to declare References: the Router, its table and the ignore rules"

const USAGE = `Usage: dw-sdlc references setup [--root <dir>] [--dry-run | --check]
  or:  pnpm references:setup with the same flags, in a checkout of dw-sdlc

Sets the repository at --root, or the one the current directory sits in, up to declare References:
the Router in ${ROUTER} with its CLAUDE.md symlink and, between its two markers, the table of each
Reference's dir and when from ${REFERENCES_FILE}, claudeMdExcludes in ${SETTINGS} for the clones' own agent
files, the ${IGNORE} lines that keep every clone out of git but the Router, and ${REFERENCES_FILE} itself
with no References when it is missing. A references key in ${CONFIG} moves into a missing ${REFERENCES_FILE}
and leaves the config; with the file there too, both stay and the step is refused. Every file is
written only when it would change, and the text around the Router's table never; --dry-run reports
without writing, and --check does the same and exits 1 when a file would change. Prints one line
per file. Exit 1 when a file is refused, 2 on a bad argument.`

type Outcome = "wrote" | "unchanged" | "refused"
type Step = { file: string; outcome: Outcome; detail?: string }
/** A file's text after the step, or why the step leaves it alone. */
type Change = { text: string } | { refusal: string }

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function fail(message: string): never {
  console.error(`references:setup: ${message}`)
  process.exit(2)
}

class Writer {
  readonly steps: Step[] = []
  private readonly root: string
  private readonly dryRun: boolean
  constructor(root: string, dryRun: boolean) {
    this.root = root
    this.dryRun = dryRun
  }

  private record(file: string, changed: boolean, write: (path: string) => void): void {
    if (changed && !this.dryRun) {
      const path = join(this.root, file)
      mkdirSync(dirname(path), { recursive: true })
      write(path)
    }
    this.steps.push({ file, outcome: changed ? "wrote" : "unchanged" })
  }

  /** The text `change` gives `file`, from what `file` holds now; written when the two differ. */
  put(file: string, change: (current: string | undefined) => Change): void {
    const path = join(this.root, file)
    const current = existsSync(path) ? readFileSync(path, "utf8") : undefined
    const next = change(current)
    if ("refusal" in next) {
      this.steps.push({ file, outcome: "refused", detail: next.refusal })
      return
    }
    this.record(file, next.text !== current, (target) => {
      writeFileSync(target, next.text)
    })
  }

  /** `file`, made by `make` when nothing sits at its path, a dangling symlink included; never replaced. */
  create(file: string, make: (path: string) => void): void {
    this.record(file, lstatSync(join(this.root, file), { throwIfNoEntry: false }) === undefined, make)
  }
}

/** The settings with claudeMdExcludes holding every glob of EXCLUDES, those it lacks appended. */
function withExcludes(current: string | undefined): Change {
  if (current === undefined) {
    return { text: render({ claudeMdExcludes: EXCLUDES }) }
  }
  const settings = parseObject(current)
  if (settings === undefined) {
    return { refusal: "is not a JSON object; fix it by hand first" }
  }
  const value = settings.claudeMdExcludes ?? []
  if (!Array.isArray(value)) {
    return { refusal: "claudeMdExcludes is not a list; fix it by hand first" }
  }
  const existing: unknown[] = value
  const missing = EXCLUDES.filter((glob) => !existing.includes(glob))
  return { text: missing.length === 0 ? current : render({ ...settings, claudeMdExcludes: [...existing, ...missing] }) }
}

/**
 * The ignore file with the lines it lacks appended. Without `references/*` all three go in, so each
 * exception lands after the pattern it excepts; with it, only the exceptions it lacks.
 */
function withIgnoreLines(current: string | undefined): Change {
  const text = current ?? ""
  const lines = text.split(/\r?\n/).map((line) => line.trimEnd())
  if (lines.some((line) => WHOLE.has(line))) {
    return { refusal: `ignores references/ itself, so no exception tracks the Router; ignore ${IGNORED} instead` }
  }
  const ignored = lines.includes(IGNORED)
  const missing = ignored ? TRACKED.filter((line) => !lines.includes(line)) : [IGNORE_COMMENT, IGNORED, ...TRACKED]
  if (missing.length === 0) {
    return { text }
  }
  const head = text === "" || text.endsWith("\n") ? text : `${text}\n`
  const gap = head !== "" && !ignored ? "\n" : ""
  return { text: `${head}${gap}${missing.join("\n")}\n` }
}

/** The text of a References file the setup creates, declaring `references`. */
function fileOf(references: unknown): string {
  return render({ $schema: SCHEMA, version: 1, references })
}

/** The References the Router's table comes from, the text of the file, and the config's when the key moves. */
type Source = {
  references: Reference[] | undefined
  file: Change
  config?: (current: string | undefined) => Change
}

/**
 * Where the References come from: a `references` key left in the config moves into a missing file,
 * and a repository with neither gets the file with no References; the file and the key both there
 * are refused, and so is a key the parser refuses.
 */
function source(root: string): Source | { problem: string; file?: Change } {
  const key = leftoverKey(root)
  const path = join(root, REFERENCES_FILE)
  if (key === undefined) {
    const reading = readFile(root)
    if ("problem" in reading) {
      // The problem is the file's own, and the Router's line names it; the file stays as it is.
      return { problem: reading.problem, file: { text: readFileSync(path, "utf8") } }
    }
    return {
      references: reading.references,
      file: { text: existsSync(path) ? readFileSync(path, "utf8") : fileOf([]) }
    }
  }
  if (existsSync(path)) {
    return { problem: leftoverProblem(true) }
  }
  const parsed = parseReferences(key)
  if ("problem" in parsed) {
    return { problem: `${CONFIG}: ${parsed.problem.path}: ${parsed.problem.message}; fix it by hand first` }
  }
  return {
    references: parsed.references,
    file: { text: fileOf(key) },
    config: (current) =>
      current === undefined || parseObject(current) === undefined
        ? { refusal: "is not a JSON object; fix it by hand first" }
        : { text: removeKey(current, "references") }
  }
}

/** The repository `dir` sits in, or `dir` itself outside one. */
function toplevel(dir: string): string {
  const result = spawnSync("git", ["-C", dir, "rev-parse", "--show-toplevel"], { encoding: "utf8" })
  return result.status === 0 ? result.stdout.trim() : dir
}

function setup(root: string, dryRun: boolean): Step[] {
  const writer = new Writer(root, dryRun)
  const template = readFileSync(TEMPLATE, "utf8")
  const from = source(root)
  writer.put(ROUTER, (current) => {
    if ("problem" in from) {
      return { refusal: `${from.problem}; the table comes from ${REFERENCES_FILE}, so fix it first` }
    }
    const next = withBlock(current ?? template, renderBlock(from.references ?? []))
    return "problem" in next ? { refusal: next.problem } : next
  })
  writer.create(ROUTER_LINK, (path) => {
    symlinkSync("AGENTS.md", path)
  })
  writer.put(SETTINGS, withExcludes)
  writer.put(IGNORE, withIgnoreLines)
  writer.put(REFERENCES_FILE, () => ("problem" in from ? (from.file ?? { refusal: from.problem }) : from.file))
  if (!("problem" in from) && from.config !== undefined) {
    writer.put(CONFIG, from.config)
  }
  return writer.steps
}

export function run(argv: string[]): number {
  let values: { help?: boolean; root?: string; "dry-run"?: boolean; check?: boolean }
  try {
    values = parseArgs({
      args: argv,
      options: {
        help: { type: "boolean", short: "h" },
        root: { type: "string" },
        "dry-run": { type: "boolean" },
        check: { type: "boolean" }
      }
    }).values
  } catch (error) {
    fail(`${messageOf(error)}\n\n${USAGE}`)
  }
  if (values.help === true) {
    console.log(USAGE)
    return 0
  }

  const check = values.check === true
  const dryRun = values["dry-run"] === true || check
  const steps = setup(toplevel(values.root ?? process.cwd()), dryRun)
  for (const step of steps) {
    const verb = step.outcome === "wrote" && dryRun ? "would write" : step.outcome
    console.log(`${verb.padEnd(11)} ${step.file}${step.detail === undefined ? "" : ` — ${step.detail}`}`)
  }
  const refused = steps.some((step) => step.outcome === "refused")
  return refused || (check && steps.some((step) => step.outcome === "wrote")) ? 1 : 0
}
