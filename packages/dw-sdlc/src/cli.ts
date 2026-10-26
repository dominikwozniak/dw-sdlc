#!/usr/bin/env node
// The `dw-sdlc` bin. One row per subcommand, each a module under `commands/` that exports its
// summary and `run`, which takes the arguments after the subcommand's name and returns the exit code.

import * as gate from "./commands/gate.ts"

type Command = { summary: string; run: (argv: string[]) => number | Promise<number> }

const COMMANDS = new Map<string, Command>([["gate", gate]])

function usage(): string {
  const rows = [...COMMANDS].map(([name, { summary }]) => `  ${name.padEnd(8)}${summary}`)
  return `Usage: dw-sdlc <command> [options]\n\nCommands:\n${rows.join("\n")}\n\nRun dw-sdlc <command> --help for its options.`
}

async function main(argv: string[]): Promise<number> {
  const [name, ...rest] = argv
  if (name === "--help" || name === "-h") {
    process.stdout.write(`${usage()}\n`)
    return 0
  }
  const command = name === undefined ? undefined : COMMANDS.get(name)
  if (command === undefined) {
    const problem = name === undefined ? "no command given" : `unknown command ${JSON.stringify(name)}`
    process.stderr.write(`dw-sdlc: ${problem}\n\n${usage()}\n`)
    return 2
  }
  return command.run(rest)
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2))
}
