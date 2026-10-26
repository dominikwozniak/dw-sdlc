#!/usr/bin/env node
// The `dw-sdlc` bin: one row per subcommand, each a module under `commands/`.

import * as gate from "./commands/gate.ts"

/** `run` takes the arguments after the subcommand's name and returns the exit code. */
type Command = { summary: string; run: (argv: string[]) => number }

const COMMANDS = new Map<string, Command>([["gate", gate]])

function usage(): string {
  const rows = [...COMMANDS].map(([name, { summary }]) => `  ${name.padEnd(8)}${summary}`)
  return `Usage: dw-sdlc <command> [options]\n\nCommands:\n${rows.join("\n")}\n\nRun dw-sdlc <command> --help for its options.`
}

function main(argv: string[]): number {
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
  process.exitCode = main(process.argv.slice(2))
}
