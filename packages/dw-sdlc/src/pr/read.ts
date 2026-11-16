// The read the pr commands and recap make: gh as a child process, its auth, the pull request a command names,
// its state from one GraphQL request and the Review's standing at its head from GitHub's compares, through
// gh, and beside them the default branch and the clock the decision reads.

import { CannotRun } from "../cannot-run.ts"
import { type Called, firstLine, need } from "../exec.ts"
import { behindOf, changedOf, changesOf, compareArgs } from "./delta.ts"
import { type LocalReviews, withMarks } from "./local-reviews.ts"
import { ReplyError } from "./reply.ts"
import { type Compares, standingOf } from "./standing.ts"
import { awaitsReview, parseDefaultBranch, parsePr, parseView, type PrState, type PullRequest, QUERY } from "./state.ts"
import { holds, renamedUpstream } from "./upstream.ts"

/** The pull request a command line names; what it leaves out, `gh pr view` resolves. */
export type Named = { number: number | undefined; repo: string | undefined }
/** A pull request by its repository and number. */
type Target = { repo: string; number: number }

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

/** What gh said went wrong: the first line of its stderr, without its `gh: ` prefix or its `X` icon. */
export function said(stderr: string): string {
  return (firstLine(stderr) ?? "").replace(/^(?:gh: |X )/, "")
}

/** The problem `gh auth status` reports: its line marked `X` under the host, else its first line. */
function authProblem(stderr: string): string {
  const marked = stderr.split("\n").find((line) => line.trimStart().startsWith("X "))
  return marked === undefined ? (firstLine(stderr) ?? "") : marked.trim().slice(2)
}

