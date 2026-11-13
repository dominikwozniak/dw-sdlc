// `dw-sdlc check <name>`: one Check of the Gate by its name, without the Steps and the other Checks.

import { parseArgs } from "node:util"

import { repositoryRoot, resolveConfig } from "../agentic-config.ts"
import { CannotRun } from "../checks/check.ts"
import { CHECK_NAMES, shippedCheck } from "../checks/index.ts"
import { TAIL_LINES } from "../run-command.ts"
import { printReport, runGate } from "./gate.ts"

export const summary = "run one Check of the Gate by its name, without the Steps and the other Checks"

const USAGE = `Usage: dw-sdlc check <name> [--json] [--write] [--root <dir>]

Runs the Check named <name> in the Gate of the repository holding --root (default: the current
directory): a script under gate.checks.run, or a Check the package ships, one of
${CHECK_NAMES.join(", ")}. A name both carry runs both, as the Gate does. A
shipped Check runs on the setting gate.checks gives it, and on its defaults where the config sets it
false or leaves it out. No Step runs. A run script prints nothing of its own unless it does not
pass: then its last ${TAIL_LINES} lines, both streams in the order written. Prints one line per failure,
as the Gate does; --json prints the Gate's document alone, with no Step.

--write first writes what the Check derives from its sources, then judges the tree it wrote, and
prints a line on what it wrote, to stderr under --json. Only a Check that derives files takes it:
skill-sections writes each part of a skill from its README section.

A Ratchet's baseline is refreshed by dw-sdlc gate --update-baseline, which needs every other Check to
pass.

Exit 0 when the Check passes, 1 when it fails, 2 when it cannot run: no Check of that name, an
invalid config layer, a command the shell cannot find or execute, or an input the Check reads
missing.`

type Cli = { help: boolean; json: boolean; write: boolean; root: string | undefined; name: string | undefined }

function parseCli(argv: string[]): Cli | { error: string } {
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        help: { type: "boolean", short: "h" },
        json: { type: "boolean" },
        write: { type: "boolean" },
        root: { type: "string" }
      }
    })
    if (positionals.length > 1) {
      return { error: `one Check at a time, not ${positionals.map((name) => JSON.stringify(name)).join(" and ")}` }
    }
    const flags = { help: values.help === true, json: values.json === true, write: values.write === true }
    return { ...flags, root: values.root, name: positionals[0] }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Writes what the shipped Check `name` derives, on the setting the config gives it, and prints what it
 * wrote; why it cannot when it takes no --write. An invalid config or a missing input writes nothing,
 * and the run after it reports why.
 */
function writeDerived(root: string, name: string, json: boolean): string | undefined {
  const { config, problems } = resolveConfig(root)
  if (problems.length > 0) {
    return undefined
  }
  const shipped = shippedCheck(name, config.gate.checks[name])
  if (shipped === undefined && !config.gate.checks.run.some((check) => check.name === name)) {
    // No Check of that name: the run after it says so, with the names there are.
    return undefined
  }
  const write = shipped?.write
  if (write === undefined) {
    return `${JSON.stringify(name)} takes no --write: it derives no file`
  }
  try {
    const out = json ? process.stderr : process.stdout
    out.write(`check ${name}: ${write(root)}\n`)
  } catch (error) {
    if (!(error instanceof CannotRun)) {
      throw error
    }
  }
  return undefined
}

export async function run(argv: string[]): Promise<number> {
  const cli = parseCli(argv)
  if ("error" in cli) {
    process.stderr.write(`dw-sdlc check: ${cli.error}\n\n${USAGE}\n`)
    return 2
  }
  if (cli.help) {
    process.stdout.write(`${USAGE}\n`)
    return 0
  }
  if (cli.name === undefined) {
    process.stderr.write(`dw-sdlc check: name the Check to run\n\n${USAGE}\n`)
    return 2
  }

  const { json, name } = cli
  const root = repositoryRoot(cli.root ?? process.cwd())
  if (cli.write) {
    const refused = writeDerived(root, name, json)
    if (refused !== undefined) {
      process.stderr.write(`dw-sdlc check: ${refused}\n`)
      return 2
    }
  }
  const report = await runGate(root, { json, only: name })
  return printReport(report, json, `check ${name}`)
}
