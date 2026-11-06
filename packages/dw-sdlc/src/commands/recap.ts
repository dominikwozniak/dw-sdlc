// `dw-sdlc recap`: the facts a Recap rests on and whether the session can be closed, read from git and
// gh. It writes nothing: the Action of the branch's pull request is the Ship script's decision, read.

import { existsSync } from "node:fs"
import { resolve } from "node:path"
import { parseArgs } from "node:util"

import { findRepository, mainCheckout, resolveConfig } from "../agentic-config.ts"
import { type Answer, decide, declaredPolicy, labelOf, lineOf } from "../pr/decide.ts"
import { CannotRun, defaultBranch, now, readBranch } from "../pr/read.ts"
import type { PrState } from "../pr/state.ts"
import { git } from "../working-tree.ts"

export const summary = "the facts a Recap rests on and whether the session can be closed"

const USAGE = `Usage: dw-sdlc recap [--json]

Reads the current branch, its uncommitted changes, the commits that reach no remote, its pull request
and whether the session sits in a linked worktree, and answers whether the session can be closed, with
every reason. It writes nothing: the pull request's Action is the one dw-sdlc pr ship would answer, read
and never performed.

The session cannot be closed over a paused rebase, an uncommitted change, a commit pushed nowhere or only
part of the way, an open pull request whatever its Action, or commits on top of the base that no pull
request holds; the default branch and a branch guardrails.protectedBranches names need no pull request.
A pull request closed without merging holds nothing: its commits count as pushed only on a remote branch,
and the remote is asked whether its branch still stands. A linked worktree is a reason beside the
verdict, never against it: the session cannot remove the directory it runs in.
One line a fact, or one document with --json. Needs an authenticated gh and a remote it can read. A
detached HEAD or a repository with no remote asks gh nothing, and the verdict says so.

Exit 0 the session can be closed, 1 it cannot, 2 when it cannot run.`

type ReasonId =
  | "rebase"
  | "uncommitted"
  | "unpushed"
  | "no-upstream"
  | "no-pull-request"
  | "open-pull-request"
  | "merged"
  | "closed"
  | "worktree"
  | "clean"

/** Why the verdict is what it is: `blocks` says the reason keeps the session open. */
type Reason = { id: ReasonId; blocks: boolean; text: string }

type Local = {
  /** Null on a detached HEAD. */
  branch: string | null
  /** Null before the first commit. */
  head: string | null
  uncommitted: number
  /** Null when none is set or its ref is gone from the remote. */
  upstream: string | null
  /** The commits past the upstream or, without one, on no remote. */
  unpushed: number
  /** A rebase or `git am` stands paused: its tree can read clean at a pushed commit. */
  rebasing: boolean
  /** The checkout's top level, and whether it is a linked worktree. */
  worktree: { linked: boolean; path: string }
}

/** The Ship script's answer on the branch's pull request, beside what identifies it. */
type Shipped = { pr: PrState; answer: Answer }

function plural(howMany: number, word: string): string {
  return `${howMany} ${word}${howMany === 1 ? "" : "s"}`
}

/** `git <args>` at `root`; what it prints, or a stop naming its problem. */
function must(root: string, args: string[]): string {
  const result = git(root, args)
  if ("error" in result) {
    throw new CannotRun(result.error, "check the repository with git status")
  }
  return result.out
}

/** `git <args>` at `root`, or undefined when it exits non-zero as a question answered no. */
function asked(root: string, args: string[]): string | undefined {
  const result = git(root, args)
  return "out" in result ? result.out : undefined
}

function count(root: string, args: string[]): number {
  return Number(must(root, ["rev-list", "--count", ...args]))
}

/** The upstream of `branch`, unless git reports its ref gone. */
function upstreamOf(root: string, branch: string): string | null {
  const format = "%(upstream:short) %(upstream:track)"
  const [name = "", track] = must(root, ["for-each-ref", `--format=${format}`, `refs/heads/${branch}`]).split(" ")
  return name === "" || track === "[gone]" ? null : name
}

/** Git's own record of a paused rebase or `git am`, in the git directory a linked worktree keeps apart. */
function isRebasing(root: string): boolean {
  const records = ["rebase-merge", "rebase-apply"]
  return records.some((record) => existsSync(resolve(root, must(root, ["rev-parse", "--git-path", record]))))
}