/** `gh args` as a child process; not on PATH, or past its limit, it stops the command as any failed read does. */
export function gh(args: string[]): Called {
  return need("gh", args, { missing: REMEDIES.missing, stalled: REMEDIES.read })
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
function targetOf({ number, repo }: Named, command: string): Target {
  if (number !== undefined && repo !== undefined) {
    return { repo, number }
  }
  const named = [...(number === undefined ? [] : [String(number)]), ...(repo === undefined ? [] : ["-R", repo])]
  const view = gh(["pr", "view", ...named, "--json", "url"])
  if (view.status !== 0) {
    throw new CannotRun(`gh pr view found no pull request: ${firstLine(view.stderr) ?? ""}`, nameItRemedy(command))
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

/** The pull request `gh pr view` resolves for the head branch `branch`, else the current one, or what gh said of none. */
function viewed(branch: string | undefined): Target | { none: string } {
  const view = gh(["pr", "view", ...(branch === undefined ? [] : [branch]), "--json", "url"])
  if (view.status === 0) {
    return parseOrCannotRun(() => parseView(view.stdout))
  }
  if (said(view.stderr).startsWith("no pull requests found")) {
    return { none: said(view.stderr) }
  }
  throw new CannotRun(`gh pr view failed: ${said(view.stderr)}`, REMEDIES.read)
}

/** Why this checkout names no pull request to read; `lacksHead` when the one its upstream's name finds lacks HEAD. */
export type NoPr = { problem: string; lacksHead: boolean }

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

/** A commit as a reason names it: its first seven characters. */
function short(commit: string): string {
  return commit.slice(0, 7)
}

/** The gh adapter of the standing's compares on one pull request, and the compare an update is judged by. */
type GhCompares = Compares & { behind: (base: string, head: string) => number }

/**
 * The gh adapter on `target`. A compare of two commits never changes, so it asks gh for each once, for its
 * own life; a compare gh refuses stops the command, naming it.
 */
function ghCompares(target: Target): GhCompares {
  const replies = new Map<string, string>()
  const replyOf = (from: string, to: string, what: string): string => {
    const key = `${from}...${to}`
    const known = replies.get(key)
    if (known !== undefined) {
      return known
    }
    const reply = gh(compareArgs(target.repo, from, to))
    if (reply.status !== 0) {
      throw new CannotRun(`${target.repo}#${target.number}: ${what}: ${said(reply.stderr)}`, REMEDIES.read)
    }
    replies.set(key, reply.stdout)
    return reply.stdout
  }
  return {
    ownChanges: (base, commit) =>
      parseOrCannotRun(() => changesOf(replyOf(base, commit, `the compare with ${short(commit)}`))),
    changed: (from, head) =>
      parseOrCannotRun(() => changedOf(replyOf(from, head, `the compare of ${short(from)}...${short(head)}`))),
    behind: (base, head) => parseOrCannotRun(() => behindOf(replyOf(base, head, `the compare with ${short(base)}`)))
  }
}

/** The pull request `named` from the one GraphQL request alone, without the compares the Review's standing reads. */
export function pullRequestNamed(named: Named, command: string): PullRequest {
  requireAuth()
  const target = targetOf(named, command)
  return parseOrCannotRun(() => parsePr(graphql(target), target.repo)).pr
}

/** The reads of pull requests one command makes through gh, each one's compares kept for the reads' life. */
export type Reads = {
  /** The state of the pull request `named`; `command`, as `pr ship`, names the call in a remedy. */
  named: (named: Named, command: string) => PrState
  /**
   * The pull request of the branch checked out at `root`, open or not. gh tries `@{push}`, else the local
   * name, which misses a branch pushed under another name: then it asks by the name the upstream gives.
   */
  checkout: (root: string) => PrState | NoPr
  /** The state of `pr` once more, after an action the script performed on it. */
  again: (pr: PrState) => PrState
  /** Whether the head of `after` carries the base `before` read: the compare shows it behind by none. */
  carriesBase: (before: PrState, after: PrState) => boolean
}

/**
 * The reads of one command; with `sized`, as `pr.review: auto` needs, each sizes the changes a Review would
 * read. Under footprint local, `local` holds the Review state each read takes in the place of the statuses.
 */
export function ghReads(sized: boolean, local: LocalReviews | null = null): Reads {
  const adapters = new Map<string, GhCompares>()
  const comparesOn = (target: Target): GhCompares => {
    const key = `${target.repo}#${target.number}`
    const adapter = adapters.get(key) ?? ghCompares(target)
    adapters.set(key, adapter)
    return adapter
  }
  const query = (target: Target): PrState => {
    const parsed = parseOrCannotRun(() => parsePr(graphql(target), target.repo))
    const { pr, history } = local === null ? parsed : withMarks(parsed, local.marksOf(target.number))
    const awaits = pr.state === "OPEN" && awaitsReview(pr)
    return { ...pr, ...standingOf(history, comparesOn(target), { awaits, sized }) }
  }
  return {
    named: (named, command) => {
      requireAuth()
      return query(targetOf(named, command))
    },
    checkout: (root) => {
      requireAuth()
      const own = viewed(undefined)
      if (!("none" in own)) {
        return query(own)
      }
      const renamed = renamedUpstream(root)
      if (renamed === undefined) {
        return { problem: `gh pr view found no pull request: ${own.none}`, lacksHead: false }
      }
      const { branch, head, upstream } = renamed
      const named = `${upstream}, the name its upstream gives`
      const found = viewed(upstream)
      if ("none" in found) {
        return { problem: `gh pr view found no pull request for ${branch}, nor for ${named}`, lacksHead: false }
      }
      // A branch started from another tracks that branch until its first push: its pull request is not this one.
      const pr = query(found)
      return holds(pr, head)
        ? pr
        : { problem: `${pr.url}, found by ${named}, lacks HEAD ${short(head)}`, lacksHead: true }
    },
    again: query,
    carriesBase: (before, after) => comparesOn(after).behind(before.baseOid, after.head) === 0
  }
}

/** The reply of the one GraphQL request for pull request `number` of `repo`. */
function graphql({ repo, number }: Target): string {
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
  return reply.stdout
}
