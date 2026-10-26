// `dw-sdlc config`, the config check: resolves a repository's agentic config, or validates one file
// against the schema, and prints what the guards see.

import { readFileSync } from "node:fs"
import { parseArgs } from "node:util"

import {
  COMMITTED_FILE,
  findRepository,
  LOCAL_FILE,
  type Problem,
  repositoryRoot,
  resolveConfig,
  validateDocument
} from "../agentic-config.ts"

export const summary = "resolve the repository's agentic config, or validate one file against the schema"

const USAGE = `Usage: dw-sdlc config [--root <dir>] [file]
  or:  pnpm agentic:check [--root <dir>] [file], in a checkout of dw-sdlc

Without a file: resolves the agentic config of the repository holding --root (default: the current
directory) — local over committed over inferred — and prints what the guards see. With a file:
validates that one document against the schema. Exit 1 on any problem.`

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function fail(message: string, code: 1 | 2): never {
  console.error(`agentic:check: ${message}`)
  process.exit(code)
}

function parseCli(argv: string[]): { help: boolean; root: string | undefined; file: string | undefined } {
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: { help: { type: "boolean", short: "h" }, root: { type: "string" } }
    })
    if (positionals.length > 1) {
      throw new Error("at most one file")
    }
    return { help: values.help === true, root: values.root, file: positionals[0] }
  } catch (error) {
    fail(`${messageOf(error)}\n\n${USAGE}`, 2)
  }
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
      fail(messageOf(error), 1)
    }
    const result = validateDocument(cli.file, text)
    if ("problems" in result) {
      report(result.problems)
      return 1
    }
    console.log(`${cli.file}: valid`)
    return 0
  }

  const root =
    cli.root === undefined
      ? (findRepository(process.cwd()) ?? fail("not inside a git repository; pass --root <dir>", 1))
      : repositoryRoot(cli.root)

  const { config, problems, layers, sources } = resolveConfig(root)
  const from = (source: string | undefined): string =>
    source === undefined || source === root ? "" : `, from ${source}`
  console.log(`committed  ${COMMITTED_FILE}  ${layers.committed}${from(sources.committed)}`)
  console.log(`local      ${LOCAL_FILE}  ${layers.local}${from(sources.local)}`)
  console.log(JSON.stringify(config, null, 2))
  if (problems.length > 0) {
    report(problems)
    fail(`${problems.length} problem(s) above; the guards run on the strictest defaults until the file is fixed`, 1)
  }
  return 0
}