function readLocal(root: string): Local {
  const branch = asked(root, ["symbolic-ref", "--quiet", "--short", "HEAD"]) ?? null
  const head = asked(root, ["rev-parse", "--verify", "--quiet", "HEAD"]) ?? null
  const status = must(root, ["status", "--porcelain"])
  const upstream = branch === null ? null : upstreamOf(root, branch)
  const pushed = upstream === null ? ["HEAD", "--not", "--remotes"] : ["@{upstream}..HEAD"]
  return {
    branch,
    head,
    uncommitted: status === "" ? 0 : status.split("\n").length,
    upstream,
    unpushed: head === null ? 0 : count(root, pushed),
    rebasing: isRebasing(root),
    worktree: { linked: mainCheckout(root) !== undefined, path: root }
  }
}

/** The current branch's pull request and the Action the Ship script's decision gives it, or null. */
function readShipped(root: string): Shipped | null {
  // An invalid config layer resolves to ask and full, as in the Ship script.
  const policy = declaredPolicy(resolveConfig(root).config.pr)
  const pr = readBranch(policy.review.depth === "auto")
  return pr === null ? null : { pr, answer: decide(pr, now(), policy) }
}

/** The upstream of `branch`, as `--remotes` names it, when the remote no longer has it; a fetch may not have said so. */
function staleUpstream(root: string, branch: string): string | null {
  const format = "%(upstream:lstrip=2) %(upstream:remotename) %(upstream:remoteref)"
  const line = must(root, ["for-each-ref", `--format=${format}`, `refs/heads/${branch}`])
  const [tracking = "", remote = "", ref = ""] = line.split(" ")
  return must(root, ["ls-remote", remote, ref]) === "" ? tracking : null
}

/**
 * Where the head stands once the pull request is read. A commit an open or merged one holds is on GitHub,
 * whatever became of the upstream. A closed one lands nothing, so only a remote branch that still stands
 * counts for its commits.
 */
function standing(root: string, read: Local, shipped: Shipped | null): Local {
  if (shipped === null || read.head === null) {
    return read
  }
  if (shipped.pr.state !== "CLOSED") {
    return shipped.pr.commits.includes(read.head) ? { ...read, unpushed: 0 } : read
  }
  const stale = read.branch === null || read.upstream === null ? null : staleUpstream(root, read.branch)
  if (stale === null) {
    return read
  }
  return { ...read, upstream: null, unpushed: count(root, ["HEAD", "--not", `--exclude=${stale}`, "--remotes"]) }
}

/** How many commits sit on top of `base`, the branch a pull request for them would land on. */
type Ahead = { base: string; commits: number }

/**
 * The commits on top of the base that no pull request holds. A branch the config protects takes changes
 * through pull requests rather than making one, and so does the default branch: neither needs one.
 */
function aheadOf(root: string, branch: string, shipped: Shipped | null): Ahead | null {
  if (resolveConfig(root).config.guardrails.protectedBranches.includes(branch)) {
    return null
  }
  const base = shipped?.pr.base ?? defaultBranch()
  if (branch === base) {
    return null
  }
  const refs = must(root, ["remote"])
    .split("\n")
    .map((remote) => `refs/remotes/${remote}/${base}`)
    .filter((ref) => asked(root, ["rev-parse", "--verify", "--quiet", ref]) !== undefined)
  return { base, commits: count(root, ["HEAD", "--not", ...refs]) }
}

function unpushedReason({ branch, upstream, unpushed }: Local): Reason {
  const commits = plural(unpushed, "commit")
  if (upstream !== null) {
    return { id: "unpushed", blocks: true, text: `${commits} not pushed to ${upstream}` }
  }
  const where = branch === null ? "on a detached HEAD, on no remote" : "on a branch with no upstream"
  return { id: "no-upstream", blocks: true, text: `${commits} ${where}` }
}

function pullRequestReason({ pr, answer }: Shipped): Reason {
  const name = `pull request #${pr.number}`
  if (pr.state === "OPEN") {
    return { id: "open-pull-request", blocks: true, text: `${name} is open: ${labelOf(answer)}: ${answer.reason}` }
  }
  return { id: pr.state === "MERGED" ? "merged" : "closed", blocks: false, text: `${name} ${answer.reason}` }
}

/** The reason when none blocks; `askedGh` false says what the verdict never read, so it claims no more. */
function cleanReason(askedGh: boolean): Reason {
  const text = askedGh
    ? "nothing is uncommitted, unpushed or open"
    : "nothing is uncommitted or unpushed; gh was not asked"
  return { id: "clean", blocks: false, text }
}

