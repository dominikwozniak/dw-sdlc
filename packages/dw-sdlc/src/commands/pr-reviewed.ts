// `dw-sdlc pr reviewed <n> --head <sha>`: pins a Review to the head it read, as the commit status
// `dw-sdlc/review` or, under footprint local, a mark in the Review state file: clean, --findings the read
// mark, --accept the dev's acceptance the review-limit park names, and under local --off a head no one read.

import { type Footprint, resolveConfig } from "../agentic-config.ts"
import { CannotRun, readArgs, usageError } from "../cannot-run.ts"
import { repositoryRoot } from "../git.ts"
import { REVIEW, REVIEW_STATE, reviewStatusArgs } from "../pr/decide.ts"
import { localReviews, type Mark } from "../pr/local-reviews.ts"
import { gh, namedProblem, pullRequestNamed, said } from "../pr/read.ts"
import { ACCEPTED, MARK_STATE, READ_MARK } from "../pr/state.ts"

export const summary = "pin a Review to the head it read, as a commit status or in the local Review state"

const USAGE = `Usage: dw-sdlc pr reviewed <n> [-R owner/name] --head <sha> [--findings | --accept | --off] [--json]

Reads pull request <n> through gh, the read pr ship makes, and when its head is still <sha> posts
the commit status dw-sdlc/review in state success on it, the pull request's URL as its target: a
clean Review of that head. --findings posts it in state failure, described "${READ_MARK}": the
read mark of a Review that left a Finding open, from which pr ship reads the fix that follows.
--accept posts it in state success, described "${ACCEPTED}": the dev takes the head as it stands, the
command the park review-limit names; only the dev runs it. --findings and --accept together exit 2.
When a push moved the head since the review, it posts nothing. One line, or one document with --json.
Needs an authenticated gh.

Under footprint local in .ai/agentic.config.json or its local layer it posts no status: it records the
mark on the head in .git/dw-sdlc/reviews/<n>.json, under the common git dir, beside the marks already
there: clean, findings with --findings, accepted with --accept, and off with --off, a head no one read
under off, the command pr ship names for it under --dry-run. --off takes footprint local alone.

Exit 0 posted, 2 when it cannot run or the head moved.`

/** What the status says: a clean Review, the read mark of one that left a Finding open, or the dev's acceptance. */
const STATUS = {
  clean: { state: REVIEW_STATE, description: "a clean review of this head" },
  findings: { state: MARK_STATE, description: READ_MARK },
  accepted: { state: REVIEW_STATE, description: ACCEPTED }
} as const

/** The mark each flag records. */
const MARK_OF = { findings: "findings", accept: "accepted", off: "off" } as const

type Cli = {
  help: false
  json: boolean
  number: number
  repo: string | undefined
  head: string
  mark: Mark
}

function parseCli(argv: string[]): Cli | { help: true } {
  const { values, positionals } = readArgs(
    {
      args: argv,
      allowPositionals: true,
      options: {
        help: { type: "boolean", short: "h" },
        json: { type: "boolean" },
        repo: { type: "string", short: "R" },
        head: { type: "string" },
        findings: { type: "boolean" },
        accept: { type: "boolean" },
        off: { type: "boolean" }
      }
    },
    USAGE
  )
  if (values.help === true) {
    return { help: true }
  }
  const [number, ...more] = positionals
  const { repo, head } = values
  if (number === undefined) {
    throw usageError("name the pull request: dw-sdlc pr reviewed <n> --head <sha>", USAGE)
  }
  if (more.length > 0) {
    throw usageError(`name one pull request, not ${positionals.length}`, USAGE)
  }
  const problem = namedProblem(number, repo)
  if (problem !== undefined) {
    throw usageError(problem, USAGE)
  }
  if (head === undefined) {
    throw usageError("name the head the review read: --head <sha>", USAGE)
  }
  if (!/^[0-9a-f]{40}$/.test(head)) {
    throw usageError(`--head takes the full 40-character sha, not ${JSON.stringify(head)}`, USAGE)
  }
  const named = (["findings", "accept", "off"] as const).filter((flag) => values[flag] === true)
  if (named.length > 1) {
    throw usageError(`${named.map((flag) => `--${flag}`).join(" and ")} contradict: name one`, USAGE)
  }
  const [flag] = named
  const mark: Mark = flag === undefined ? "clean" : MARK_OF[flag]
  return { help: false, json: values.json === true, number: Number(number), repo, head, mark }
}

/** The pull request's number once the read shows `head` is still its head. */
function stillHead({ number, repo, head }: Cli): { repo: string; url: string; head: string } {
  const pr = pullRequestNamed({ number, repo }, "pr reviewed")
  if (pr.head !== head) {
    throw new CannotRun(
      `${pr.repo}#${number}: the head is ${pr.head}, not ${head}: a push landed since the review`,
      "review the new head, then call again with its sha"
    )
  }
  return pr
}

/** Posts the review status on `head` once the read shows it is still the pull request's head. */
function post(cli: Cli, status: (typeof STATUS)[keyof typeof STATUS]): void {
  const { number } = cli
  const pr = stillHead(cli)
  const posted = gh(reviewStatusArgs(pr, status.description, status.state))
  if (posted.status !== 0) {
    throw new CannotRun(
      `${pr.repo}#${number}: posting ${REVIEW} failed: ${said(posted.stderr)}`,
      `check that gh's token may write commit statuses to ${pr.repo}, then call again`
    )
  }
}

/** Records the mark on `head` in the Review state under footprint local, once it is still the head. */
function record(cli: Cli, root: string): string {
  stillHead(cli)
  const reviews = localReviews(root)
  reviews.record(cli.number, cli.head, cli.mark)
  return reviews.fileOf(cli.number)
}

export function run(argv: string[]): number {
  const cli = parseCli(argv)
  if (cli.help) {
    process.stdout.write(`${USAGE}\n`)
    return 0
  }
  const root = repositoryRoot(process.cwd())
  const footprint: Footprint = resolveConfig(root).config.footprint
  const { head, mark } = cli
  if (footprint === "local") {
    const file = record(cli, root)
    const answer = cli.json ? JSON.stringify({ head, mark, file }, null, 2) : `recorded ${mark} on ${head} in ${file}`
    process.stdout.write(`${answer}\n`)
    return 0
  }
  if (mark === "off") {
    throw usageError("--off records a mark under footprint local alone: under github the Ship script posts off", USAGE)
  }
  const status = STATUS[mark]
  post(cli, status)
  const { state } = status
  const answer = cli.json
    ? JSON.stringify({ head, context: REVIEW, state }, null, 2)
    : `posted ${REVIEW} ${state} on ${head}`
  process.stdout.write(`${answer}\n`)
  return 0
}
