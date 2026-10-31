// `dw-sdlc pr ship [<n>]`, the Ship script: reads one pull request through gh, decides the Action it
// needs next and answers it as a line or one JSON document, with an exit code that names whose turn it is.

import { spawnSync } from "node:child_process"
import { parseArgs } from "node:util"

import { type Answer, decide, type Status } from "../pr/decide.ts"
import { parsePr, parseView, type PrState, QUERY, ReplyError } from "../pr/state.ts"

export const summary = "decide the Action one pull request needs next, as a line or JSON"

const USAGE = `Usage: dw-sdlc pr ship [<n>] [-R owner/name] [--json] [--verbose]

Reads pull request <n> through gh, the one of the current branch as gh pr view resolves it when <n>
is omitted, and answers the Action it needs next: the status, the action, whose turn it is and why.
One line, or one document with --json; --verbose adds the state as read to the document under
facts. Needs an authenticated gh.

Exit 0 done, 10 the agent's turn, 20 wait, 30 the dev's turn, 2 when it cannot run.`

const EXIT: Record<Status, number> = { done: 0, act: 10, wait: 20, park: 30 }

const REMEDIES = {
  missing: "install the GitHub CLI from https://cli.github.com",
  auth: "run gh auth login, or set GH_TOKEN",
  target: "check the number, or name the repository with -R owner/name",
  view: "name it: dw-sdlc pr ship <n> -R owner/name",
  read: "check gh auth status and the network, then call again",
  reply: "gh answered a shape dw-sdlc does not read; report it with the output of gh --version"
}

/** What stops the script before it decides anything: exit 2, the problem and its remedy on one line. */
class CannotShip extends Error {
  remedy: string
  constructor(message: string, remedy: string) {
    super(message)
    this.remedy = remedy
  }
}

type Cli = { help: boolean; json: boolean; verbose: boolean; number: number | undefined; repo: string | undefined }
/** The pull request to read: its repository as owner/name, and its number. */
type Target = { repo: string; number: number }

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
      if (number !== undefined && !/^[1-9]\d*$/.test(number)) {
        return { error: `${JSON.stringify(number)} is not a pull request number` }
      }
      if (repo !== undefined && !/^[\w.-]+\/[\w.-]+$/.test(repo)) {
        return { error: `-R takes owner/name, not ${JSON.stringify(repo)}` }
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

function firstLine(text: string): string {
  return text.trim().split("\n")[0] ?? ""
}

/** The problem `gh auth status` reports: its line marked `X` under the host, else its first line. */
function authProblem(stderr: string): string {
  const marked = stderr.split("\n").find((line) => line.trimStart().startsWith("X "))
  return marked === undefined ? firstLine(stderr) : marked.trim().slice(2)
}

function gh(args: string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  if (result.error !== undefined) {
    if ("code" in result.error && result.error.code === "ENOENT") {
      throw new CannotShip("gh is not on PATH", REMEDIES.missing)
    }
    throw result.error
  }
  return { status: result.status ?? 1, stdout: result.stdout, stderr: result.stderr }
}

/** What `parse` returns; a reply it cannot parse stops the script, naming the field. */
function parseOrCannotShip<T>(parse: () => T): T {
  try {
    return parse()
  } catch (error) {
    if (error instanceof ReplyError) {
      throw new CannotShip(`the reply does not parse: ${error.message}`, REMEDIES.reply)
    }
    throw error
  }
}

/** The pull request named in full, or the one `gh pr view` resolves from what is given. */
function targetOf({ number, repo }: Cli): Target {
  if (number !== undefined && repo !== undefined) {
    return { repo, number }
  }
  const named = [...(number === undefined ? [] : [String(number)]), ...(repo === undefined ? [] : ["-R", repo])]
  const view = gh(["pr", "view", ...named, "--json", "url"])
  if (view.status !== 0) {
    throw new CannotShip(`gh pr view found no pull request: ${firstLine(view.stderr)}`, REMEDIES.view)
  }
  return parseOrCannotShip(() => parseView(view.stdout))
}

function read(cli: Cli): PrState {
  // The host gh api reads from: an account on any other host has no say in this call.
  const host = process.env.GH_HOST?.trim() || "github.com"
  const auth = gh(["auth", "status", "--active", "--hostname", host])
  if (auth.status !== 0) {
    throw new CannotShip(`gh auth status failed: ${authProblem(auth.stderr)}`, REMEDIES.auth)
  }
  const { repo, number } = targetOf(cli)
  const [owner = "", name = ""] = repo.split("/")
  const query = gh([
    "api",
    "graphql",
    "-f",
    `query=${QUERY}`,
    "-f",
    `owner=${owner}`,
    "-f",
    `name=${name}`,
    "-F",
    `number=${number}`
  ])
  if (query.status !== 0) {
    const said = firstLine(query.stderr).replace(/^gh: /, "")
    const remedy = said.startsWith("Could not resolve to a") ? REMEDIES.target : REMEDIES.read
    throw new CannotShip(`${repo}#${number}: ${said}`, remedy)
  }
  return parseOrCannotShip(() => parsePr(query.stdout, repo))
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
  try {
    pr = read(cli)
  } catch (error) {
    if (error instanceof CannotShip) {
      process.stderr.write(`dw-sdlc pr ship: ${error.message} — ${error.remedy}\n`)
      return 2
    }
    throw error
  }
  const answer = decide(pr)
  process.stdout.write(`${cli.json ? JSON.stringify(documentOf(pr, answer, cli.verbose), null, 2) : lineOf(answer)}\n`)
  return EXIT[answer.status]
}