function reasonsOf(local: Local, shipped: Shipped | null, ahead: Ahead | null, askedGh: boolean): Reason[] {
  const all: Reason[] = []
  if (local.rebasing) {
    all.push({ id: "rebase", blocks: true, text: "a rebase or am is paused" })
  }
  if (local.uncommitted > 0) {
    all.push({ id: "uncommitted", blocks: true, text: plural(local.uncommitted, "uncommitted change") })
  }
  if (local.unpushed > 0) {
    all.push(unpushedReason(local))
  }
  if (ahead !== null && ahead.commits > 0) {
    const text = `${plural(ahead.commits, "commit")} on top of ${ahead.base} in no pull request`
    all.push({ id: "no-pull-request", blocks: true, text })
  }
  if (shipped !== null) {
    all.push(pullRequestReason(shipped))
  }
  if (!all.some((reason) => reason.blocks)) {
    all.unshift(cleanReason(askedGh))
  }
  if (local.worktree.linked) {
    all.push({ id: "worktree", blocks: false, text: `the worktree at ${local.worktree.path} is left to remove` })
  }
  return all
}

/** The verdict and the line a Recap quotes: after "no" only what blocks, after "yes" every reason. */
function closeOf(reasons: Reason[]): { verdict: "yes" | "no"; line: string; reasons: Reason[] } {
  const blocking = reasons.filter((reason) => reason.blocks)
  const verdict = blocking.length > 0 ? "no" : "yes"
  const shown = blocking.length > 0 ? blocking : reasons
  const line = `Close the session: ${verdict}, because ${shown.map((reason) => reason.text).join("; ")}`
  return { verdict, line, reasons }
}

function linesOf(local: Local, shipped: Shipped | null, line: string): string {
  return [
    `branch: ${local.branch ?? "detached HEAD"}`,
    `uncommitted: ${local.uncommitted}`,
    `upstream: ${local.upstream ?? "none"}, ${local.unpushed} unpushed`,
    `pull request: ${shipped === null ? "none" : `${shipped.pr.url} ${lineOf(shipped.answer)}`}`,
    `worktree: ${local.worktree.linked ? `linked at ${local.worktree.path}` : "main checkout"}`,
    line
  ].join("\n")
}

function parseCli(argv: string[]): { help: boolean; json: boolean } | { error: string } {
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: { help: { type: "boolean", short: "h" }, json: { type: "boolean" } }
    })
    if (positionals.length > 0 && values.help !== true) {
      return { error: `it takes no argument, not ${JSON.stringify(positionals[0])}` }
    }
    return { help: values.help === true, json: values.json === true }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

function report(json: boolean): number {
  const root = findRepository(process.cwd())
  if (root === undefined) {
    throw new CannotRun(`no git repository holds ${process.cwd()}`, "run it from a checkout")
  }
  const read = readLocal(root)
  const { branch, head } = read
  // A detached HEAD names no branch for gh to look up, and a repository with no remote has no GitHub.
  const asksGh = branch !== null && must(root, ["remote"]) !== ""
  const shipped = asksGh ? readShipped(root) : null
  const local = standing(root, read, shipped)
  const held = shipped !== null && head !== null && shipped.pr.commits.includes(head)
  // An open pull request can still take the head, and a commit-less repository has nothing to land.
  const nothingToLand = held || shipped?.pr.state === "OPEN" || head === null
  const ahead = asksGh && !nothingToLand ? aheadOf(root, branch, shipped) : null
  const close = closeOf(reasonsOf(local, shipped, ahead, asksGh))
  const pullRequest =
    shipped === null
      ? null
      : { url: shipped.pr.url, number: shipped.pr.number, state: shipped.pr.state, ...shipped.answer }
  const output = json ? JSON.stringify({ ...local, pullRequest, close }, null, 2) : linesOf(local, shipped, close.line)
  process.stdout.write(`${output}\n`)
  return close.verdict === "yes" ? 0 : 1
}

export function run(argv: string[]): number {
  const cli = parseCli(argv)
  if ("error" in cli) {
    process.stderr.write(`dw-sdlc recap: ${cli.error}\n\n${USAGE}\n`)
    return 2
  }
  if (cli.help) {
    process.stdout.write(`${USAGE}\n`)
    return 0
  }
  try {
    return report(cli.json)
  } catch (error) {
    if (error instanceof CannotRun) {
      process.stderr.write(`dw-sdlc recap: ${error.message} — ${error.remedy}\n`)
      return 2
    }
    throw error
  }
}
