// `dw-sdlc recap`: the facts a Recap rests on and whether the session can be closed, read from git and
// gh. It writes nothing: the Action of the branch's pull request is the Ship script's decision, read.

import { existsSync } from "node:fs"
import { join } from "node:path"
import { parseArgs } from "node:util"

import { findRepository, mainCheckout, resolveConfig } from "../agentic-config.ts"
import { type Answer, decide, declaredPolicy, labelOf, lineOf } from "../pr/decide.ts"
import { CannotRun, defaultBranch, now, readBranch } from "../pr/read.ts"
import type { PrState } from "../pr/state.ts"
import { isLive, Refusal, type Worker, workersOf, workingFolders } from "../worker/herdr.ts"
import { git } from "../working-tree.ts"

export const summary = "the facts a Recap rests on and whether the session can be closed"

const USAGE = `Usage: dw-sdlc recap [--json]

Reads the current branch, its uncommitted changes, the commits that reach no remote, its pull request
and whether the session sits in a linked worktree, and answers whether the session can be closed, with
every reason. It writes nothing: the pull request's Action is the one dw-sdlc pr ship would answer, read
and never performed.

The session cannot be closed over any of these:
  a paused rebase, merge, cherry-pick, revert or bisect;
  an uncommitted change;
  a commit pushed nowhere or only part of the way;
  an open pull request, whatever its Action;
  commits on top of the base that no pull request holds. The default branch and a branch
  guardrails.protectedBranches names need no pull request;
  a live Worker this session started as a Lead, in a terminal herdr started ($HC_TERMINAL_ID): its
  report has no one to reach once the Lead is gone. A Worker whose turn ended is still live.

A pull request closed without merging merges nothing, and a detached HEAD names no pull request. There a
commit counts as pushed only on a remote branch, and the command asks the remote which branches still
stand. A branch force-pushed since the last fetch can still read as holding it, so fetch first to be exact.

A linked worktree is a reason beside the verdict, never against it: the session cannot remove the
directory it runs in.

One line a fact, or one document with --json. Needs an authenticated gh and a remote it can read, and in
herdr hc on PATH. A detached HEAD or a repository with no remote asks gh nothing, and the pull request
fact says so; outside herdr the workers fact says so.

Exit 0 the session can be closed, 1 it cannot, 2 when it cannot run.`

type ReasonId =
  | "paused"
  | "uncommitted"
  | "unpushed"
  | "no-upstream"
  | "no-pull-request"
  | "open-pull-request"
  | "orphaned"
  | "workers"
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
  /** Null when none is set, it is a local branch or its ref is gone from the remote. */
  upstream: string | null
  /** The commits past the upstream or, without one, on no remote; none when an open or merged pull request holds the head. */
  unpushed: number
  /** The operation git has paused, whose tree can read clean at a pushed commit; null when none is. */
  paused: string | null
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

function remotesOf(root: string): string[] {
  return must(root, ["remote"])
    .split("\n")
    .filter((remote) => remote !== "")
}

/** The remote-tracking upstream of `branch`, as `--remotes` names it, unless git reports its ref gone. */
function upstreamOf(root: string, branch: string): string | null {
  const prefix = "refs/remotes/"
  const format = "%(upstream) %(upstream:track)"
  const [ref = "", track] = must(root, ["for-each-ref", `--format=${format}`, `refs/heads/${branch}`]).split(" ")
  return ref.startsWith(prefix) && track !== "[gone]" ? ref.slice(prefix.length) : null
}

/** Git's own record of each paused operation, in the git directory a linked worktree keeps apart. */
const PAUSES = [
  { record: "rebase-merge", name: "rebase" },
  { record: "rebase-apply", name: "rebase or am" },
  { record: "MERGE_HEAD", name: "merge" },
  { record: "CHERRY_PICK_HEAD", name: "cherry-pick" },
  { record: "REVERT_HEAD", name: "revert" },
  { record: "sequencer", name: "cherry-pick or revert" },
  { record: "BISECT_LOG", name: "bisect" }
]

function pausedIn(root: string): string | null {
  const gitDir = must(root, ["rev-parse", "--absolute-git-dir"])
  return PAUSES.find(({ record }) => existsSync(join(gitDir, record)))?.name ?? null
}

