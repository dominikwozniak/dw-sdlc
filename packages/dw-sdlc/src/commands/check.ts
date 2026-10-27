// `dw-sdlc check <name>`: one Check of the Gate by its name, without the Steps and the other Checks.

import { parseArgs } from "node:util"

import { repositoryRoot } from "../agentic-config.ts"
import { CHECK_NAMES } from "../checks/index.ts"
import { printReport, runGate } from "./gate.ts"

export const summary = "run one Check of the Gate by its name, without the Steps and the other Checks"

const USAGE = `Usage: dw-sdlc check <name> [--json] [--root <dir>]

Runs the Check named <name> in the Gate of the repository holding --root (default: the current
directory): a script under gate.checks.run, or a Check the package ships, one of
${CHECK_NAMES.join(", ")}. A name both carry runs both, as the Gate does. A
shipped Check runs on the setting gate.checks gives it, and on its defaults where the config sets it
false or leaves it out. No Step runs. Prints one line per failure, as the Gate does; --json prints
the Gate's document, with no Step.

A Ratchet's baseline is refreshed by dw-sdlc gate --update-baseline, which needs every other Check to
pass.

Exit 0 when the Check passes, 1 when it fails, 2 when it cannot run: no Check of that name, an
invalid config layer, a command the shell cannot find or execute, or an input the Check reads
missing.`

type Cli = { help: boolean; json: boolean; root: string | undefined; name: string | undefined }

function parseCli(argv: string[]): Cli | { error: string } {
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        help: { type: "boolean", short: "h" },
        json: { type: "boolean" },
        root: { type: "string" }
      }
    })
    if (positionals.length > 1) {
      return { error: `one Check at a time, not ${positionals.map((name) => JSON.stringify(name)).join(" and ")}` }
    }
    return { help: values.help === true, json: values.json === true, root: values.root, name: positionals[0] }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

export function run(argv: string[]): number {
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
  const report = runGate(repositoryRoot(cli.root ?? process.cwd()), { json, only: name })
  return printReport(report, json, `check ${name}`)
}
