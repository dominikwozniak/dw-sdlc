// Sets a repository up to declare References. Five files, each written only when it would change, so a
// repeat with nothing changed writes nothing:
//
//   references/AGENTS.md       the Router, from templates/router.md; written once, never over one that exists
//   references/CLAUDE.md       a symlink to AGENTS.md, so Claude Code loads the Router; written once too
//   .claude/settings.json      claudeMdExcludes for the clones' own CLAUDE.md and AGENTS.md
//   .gitignore                 references/* and the two exceptions that keep the Router tracked
//   .ai/agentic.config.json    an empty references key when the config has none
//
// Existing content stays: a list gains the entries it lacks at its end, and nothing is removed or
// reordered. A settings file or a config that is not a JSON object is refused, not rewritten.

import { spawnSync } from "node:child_process"
import { existsSync, lstatSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { parseArgs } from "node:util"

const ROUTER = "references/AGENTS.md"
const ROUTER_LINK = "references/CLAUDE.md"
const SETTINGS = ".claude/settings.json"
const IGNORE = ".gitignore"
const CONFIG = ".ai/agentic.config.json"
const TEMPLATE = join(import.meta.dirname, "..", "templates", "router.md")

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
const IGNORE_COMMENT = "# References are cloned on each machine by the references plugin; only the Router is tracked."

const USAGE = `Usage: node <plugin root>/scripts/references-setup.ts [--root <dir>] [--dry-run]

Sets the repository at --root, or the one the current directory sits in, up to declare References:
the Router in ${ROUTER} with its CLAUDE.md symlink, claudeMdExcludes in ${SETTINGS} for the
clones' own agent files, the ${IGNORE} lines that keep every clone out of git but the Router, and
an empty references key in ${CONFIG}. Every file is written only when it would change, and an
existing Router never; --dry-run reports without writing. Prints one line per file. Exit 1 when a
file is refused, 2 on a bad argument.`

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

function render(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** The JSON object `text` holds, or undefined when it holds anything else. */
function parseObject(text: string): Record<string, unknown> | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return undefined
  }
  return isObject(parsed) ? parsed : undefined
}

class Writer {
  readonly steps: Step[] = []
  private readonly root: string
  private readonly dryRun: boolean
  constructor(root: string, dryRun: boolean) {
    this.root = root
    this.dryRun = dryRun
  }

  private record(file: string, written: boolean, write: (path: string) => void): void {
    if (written && !this.dryRun) {
      const path = join(this.root, file)
      mkdirSync(dirname(path), { recursive: true })
      write(path)
    }
    this.steps.push({ file, outcome: written ? "wrote" : "unchanged" })
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
  const existing = settings.claudeMdExcludes ?? []
  if (!Array.isArray(existing)) {
    return { refusal: "claudeMdExcludes is not a list; fix it by hand first" }
  }
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
  const ignored = lines.includes(IGNORED)
  const missing = ignored ? TRACKED.filter((line) => !lines.includes(line)) : [IGNORE_COMMENT, IGNORED, ...TRACKED]
  if (missing.length === 0) {
    return { text }
  }
  const head = text === "" || text.endsWith("\n") ? text : `${text}\n`
  const gap = head !== "" && !ignored ? "\n" : ""
  return { text: `${head}${gap}${missing.join("\n")}\n` }
}

/** The config with an empty `references` key when it has none, inserted so its own layout stays. */
function withEmptyKey(current: string | undefined): Change {
  if (current === undefined) {
    return { text: render({ references: [] }) }
  }
  const config = parseObject(current)
  if (config === undefined) {
    return { refusal: "is not a JSON object; fix it by hand first" }
  }
  if (Object.hasOwn(config, "references")) {
    return { text: current }
  }
  const close = current.lastIndexOf("}")
  const body = current.slice(0, close).trimEnd()
  const comma = body.endsWith("{") ? "" : ","
  return { text: `${body}${comma}\n  "references": []\n${current.slice(close)}` }
}

/** The repository `dir` sits in, or `dir` itself outside one. */
function toplevel(dir: string): string {
  const result = spawnSync("git", ["-C", dir, "rev-parse", "--show-toplevel"], { encoding: "utf8" })
  return result.status === 0 ? result.stdout.trim() : dir
}

function setup(root: string, dryRun: boolean): Step[] {
  const writer = new Writer(root, dryRun)
  const router = readFileSync(TEMPLATE, "utf8")
  writer.create(ROUTER, (path) => {
    writeFileSync(path, router)
  })
  writer.create(ROUTER_LINK, (path) => {
    symlinkSync("AGENTS.md", path)
  })
  writer.put(SETTINGS, withExcludes)
  writer.put(IGNORE, withIgnoreLines)
  writer.put(CONFIG, withEmptyKey)
  return writer.steps
}

function main(argv: string[]): void {
  let values: { help?: boolean; root?: string; "dry-run"?: boolean }
  try {
    values = parseArgs({
      args: argv,
      options: {
        help: { type: "boolean", short: "h" },
        root: { type: "string" },
        "dry-run": { type: "boolean" }
      }
    }).values
  } catch (error) {
    fail(`${messageOf(error)}\n\n${USAGE}`)
  }
  if (values.help === true) {
    console.log(USAGE)
    return
  }

  const dryRun = values["dry-run"] === true
  const steps = setup(toplevel(values.root ?? process.cwd()), dryRun)
  for (const step of steps) {
    const verb = step.outcome === "wrote" && dryRun ? "would write" : step.outcome
    console.log(`${verb.padEnd(11)} ${step.file}${step.detail === undefined ? "" : ` — ${step.detail}`}`)
  }
  if (steps.some((step) => step.outcome === "refused")) {
    process.exit(1)
  }
}

if (import.meta.main) {
  main(process.argv.slice(2))
}
