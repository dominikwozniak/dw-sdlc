// `dw-sdlc pr ship [<n>]`, the Ship script: reads one pull request through gh, decides the Action it
// needs next, performs it when it is the script's and reads again, then answers the first Action that
// is not, as a line or one JSON document, with an exit code that names whose turn it is.

import { parseArgs } from "node:util"

import { type PrMerge, repositoryRoot, resolveConfig } from "../agentic-config.ts"
import { type Action, type Answer, decide, readyToMerge, shellLine, type Status } from "../pr/decide.ts"
import { CannotRun, gh, namedProblem, read, readAgain, said } from "../pr/read.ts"
import type { PrState } from "../pr/state.ts"

export const summary = "decide the Action one pull request needs next, as a line or JSON"

const USAGE = `Usage: dw-sdlc pr ship [<n>] [-R owner/name] [--merge] [--dry-run] [--json] [--verbose]

Reads pull request <n> through gh, the one of the current branch as gh pr view resolves it when <n>
is omitted, and answers the Action it needs next: the status, the action, whose turn it is and why.
A pull request ready to merge is squash merged by the script, then read again, under pr.merge auto
in .ai/agentic.config.json or with --merge for this call; under ask, the default, it parks with the
merge command. --dry-run performs nothing and lists what it would have run under performed. One
line, or one document with --json; --verbose adds the state as read to the document under facts.
Needs an authenticated gh.

Exit 0 done, 10 the agent's turn, 20 wait, 30 the dev's turn, 2 when it cannot run.`

const EXIT: Record<Status, number> = { done: 0, act: 10, wait: 20, park: 30 }

const REMEDIES = { clock: "unset it: it stands in for the clock in tests" }

type Cli = {
  help: boolean
  json: boolean
  verbose: boolean
  merge: boolean
  dryRun: boolean
  number: number | undefined
  repo: string | undefined
}

/** A host action the call ran, `ok` whether gh succeeded; null under --dry-run, which runs nothing. */
type Performed = { action: Action; command: string; ok: boolean | null }

function parseCli(argv: string[]): Cli | { error: string } {
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        help: { type: "boolean", short: "h" },
        json: { type: "boolean" },
        verbose: { type: "boolean" },
        merge: { type: "boolean" },
        "dry-run": { type: "boolean" },
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
      merge: values.merge === true,
      dryRun: values["dry-run"] === true,
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

/**
 * The squash merge as the script runs it, on the head it read and never with --delete-branch; -R names
 * the repository, so the checkout it runs in plays no part.
 */
function mergeArgs(pr: PrState): string[] {
  return ["pr", "merge", String(pr.number), "-R", pr.repo, "--squash", "--match-head-commit", pr.head]
}

function handedOver(pr: PrState, reason: string): Answer {
  return { ...readyToMerge(pr, reason), blockers: [] }
}

/**
 * Reads and decides until the Action is not the script's. The merge runs at most once, then the pull
 * request is read again; under --dry-run, or when the merge comes round again, it is the dev's.
 */
function ship(cli: Cli, merge: PrMerge): { pr: PrState; answer: Answer; performed: Performed[] } {
  let pr = read(cli, "pr ship")
  const performed: Performed[] = []
  let refusal: string | undefined
  for (;;) {
    const answer = decide(pr, now(), merge)
    if (answer.action !== "merge") {
      return { pr, answer, performed }
    }
    const args = mergeArgs(pr)
    const command = shellLine(["gh", ...args])
    if (cli.dryRun) {
      performed.push({ action: "merge", command, ok: null })
      return { pr, answer: handedOver(pr, "the script would merge it; --dry-run performs nothing"), performed }
    }
    if (performed.some(({ action }) => action === "merge")) {
      const reason =
        refusal === undefined
          ? "the merge ran, and the pull request still reads open"
          : `gh refused the merge: ${refusal}`
      return { pr, answer: handedOver(pr, reason), performed }
    }
    const result = gh(args)
    performed.push({ action: "merge", command, ok: result.status === 0 })
    refusal = result.status === 0 ? undefined : said(result.stderr) || `gh exited ${result.status}`
    pr = readAgain(pr)
  }
}

/** `<status> <action>: <reason>`, the action dropped when it repeats the status, then the recheck and the command. */
function lineOf({ status, action, reason, command, recheckAfter }: Answer): string {
  const label = status === action ? status : `${status} ${action}`
  const recheck = recheckAfter === undefined ? "" : `, recheck in ${recheckAfter} s`
  return `${label}: ${reason}${recheck}${command === undefined ? "" : ` — ${command}`}`
}

function documentOf(pr: PrState, answer: Answer, performed: Performed[], verbose: boolean): Record<string, unknown> {
  const facts = verbose ? { facts: pr } : {}
  return { pr: pr.url, head: pr.head, base: pr.base, ...answer, performed, ...facts }
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
  // An invalid config layer resolves to ask, like every other strictest setting.
  const merge = cli.merge ? "auto" : resolveConfig(repositoryRoot(process.cwd())).config.pr.merge
  let shipped: ReturnType<typeof ship>
  try {
    shipped = ship(cli, merge)
  } catch (error) {
    if (error instanceof CannotRun) {
      process.stderr.write(`dw-sdlc pr ship: ${error.message} — ${error.remedy}\n`)
      return 2
    }
    throw error
  }
  const { pr, answer, performed } = shipped
  const output = cli.json ? JSON.stringify(documentOf(pr, answer, performed, cli.verbose), null, 2) : lineOf(answer)
  process.stdout.write(`${output}\n`)
  return EXIT[answer.status]
}
