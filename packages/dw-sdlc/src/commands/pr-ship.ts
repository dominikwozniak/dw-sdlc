// `dw-sdlc pr ship [<n>]`, the Ship script: reads one pull request through gh, decides the Action it
// needs next and answers it as a line or one JSON document, with an exit code that names whose turn it is.

import { parseArgs } from "node:util"

import { type Answer, decide, type Status } from "../pr/decide.ts"
import { CannotRun, namedProblem, read } from "../pr/read.ts"
import type { PrState } from "../pr/state.ts"

export const summary = "decide the Action one pull request needs next, as a line or JSON"

const USAGE = `Usage: dw-sdlc pr ship [<n>] [-R owner/name] [--json] [--verbose]

Reads pull request <n> through gh, the one of the current branch as gh pr view resolves it when <n>
is omitted, and answers the Action it needs next: the status, the action, whose turn it is and why.
One line, or one document with --json; --verbose adds the state as read to the document under
facts. Needs an authenticated gh.

Exit 0 done, 10 the agent's turn, 20 wait, 30 the dev's turn, 2 when it cannot run.`

const EXIT: Record<Status, number> = { done: 0, act: 10, wait: 20, park: 30 }

const REMEDIES = { clock: "unset it: it stands in for the clock in tests" }

type Cli = { help: boolean; json: boolean; verbose: boolean; number: number | undefined; repo: string | undefined }

function parseCli(argv: string[]): Cli | { error: string } {
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        help: { type: "boolean", short: "h" },
        json: { type: "boolean" },
        verbose: { type: "boolean" },
        repo: { type: "string", short: "R" }
      }
    })
    const [number, ...more] = positionals
    const { repo } = values
    if (values.help !== true) {
      if (more.length > 0) {
        return { error: `name one pull request, not ${positionals.length}` }
      }
      const problem = namedProblem(number, repo)
      if (problem !== undefined) {
        return { error: problem }
      }
    }
    return {
      help: values.help === true,
      json: values.json === true,
      verbose: values.verbose === true,
      number: number === undefined ? undefined : Number(number),
      repo
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

/** The time the decision reads: DW_SDLC_NOW, an ISO 8601 time a test sets, else the system clock. */
function now(): number {
  const given = process.env.DW_SDLC_NOW?.trim()
  if (given === undefined || given === "") {
    return Date.now()
  }
  const time = Date.parse(given)
  if (Number.isNaN(time)) {
    throw new CannotRun(`DW_SDLC_NOW is ${JSON.stringify(given)}, not an ISO 8601 time`, REMEDIES.clock)
  }
  return time
}

/** `<status> <action>: <reason>`, the action dropped when it repeats the status, then the recheck and the command. */
function lineOf({ status, action, reason, command, recheckAfter }: Answer): string {
  const label = status === action ? status : `${status} ${action}`
  const recheck = recheckAfter === undefined ? "" : `, recheck in ${recheckAfter} s`
  return `${label}: ${reason}${recheck}${command === undefined ? "" : ` — ${command}`}`
}

function documentOf(pr: PrState, answer: Answer, verbose: boolean): Record<string, unknown> {
  const facts = verbose ? { facts: pr } : {}
  return { pr: pr.url, head: pr.head, base: pr.base, ...answer, blockers: [], performed: [], ...facts }
}

export function run(argv: string[]): number {
  const cli = parseCli(argv)
  if ("error" in cli) {
    process.stderr.write(`dw-sdlc pr ship: ${cli.error}\n\n${USAGE}\n`)
    return 2
  }
  if (cli.help) {
    process.stdout.write(`${USAGE}\n`)
    return 0
  }
  let pr: PrState
  let time: number
  try {
    pr = read(cli, "pr ship")
    time = now()
  } catch (error) {
    if (error instanceof CannotRun) {
      process.stderr.write(`dw-sdlc pr ship: ${error.message} — ${error.remedy}\n`)
      return 2
    }
    throw error
  }
  const answer = decide(pr, time)
  process.stdout.write(`${cli.json ? JSON.stringify(documentOf(pr, answer, cli.verbose), null, 2) : lineOf(answer)}\n`)
  return EXIT[answer.status]
}
