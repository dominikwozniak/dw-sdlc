// The read both pr commands make: gh as a child process, its auth on the host gh api reads from, the
// pull request a command names, and that pull request's state from one GraphQL request, with the two
// compares that tell whether its head carries an earlier Review.

import { spawnSync } from "node:child_process"

import { changesOf, compareArgs, sameChanges } from "./delta.ts"
import { awaitsReview, parsePr, parseView, type PrState, QUERY, ReplyError } from "./state.ts"

/** What stops a pr command before it answers: exit 2, the problem and its remedy on one line. */
export class CannotRun extends Error {
  remedy: string
  constructor(message: string, remedy: string) {
    super(message)
    this.remedy = remedy
  }
}

/** The pull request a command line names; what it leaves out, `gh pr view` resolves. */
export type Named = { number: number | undefined; repo: string | undefined }

const REMEDIES = {
  missing: "install the GitHub CLI from https://cli.github.com",
  auth: "run gh auth login, or set GH_TOKEN",
  target: "check the number, or name the repository with -R owner/name",
  read: "check gh auth status and the network, then call again",
  reply: "gh answered a shape dw-sdlc does not read; report it with the output of gh --version"
}

/** The problem with `<n>` or `-R` as given on a command line, if there is one. */
export function namedProblem(number: string | undefined, repo: string | undefined): string | undefined {
  if (number !== undefined && !/^[1-9]\d*$/.test(number)) {
    return `${JSON.stringify(number)} is not a pull request number`
  }
  if (repo !== undefined && !/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    return `-R takes owner/name, not ${JSON.stringify(repo)}`
  }
  return undefined
}

function firstLine(text: string): string {
  return text.trim().split("\n")[0] ?? ""
}

/** What gh said went wrong: the first line of its stderr, without its `gh: ` prefix or its `X` icon. */
export function said(stderr: string): string {
  return firstLine(stderr).replace(/^(?:gh: |X )/, "")
}

/** The problem `gh auth status` reports: its line marked `X` under the host, else its first line. */
function authProblem(stderr: string): string {
  const marked = stderr.split("\n").find((line) => line.trimStart().startsWith("X "))
  return marked === undefined ? firstLine(stderr) : marked.trim().slice(2)
}

export function gh(args: string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  if (result.error !== undefined) {
    if ("code" in result.error && result.error.code === "ENOENT") {
      throw new CannotRun("gh is not on PATH", REMEDIES.missing)
    }
    throw result.error
  }
  return { status: result.status ?? 1, stdout: result.stdout, stderr: result.stderr }
}

/** What `parse` returns; a reply it cannot parse stops the command, naming the field. */
function parseOrCannotRun<T>(parse: () => T): T {
  try {
    return parse()
  } catch (error) {
    if (error instanceof ReplyError) {
      throw new CannotRun(`the reply does not parse: ${error.message}`, REMEDIES.reply)
    }
    throw error
  }
}

/** The pull request named in full, or the one `gh pr view` resolves from what is given. */
function targetOf({ number, repo }: Named, command: string): { repo: string; number: number } {
  if (number !== undefined && repo !== undefined) {
    return { repo, number }
  }
  const named = [...(number === undefined ? [] : [String(number)]), ...(repo === undefined ? [] : ["-R", repo])]
  const view = gh(["pr", "view", ...named, "--json", "url"])
  if (view.status !== 0) {
    const remedy = `name it: dw-sdlc ${command} <n> -R owner/name`
    throw new CannotRun(`gh pr view found no pull request: ${firstLine(view.stderr)}`, remedy)
  }
  return parseOrCannotRun(() => parseView(view.stdout))
}

/** The state of the pull request `named`; `command`, as `pr ship`, names the call in a remedy. */
export function read(named: Named, command: string): PrState {
  // The host gh api reads from: an account on any other host has no say in this call.
  const host = process.env.GH_HOST?.trim() || "github.com"
  const auth = gh(["auth", "status", "--active", "--hostname", host])
  if (auth.status !== 0) {
    throw new CannotRun(`gh auth status failed: ${authProblem(auth.stderr)}`, REMEDIES.auth)
  }
  return query(targetOf(named, command))
}

/** The state of `pr` once more, after an action the script performed on it: the same pull request. */
export function readAgain(pr: PrState): PrState {
  return query(pr)
}

/** The own changes of `pr` at `commit`, from the compare with its base; null when it cannot show them whole. */
function ownChanges(pr: Omit<PrState, "carried">, commit: string): string[] | null {
  const reply = gh(compareArgs(pr.repo, pr.baseOid, commit))
  if (reply.status !== 0) {
    const problem = `the compare with ${commit.slice(0, 7)}: ${said(reply.stderr)}`
    throw new CannotRun(`${pr.repo}#${pr.number}: ${problem}`, REMEDIES.read)
  }
  return parseOrCannotRun(() => changesOf(reply.stdout))
}

/**
 * `pr` and whether its head carries the last reviewed commit's status: only merges since it, and the
 * same own changes at both. The compares run only when a Review awaits the head.
 */
function withCarried(pr: Omit<PrState, "carried">): PrState {
  const last = pr.lastReviewed
  if (last === null || !last.mergesOnly || pr.state !== "OPEN" || !awaitsReview(pr)) {
    return { ...pr, carried: false }
  }
  return { ...pr, carried: sameChanges(ownChanges(pr, last.commit), ownChanges(pr, pr.head)) }
}

/** The state of pull request `number` of `repo`, from one GraphQL request and the compares a Review needs. */
function query({ repo, number }: { repo: string; number: number }): PrState {
  const [owner = "", name = ""] = repo.split("/")
  const reply = gh([
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
  if (reply.status !== 0) {
    const problem = said(reply.stderr)
    const remedy = problem.startsWith("Could not resolve to a") ? REMEDIES.target : REMEDIES.read
    throw new CannotRun(`${repo}#${number}: ${problem}`, remedy)
  }
  return withCarried(parseOrCannotRun(() => parsePr(reply.stdout, repo)))
}
