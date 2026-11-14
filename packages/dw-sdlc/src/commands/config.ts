// `dw-sdlc config`, the config check: resolves a repository's agentic config, or validates one file
// against the schema, and prints what the guards see.

import { readFileSync } from "node:fs"

import {
  COMMITTED_FILE,
  findRepository,
  invalidLayerEffect,
  LOCAL_FILE,
  type Problem,
  repositoryRoot,
  resolveConfig,
  validateDocument
} from "../agentic-config.ts"
import { messageOf, readArgs, rootDir, usageError } from "../cannot-run.ts"

export const summary = "resolve the repository's agentic config, or validate one file against the schema"

const USAGE = `Usage: dw-sdlc config [--root <dir>] [file]
  or:  pnpm agentic:check [--root <dir>] [file], in a checkout of dw-sdlc

Without a file: resolves the agentic config of the repository holding --root (default: the current
directory) — local over committed over inferred — and prints what the guards see. With a file:
validates that one document against the schema. Exit 1 on any problem, 2 when --root names no
directory.`

/** A problem the check reports beside the config's own: exit 1, as for an invalid layer. */
function failed(message: string): number {
  console.error(`dw-sdlc config: ${message}`)
  return 1
}

function parseCli(argv: string[]): { help: boolean; root: string | undefined; file: string | undefined } {
  const { values, positionals } = readArgs(
    {
      args: argv,
      allowPositionals: true,
      options: { help: { type: "boolean", short: "h" }, root: { type: "string" } }
    },
    USAGE
  )
  if (positionals.length > 1) {
    throw usageError("at most one file", USAGE)
  }
  return { help: values.help === true, root: values.root, file: positionals[0] }
}

function report(problems: Problem[]): void {
  for (const { file, path, message } of problems) {
    console.error(path === "" ? `${file}: ${message}` : `${file}: ${path}: ${message}`)
  }
}

export function run(argv: string[]): number {
  const cli = parseCli(argv)
  if (cli.help) {
    console.log(USAGE)
    return 0
  }

  if (cli.file !== undefined) {
    let text: string
    try {
      text = readFileSync(cli.file, "utf8")
    } catch (error) {
      return failed(messageOf(error))
    }
    const result = validateDocument(cli.file, text)
    if ("problems" in result) {
      report(result.problems)
      return 1
    }
    console.log(`${cli.file}: valid`)
    return 0
  }

  const root = cli.root === undefined ? findRepository(process.cwd()) : repositoryRoot(rootDir(cli.root))
  if (root === undefined) {
    return failed("not inside a git repository; pass --root <dir>")
  }

  const { config, problems, layers, sources } = resolveConfig(root)
  const from = (source: string | undefined): string =>
    source === undefined || source === root ? "" : `, from ${source}`
  console.log(`committed  ${COMMITTED_FILE}  ${layers.committed}${from(sources.committed)}`)
  console.log(`local      ${LOCAL_FILE}  ${layers.local}${from(sources.local)}`)
  console.log(JSON.stringify(config, null, 2))
  if (problems.length > 0) {
    report(problems)
    return failed(`${problems.length} problem(s) above; ${invalidLayerEffect(config)} until the file is fixed`)
  }
  return 0
}
