#!/usr/bin/env node
// The `dw-sdlc` bin: one row per subcommand, each a module under `commands/`. A plugin's hook or skill
// reaches it through the plugin's `dw-sdlc` link.

import * as check from "./commands/check.ts"
import * as config from "./commands/config.ts"
import * as doctor from "./commands/doctor.ts"
import * as gate from "./commands/gate.ts"
import * as prReviewed from "./commands/pr-reviewed.ts"
import * as prShip from "./commands/pr-ship.ts"
import * as primitives from "./commands/primitives.ts"
import * as referencesSetup from "./commands/references-setup.ts"
import * as referencesSync from "./commands/references-sync.ts"
import * as setup from "./commands/setup.ts"

/** `run` takes the arguments after the subcommand's name and returns the exit code. */
type Command = { summary: string; run: (argv: string[]) => number | Promise<number> }

const COMMANDS = new Map<string, Command>([
  ["gate", gate],
  ["check", check],
  ["primitives", primitives],
  ["setup", setup],
  ["doctor", doctor],
  ["config", config],
  ["references sync", referencesSync],
  ["references setup", referencesSetup],
  ["pr ship", prShip],
  ["pr reviewed", prReviewed]
])

function usage(): string {
  const width = Math.max(...[...COMMANDS.keys()].map((name) => name.length)) + 2
  const rows = [...COMMANDS].map(([name, { summary }]) => `  ${name.padEnd(width)}${summary}`)
  return `Usage: dw-sdlc <command> [options]\n\nCommands:\n${rows.join("\n")}\n\nRun dw-sdlc <command> --help for its options.`
}

async function main(argv: string[]): Promise<number> {
  const [first, second] = argv
  if (first === "--help" || first === "-h") {
    process.stdout.write(`${usage()}\n`)
    return 0
  }
  // A two-word name, as `references sync`, before its first word alone.
  const words = second !== undefined && COMMANDS.has(`${first} ${second}`) ? 2 : 1
  const command = COMMANDS.get(argv.slice(0, words).join(" "))
  if (command === undefined) {
    const problem = first === undefined ? "no command given" : `unknown command ${JSON.stringify(first)}`
    process.stderr.write(`dw-sdlc: ${problem}\n\n${usage()}\n`)
    return 2
  }
  return command.run(argv.slice(words))
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2))
}
