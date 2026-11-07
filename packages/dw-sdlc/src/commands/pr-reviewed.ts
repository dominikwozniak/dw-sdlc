// `dw-sdlc pr reviewed <n> --head <sha>`: pins a Review to the head it read, as the commit status
// `dw-sdlc/review`: success for a clean one, so a push after it leaves the new head unreviewed, and with
// --findings the read mark of one that left a Finding open, so the next Review reads the fix from it.

import { parseArgs } from "node:util"

import { MARK_STATE, REVIEW, REVIEW_STATE, reviewStatusArgs } from "../pr/decide.ts"
import { CannotRun, gh, namedProblem, read, said } from "../pr/read.ts"
import { READ_MARK } from "../pr/state.ts"

export const summary = "pin a Review to the head it read, as a commit status"

const USAGE = `Usage: dw-sdlc pr reviewed <n> [-R owner/name] --head <sha> [--findings] [--json]

Reads pull request <n> through gh, the read pr ship makes, and when its head is still <sha> posts
the commit status dw-sdlc/review in state success on it, the pull request's URL as its target: a
clean Review of that head. --findings posts it in state failure, described "${READ_MARK}": the
read mark of a Review that left a Finding open, from which pr ship reads the fix that follows. When
a push moved the head since the review, it posts nothing. One line, or one document with --json.
Needs an authenticated gh.

Exit 0 posted, 2 when it cannot run or the head moved.`

/** What the status says of the Review: clean, or the read mark of one that left a Finding open. */
const STATUS = {
  clean: { state: REVIEW_STATE, description: "a clean review of this head" },
  findings: { state: MARK_STATE, description: READ_MARK }
} as const

type Cli = { json: boolean; number: number; repo: string | undefined; head: string; findings: boolean }

function parseCli(argv: string[]): Cli | "help" | { error: string } {
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        help: { type: "boolean", short: "h" },
        json: { type: "boolean" },
        repo: { type: "string", short: "R" },
        head: { type: "string" },
        findings: { type: "boolean" }
      }
    })
    if (values.help === true) {
      return "help"
    }
    const [number, ...more] = positionals
    const { repo, head } = values
    if (number === undefined) {
      return { error: "name the pull request: dw-sdlc pr reviewed <n> --head <sha>" }
    }
    if (more.length > 0) {
      return { error: `name one pull request, not ${positionals.length}` }
    }
    const problem = namedProblem(number, repo)
    if (problem !== undefined) {
      return { error: problem }
    }
    if (head === undefined) {
      return { error: "name the head the review read: --head <sha>" }
    }
    if (!/^[0-9a-f]{40}$/.test(head)) {
      return { error: `--head takes the full 40-character sha, not ${JSON.stringify(head)}` }
    }
    return { json: values.json === true, number: Number(number), repo, head, findings: values.findings === true }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

/** Posts the review status on `head` once the read shows it is still the pull request's head. */
function post({ number, repo, head, findings }: Cli): void {
  const pr = read({ number, repo }, "pr reviewed", false)
  if (pr.head !== head) {
    throw new CannotRun(
      `${pr.repo}#${number}: the head is ${pr.head}, not ${head}: a push landed since the review`,
      "review the new head, then call again with its sha"
    )
  }
  const { state, description } = STATUS[findings ? "findings" : "clean"]
  const posted = gh(reviewStatusArgs(pr, description, state))
  if (posted.status !== 0) {
    throw new CannotRun(
      `${pr.repo}#${number}: posting ${REVIEW} failed: ${said(posted.stderr)}`,
      `check that gh's token may write commit statuses to ${pr.repo}, then call again`
    )
  }
}

export function run(argv: string[]): number {
  const cli = parseCli(argv)
  if (cli === "help") {
    process.stdout.write(`${USAGE}\n`)
    return 0
  }
  if ("error" in cli) {
    process.stderr.write(`dw-sdlc pr reviewed: ${cli.error}\n\n${USAGE}\n`)
    return 2
  }
  try {
    post(cli)
  } catch (error) {
    if (error instanceof CannotRun) {
      process.stderr.write(`dw-sdlc pr reviewed: ${error.message} — ${error.remedy}\n`)
      return 2
    }
    throw error
  }
  const { head } = cli
  const { state } = STATUS[cli.findings ? "findings" : "clean"]
  const answer = cli.json
    ? JSON.stringify({ head, context: REVIEW, state }, null, 2)
    : `posted ${REVIEW} ${state} on ${head}`
  process.stdout.write(`${answer}\n`)
  return 0
}
