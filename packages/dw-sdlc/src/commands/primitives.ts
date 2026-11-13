// `dw-sdlc primitives`: with `--paths <files>`, for each path the Primitives of the catalogue that name
// it, with their summaries and the documents to read, or that none does; with `--diff <base>`, the
// Primitives a change removes, adds or extends.

import { existsSync, realpathSync } from "node:fs"
import { basename, dirname, join, relative, resolve } from "node:path"
import { parseArgs } from "node:util"

import { repositoryRoot, resolveConfig } from "../agentic-config.ts"
import { type Primitive, primitivesNaming, readCatalogue } from "../catalogue.ts"
import { catalogueFile } from "../checks/primitives.ts"
import { blockOf, primitivesDiff } from "../primitives-diff.ts"

export const summary = "name the Primitives that own each path, or that a change removes, adds or extends"

const USAGE = `Usage: dw-sdlc primitives --paths <file>... [--json] [--root <dir>]
       dw-sdlc primitives --diff <base> [--json] [--root <dir>]

--paths prints, for each path, the Primitives of the catalogue whose code names it, the file itself or
the nearest directory above it: the id, the name, the summary and the documents to read; or that no
Primitive names it. A path is read from the current directory. The catalogue is the one the
primitives Check reads, in the repository holding --root (default: the current directory). --json
prints one document instead.

--diff prints the Primitives the committed change from the merge-base of <base> and HEAD to HEAD
removes (an id gone from the catalogue), adds (a new id) and extends (a changed file in the code of a
Primitive that was there): a markdown block between <!-- primitives:start --> and <!-- primitives:end -->
for a pull request body, which a later run replaces. --json prints instead, per Primitive, its id, name,
class, file count, summary and docs, each doc with whether the change touches its file, and the count of
changed files outside every Primitive. It takes no --paths.

Exit 0 with an answer, 2 when there is no catalogue to read or it is not one, and for --diff when <base>
does not resolve.`

const REMEDIES = {
  missing: "create it, or point gate.checks.primitives.file at the catalogue",
  invalid: "fix the catalogue; dw-sdlc gate names each problem under the primitives Check"
}

type Cli = {
  help: boolean
  json: boolean
  paths: boolean
  diff: string | undefined
  files: string[]
  root: string | undefined
}

function parseCli(argv: string[]): Cli | { error: string } {
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        help: { type: "boolean", short: "h" },
        json: { type: "boolean" },
        paths: { type: "boolean" },
        diff: { type: "string" },
        root: { type: "string" }
      }
    })
    const cli = {
      help: values.help === true,
      json: values.json === true,
      paths: values.paths === true,
      diff: values.diff,
      files: positionals,
      root: values.root
    }
    if (cli.help) {
      return cli
    }
    if (cli.diff !== undefined && (cli.paths || cli.files.length > 0)) {
      return { error: "--diff and --paths exclude each other — ask one question at a time" }
    }
    return cli.paths || cli.diff !== undefined ? cli : { error: "name the paths with --paths, or a base with --diff" }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * `path` with every symbolic link in it resolved, as git reports the root: the nearest part on disk
 * resolved and the rest kept, so a deleted file still maps into the repository.
 */
function realPath(path: string): string {
  if (existsSync(path)) {
    return realpathSync(path)
  }
  const parent = dirname(path)
  return parent === path ? path : join(realPath(parent), basename(path))
}

function brief({ id, name, summary: what, docs }: Primitive): Record<string, unknown> {
  return { id, name, summary: what, docs }
}

function plain(path: string, primitives: Primitive[]): string[] {
  if (primitives.length === 0) {
    return [`${path}: no Primitive names this path`]
  }
  return primitives.flatMap(({ id, name, summary: what, docs }) => [
    `${path}: ${id} (${name}) — ${what}`,
    `  read: ${docs.join(", ")}`
  ])
}

function runDiff(root: string, base: string, json: boolean): number {
  const answer = primitivesDiff(root, base)
  if ("problems" in answer) {
    process.stderr.write(answer.problems.map((problem) => `dw-sdlc primitives: ${problem}\n`).join(""))
    return 2
  }
  process.stdout.write(json ? `${JSON.stringify(answer, null, 2)}\n` : `${blockOf(answer)}\n`)
  return 0
}

export function run(argv: string[]): number {
  const cli = parseCli(argv)
  if ("error" in cli) {
    process.stderr.write(`dw-sdlc primitives: ${cli.error}\n\n${USAGE}\n`)
    return 2
  }
  if (cli.help) {
    process.stdout.write(`${USAGE}\n`)
    return 0
  }

  const root = repositoryRoot(cli.root ?? process.cwd())
  if (cli.diff !== undefined) {
    return runDiff(root, cli.diff, cli.json)
  }
  const file = catalogueFile(resolveConfig(root).config.gate.checks)
  const read = readCatalogue(root, file)
  if (read.state !== "valid") {
    const problems =
      read.state === "missing"
        ? [`the catalogue does not exist — ${REMEDIES.missing}`]
        : read.problems.map((problem) => `${problem} — ${REMEDIES.invalid}`)
    process.stderr.write(problems.map((problem) => `dw-sdlc primitives: ${file}: ${problem}\n`).join(""))
    return 2
  }

  const answers = cli.files.map((path) => {
    const fromRoot = relative(root, realPath(resolve(path)))
    return { path, primitives: primitivesNaming(read.catalogue, fromRoot) }
  })
  if (cli.json) {
    const paths = answers.map(({ path, primitives }) => ({ path, primitives: primitives.map(brief) }))
    process.stdout.write(`${JSON.stringify({ paths }, null, 2)}\n`)
  } else {
    process.stdout.write(
      answers
        .flatMap(({ path, primitives }) => plain(path, primitives))
        .map((line) => `${line}\n`)
        .join("")
    )
  }
  return 0
}
