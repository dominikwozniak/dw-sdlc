// The read the pr commands and recap make: gh as a child process, its auth, the pull request a command names,
// its state from one GraphQL request with the compares that tell whether its head carries an earlier Review
// and that size its changes, and beside them the default branch and the clock the decision reads.

import { exec, TimedOut } from "../exec.ts"
import { behindOf, changedOf, changesOf, compareArgs, sameChanges } from "./delta.ts"
import { awaitsReview, parseDefaultBranch, parsePr, parseView, type PrState, QUERY, ReplyError } from "./state.ts"

/** What stops a pr command or recap before it answers: exit 2, the problem and its remedy on one line. */
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
  reply: "gh answered a shape dw-sdlc does not read; report it with the output of gh --version",
  clock: "unset it: it stands in for the clock in tests"
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

/** `gh args` as a child process; past its limit it stops the command as any other failed read does. */
function reachGh(args: string[]): ReturnType<typeof exec> {
  try {
    return exec("gh", args)
  } catch (error) {
    if (error instanceof TimedOut) {
      throw new CannotRun(error.message, REMEDIES.read)
    }
    throw error
  }
}

export function gh(args: string[]): { status: number; stdout: string; stderr: string } {
  const result = reachGh(args)
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

/** The remedy for a pull request `command`, as `pr ship`, cannot find by itself: name it in full. */
export function nameItRemedy(command: string): string {
  return `name it: dw-sdlc ${command} <n> -R owner/name`
}

/** The pull request named in full, or the one `gh pr view` resolves from what is given. */
function targetOf({ number, repo }: Named, command: string): { repo: string; number: number } {
  if (number !== undefined && repo !== undefined) {
    return { repo, number }
  }
  const named = [...(number === undefined ? [] : [String(number)]), ...(repo === undefined ? [] : ["-R", repo])]
  const view = gh(["pr", "view", ...named, "--json", "url"])
  if (view.status !== 0) {
    throw new CannotRun(`gh pr view found no pull request: ${firstLine(view.stderr)}`, nameItRemedy(command))
  }
  return parseOrCannotRun(() => parseView(view.stdout))
}

function requireAuth(): void {
  // The host gh api reads from: an account on any other host has no say in this call.
  const host = process.env.GH_HOST?.trim() || "github.com"
  const auth = gh(["auth", "status", "--active", "--hostname", host])
  if (auth.status !== 0) {
    throw new CannotRun(`gh auth status failed: ${authProblem(auth.stderr)}`, REMEDIES.auth)
  }
}

/**
 * The state of the pull request `named`; `command`, as `pr ship`, names the call in a remedy. With
 * `sized`, as `pr.review: auto` needs, the read sizes the changes a Review would read.
 */
export function read(named: Named, command: string, sized: boolean): PrState {
  requireAuth()
  return query(targetOf(named, command), sized)
}

/** The pull request `gh pr view` resolves for the head branch `branch`, else the current one; null when none. */
function viewed(branch: string | undefined): { repo: string; number: number } | null {
  const view = gh(["pr", "view", ...(branch === undefined ? [] : [branch]), "--json", "url"])
  if (view.status === 0) {
    return parseOrCannotRun(() => parseView(view.stdout))
  }
  if (said(view.stderr).startsWith("no pull requests found")) {
    return null
  }
  throw new CannotRun(`gh pr view failed: ${said(view.stderr)}`, REMEDIES.read)
}

/**
 * The current branch's pull request, open or not, or null. gh tries `@{push}`, else the local name, which
 * misses a branch pushed under another name; then `upstreamName` is asked, and `byUpstream` says so.
 */
export function readBranch(
  sized: boolean,
  upstreamName: string | undefined
): { pr: PrState; byUpstream: boolean } | null {
  requireAuth()
  const own = viewed(undefined)
  if (own !== null) {
    return { pr: query(own, sized), byUpstream: false }
  }
  if (upstreamName === undefined) {
    return null
  }
  const found = viewed(upstreamName)
  return found === null ? null : { pr: query(found, sized), byUpstream: true }
}

/** The default branch of the repository gh resolves from the current directory. */
export function defaultBranch(): string {
  const view = gh(["repo", "view", "--json", "defaultBranchRef"])
  if (view.status !== 0) {
    throw new CannotRun(`gh repo view failed: ${said(view.stderr)}`, REMEDIES.read)
  }
  return parseOrCannotRun(() => parseDefaultBranch(view.stdout))
}

/** The time the decision reads: DW_SDLC_NOW, an ISO 8601 time a test sets, else the system clock. */
export function now(): number {
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

/** The state of `pr` once more, after an action the script performed on it: the same pull request. */
export function readAgain(pr: PrState, sized: boolean): PrState {
  return query(pr, sized)
}

/**
 * The compares this process has read, by repository and the two commits, so reads that share one ask gh
 * once: a compare of two commits never changes.
 */
const COMPARES = new Map<string, string>()

/** For a test that runs the command in its own process: each case starts with no compare read. */
export function forgetCompares(): void {
  COMPARES.clear()
}

/** The reply of the compare from `from` to `commit`, read once per process; `what` names it when gh refuses it. */
function compared(pr: Pick<PrState, "repo" | "number">, from: string, commit: string, what: string): string {
  const key = `${pr.repo} ${from}...${commit}`
  const known = COMPARES.get(key)
  if (known !== undefined) {
    return known
  }
  const reply = gh(compareArgs(pr.repo, from, commit))
  if (reply.status !== 0) {
    throw new CannotRun(`${pr.repo}#${pr.number}: ${what}: ${said(reply.stderr)}`, REMEDIES.read)
  }
  COMPARES.set(key, reply.stdout)
  return reply.stdout
}

/** Whether the head of `after` carries the base `before` read: the compare shows it behind by none. */
export function carriesBase(before: PrState, after: PrState): boolean {
  const reply = compared(after, before.baseOid, after.head, `the compare with ${before.baseOid.slice(0, 7)}`)
  return parseOrCannotRun(() => behindOf(reply)) === 0
}

/** The own changes of `pr` at `commit`, from the compare with its base; null when it cannot show them whole. */
function ownChanges(pr: Omit<PrState, "carried" | "changed">, commit: string): string[] | null {
  const reply = compared(pr, pr.baseOid, commit, `the compare with ${commit.slice(0, 7)}`)
  return parseOrCannotRun(() => changesOf(reply))
}

/**
 * `pr` and whether its head carries the success of the last commit a Review read: a clean read, only
 * merges since it, and the same own changes at both. A read mark never carries. The compares run only
 * when a Review awaits the head.
 */
function withCarried(pr: Omit<PrState, "carried" | "changed">): Omit<PrState, "changed"> {
  const last = pr.lastRead
  if (last === null || !last.clean || !last.mergesOnly || pr.state !== "OPEN" || !awaitsReview(pr)) {
    return { ...pr, carried: false }
  }
  return { ...pr, carried: sameChanges(ownChanges(pr, last.commit), ownChanges(pr, pr.head)) }
}

/**
 * `pr` and, when `sized` and a Review awaits a head that carries none, the files the Review would read:
 * the compare from the last commit a Review read, else from the base, to the head.
 */
function withChanged(pr: Omit<PrState, "changed">, sized: boolean): PrState {
  if (!sized || pr.carried || pr.state !== "OPEN" || !awaitsReview(pr)) {
    return { ...pr, changed: null }
  }
  const from = pr.lastRead?.commit ?? pr.baseOid
  const reply = compared(pr, from, pr.head, `the compare of ${from.slice(0, 7)}...${pr.head.slice(0, 7)}`)
  return { ...pr, changed: parseOrCannotRun(() => changedOf(reply)) }
}

/** The state of pull request `number` of `repo`, from one GraphQL request and the compares a Review needs. */
function query({ repo, number }: { repo: string; number: number }, sized: boolean): PrState {
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
  const parsed = parseOrCannotRun(() => parsePr(reply.stdout, repo))
  return withChanged(withCarried(parsed), sized)
}