function readLocal(root: string): Local {
  const branch = asked(root, ["symbolic-ref", "--quiet", "--short", "HEAD"]) ?? null
  const head = asked(root, ["rev-parse", "--verify", "--quiet", "HEAD"]) ?? null
  // Without the flag, git status refreshes the index, a write under a session working in this checkout.
  const status = must(root, ["--no-optional-locks", "status", "--porcelain", "--untracked-files=normal"])
  const upstream = branch === null ? null : upstreamOf(root, branch)
  const pushed = upstream === null ? ["HEAD", "--not", "--remotes"] : ["@{upstream}..HEAD"]
  return {
    branch,
    head,
    uncommitted: status === "" ? 0 : status.split("\n").length,
    upstream,
    unpushed: head === null ? 0 : count(root, pushed),
    paused: pausedIn(root),
    worktree: { linked: mainCheckout(root) !== undefined, path: root }
  }
}

/** The live Workers this session started as a Lead, each in the folder it works in; null outside herdr. */
function liveWorkers(): Worker[] | null {
  const lead = process.env.HC_TERMINAL_ID
  if (lead === undefined || lead === "") {
    return null
  }
  try {
    return workingFolders(workersOf(lead, false).filter(isLive))
  } catch (error) {
    if (error instanceof Refusal) {
      throw new CannotRun(error.message, error.remedy ?? "check hc ls, then call again")
    }
    throw error
  }
}

function workersText(workers: Worker[]): string {
  return workers.map((worker) => `${worker.name} (${worker.status})`).join(", ")
}

/**
 * The remote branch name `branch` tracks, when it differs from `branch`. Read from the config, so it holds
 * after the remote deleted the branch.
 */
function upstreamName(root: string, branch: string): string | undefined {
  const remote = asked(root, ["config", "--get", `branch.${branch}.remote`])
  const merge = asked(root, ["config", "--get", `branch.${branch}.merge`])
  if (remote === undefined || remote === "." || merge === undefined || !merge.startsWith("refs/heads/")) {
    return undefined
  }
  const name = merge.slice("refs/heads/".length)
  return name === branch ? undefined : name
}

/** Whether `pr`'s commits hold `head`, so the head is on GitHub whatever became of the upstream. */
function holds(pr: PrState, head: string | null): boolean {
  return head !== null && pr.commits.includes(head)
}

/**
 * The current branch's pull request and the Action the Ship script's decision gives it, or null. The one
 * found by the upstream's name counts only when it holds the head: a branch started from another tracks it.
 */
function readShipped(root: string, branch: string, head: string | null): Shipped | null {
  // An invalid config layer resolves to ask and full, as in the Ship script.
  const policy = declaredPolicy(resolveConfig(root).config.pr)
  const found = readBranch(policy.review.depth === "auto", upstreamName(root, branch))
  if (found === null || (found.byUpstream && !holds(found.pr, head))) {
    return null
  }
  return { pr: found.pr, answer: decide(found.pr, now(), policy) }
}

/**
 * The tracking refs, as `--remotes` names them, that the remote contradicts, which only a fetch would show:
 * a branch it no longer has, its `HEAD`, and the session's own branch where it moved. A remote out of reach
 * holds nothing; any other moved branch counts as before (plugins/sdlc-sessions/README.md says why).
 */
function staleTracking(root: string, { branch, upstream }: Local): string[] {
  return remotesOf(root).flatMap((remote) => {
    const live = new Map(
      (asked(root, ["ls-remote", "--heads", remote]) ?? "").split("\n").map((line): [string, string] => {
        const [oid = "", ref = ""] = line.split("\t")
        return [ref.replace("refs/heads/", `${remote}/`), oid]
      })
    )
    return must(root, ["for-each-ref", "--format=%(refname:lstrip=2) %(objectname)", `refs/remotes/${remote}`])
      .split("\n")
      .map((line) => line.split(" "))
      .filter(([tracking = "", oid]) => {
        const own = tracking === upstream || tracking === `${remote}/${branch}`
        return tracking !== "" && (!live.has(tracking) || (own && live.get(tracking) !== oid))
      })
      .map(([tracking = ""]) => tracking)
  })
}

/**
 * Where the head stands once the pull request is read. A commit an open or merged one holds is on GitHub,
 * whatever became of the upstream. A closed one merges nothing and a detached HEAD names none, so there only
 * a remote branch that still stands counts for the head. A paused operation has answered already.
 */
function standing(root: string, read: Local, shipped: Shipped | null, held: boolean): Local {
  const asksRemote = read.paused === null && (read.branch === null || shipped?.pr.state === "CLOSED")
  if (!asksRemote || read.head === null) {
    return held ? { ...read, unpushed: 0 } : read
  }
  const stale = staleTracking(root, read)
  if (read.upstream !== null && !stale.includes(read.upstream)) {
    return read
  }
  const unpushed = count(root, ["HEAD", ...notOnRemotes(stale)])
  return { ...read, upstream: null, unpushed }
}

/** `rev-list` arguments that leave out what a remote branch holds, by the tracking refs still true. */
function notOnRemotes(stale: string[]): string[] {
  return ["--not", ...stale.map((tracking) => `--exclude=${tracking}`), "--remotes"]
}

/**
 * The commits of a closed pull request that left the branch, as by a reset, and that no remote branch holds.
 * A head this checkout never had was never this session's to lose.
 */
function orphanedOf(root: string, read: Local, shipped: Shipped | null, held: boolean): number {
  if (shipped?.pr.state !== "CLOSED" || held || read.paused !== null) {
    return 0
  }
  return Number(asked(root, ["rev-list", "--count", shipped.pr.head, ...notOnRemotes(staleTracking(root, read))]) ?? 0)
}

/** How many commits sit on top of `base`, the branch a pull request for them would merge into. */
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
  const refs = remotesOf(root)
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

/** What the close verdict reads beside the checkout. */
type Facts = {
  shipped: Shipped | null
  ahead: Ahead | null
  orphaned: number
  askedGh: boolean
  workers: Worker[] | null
}

function reasonsOf(local: Local, { shipped, ahead, orphaned, askedGh, workers }: Facts): Reason[] {
  const all: Reason[] = []
  if (local.paused !== null) {
    all.push({ id: "paused", blocks: true, text: `a ${local.paused} is paused` })
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
  if (shipped !== null && orphaned > 0) {
    const text = `${plural(orphaned, "commit")} of pull request #${shipped.pr.number} on no remote branch`
    all.push({ id: "orphaned", blocks: true, text })
  }
  if (shipped !== null) {
    all.push(pullRequestReason(shipped))
  }
  if (workers !== null && workers.length > 0) {
    const text = `${plural(workers.length, "live Worker")}: ${workersText(workers)}`
    all.push({ id: "workers", blocks: true, text })
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

function workersLine(workers: Worker[] | null): string {
  if (workers === null) {
    return "not in herdr"
  }
  return workers.length === 0 ? "none live" : `${workers.length} live: ${workersText(workers)}`
}

function linesOf(local: Local, { shipped, askedGh, workers }: Facts, line: string): string {
  const none = askedGh ? "none" : "gh not asked"
  return [
    `branch: ${local.branch ?? "detached HEAD"}`,
    `uncommitted: ${local.uncommitted}`,
    `upstream: ${local.upstream ?? "none"}, ${local.unpushed} unpushed`,
    `pull request: ${shipped === null ? none : `${shipped.pr.url} ${lineOf(shipped.answer)}`}`,
    `worktree: ${local.worktree.linked ? `linked at ${local.worktree.path}` : "main checkout"}`,
    `workers: ${workersLine(workers)}`,
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
  const asksGh = branch !== null && remotesOf(root).length > 0
  const shipped = asksGh ? readShipped(root, branch, head) : null
  const held = shipped !== null && holds(shipped.pr, head)
  const local = standing(root, read, shipped, held)
  // An open pull request can still take the head, and a commit-less repository has nothing to merge.
  const nothingToMerge = held || shipped?.pr.state === "OPEN" || head === null
  const ahead = asksGh && !nothingToMerge ? aheadOf(root, branch, shipped) : null
  const facts: Facts = {
    shipped,
    ahead,
    orphaned: orphanedOf(root, read, shipped, held),
    askedGh: asksGh,
    workers: liveWorkers()
  }
  const close = closeOf(reasonsOf(local, facts))
  const pullRequest =
    shipped === null
      ? null
      : { url: shipped.pr.url, number: shipped.pr.number, state: shipped.pr.state, ...shipped.answer }
  const output = json
    ? JSON.stringify({ ...local, askedGh: asksGh, pullRequest, workers: facts.workers, close }, null, 2)
    : linesOf(local, facts, close.line)
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
