// `dw-sdlc sweep`: removes each linked worktree whose whole set passes and each Landed local branch.
// docs/adr/0015 sets its bounds: it runs from the main checkout, never forces and never writes to a remote.

import { existsSync } from "node:fs"

import { findRepository, mainCheckout, resolveConfig } from "../agentic-config.ts"
import { CannotRun, readArgs, usageError } from "../cannot-run.ts"
import { SLOW_LIMIT_MS } from "../exec.ts"
import { asked, git } from "../git.ts"
import { isCommitLanded } from "../landed.ts"
import { shellLine } from "../pr/decide.ts"
import { apply, type Item, type Judged, type Kept, type Planned } from "../sweep-removal.ts"
import {
  type Holder,
  holdersOf,
  keptIn,
  lockHolder,
  outsideWorktrees,
  readTerminals,
  stopsOf,
  sweepingTerminal,
  type Terminals,
  whyHeld
} from "../sweep-terminals.ts"
import {
  branchesOf,
  forcedDelete,
  switchOff,
  tipOf,
  type Tree,
  unlockCommand,
  whyUnclean,
  worktreesOf
} from "../sweep-trees.ts"
import { type LockVerdict, lockVerdict } from "../worktree-lock.ts"

export const summary = "removes Landed branches and clean worktrees whose work has landed, names what it keeps"

const USAGE = `Usage: dw-sdlc sweep [--dry-run] [--json]

Run from the main checkout. Fetches origin, reads the base branch as the guards do (baseBranch of the
config, else the branch origin/HEAD names) and removes, never forcing:
  every linked worktree, wherever it lies, whose whole set passes: no modified or untracked file (ignored
  files aside), no paused rebase, merge, cherry-pick, revert or bisect, no lock but a stale Claude Code
  one, and its HEAD Landed, on a branch or detached; the branch it had checked out goes right after it. A
  Claude Code lock, "claude session <name> (pid <N> start <time>)", is stale when no process N runs or N
  started at another time; it is lifted just before its worktree goes, and lifted for no worktree that stays;
  every other local branch that is Landed: its work is on the base, as a squash merge leaves it.
It keeps, and names with the reason and the command to run yourself:
  a worktree that fails the set: the files that hold it with the forced removal, the paused operation, the
  lock's reason with git worktree unlock, a live Claude Code lock named by its pid, a HEAD that is not Landed;
  the default branch, the base branch, a protected branch and a branch a kept worktree has checked out; a
  Landed branch the main checkout has checked out, clean and with nothing paused, with git switch to the base;
  a branch whose work is on no commit of the base, with the forced delete.
It reads each worktree again just before it goes, its Worker stopped: one whose HEAD, branch or lock changed
since it was judged, or that holds a file or a paused operation by then, stays. A branch goes only while it
points at the commit judged Landed; one that moved since stays.
It never changes anything on a remote: the fetch only writes remote-tracking refs. A removal git refuses is
kept with git's words, one that outlives its time limit with the limit it hit, and the sweep goes on.

In herdr ($HC_TERMINAL_ID set) it reads, with hc, the Workers of this session, the terminals whose parent is
this one, and every other live terminal. A Worker whose status is none of working, blocked or yet to report
is stopped (hc kill) then removed (hc rm) when its worktree goes in the same Sweep or its folder is already
gone; a worktree is judged whole first, so no Worker is stopped beside work it could still commit. A live
Claude Code lock on that worktree that names the Worker's own program, the pid hc get reports, does not keep
it: once the Worker is stopped the lock is read again and lifted only when it is stale then, else the
worktree stays. A finished Worker of this session is removed. This session's own terminal and another
session's are never stopped: a worktree one is in stays, named with the terminal's address and place and
hc kill as the dev's command. Outside herdr no terminal is read, and the output says so. An hc that fails
ends the Sweep with exit 2 before anything is removed.

--dry-run removes and stops nothing and answers the same items. One line an item, or one document with --json:
  { dryRun, terminalsRead, base, removed: [item], kept: [item] }, an item { kind, name, reason, command? },
  kind branch, worktree, lock (a lifted one) or terminal, name its path or its address, command the one the
  dev would run for a kept item.

Exit 0 nothing is kept but the default, the base or a protected branch, 1 something else is, 2 when it
cannot run: in a linked worktree, with no base to read, when the fetch fails or when hc fails in herdr.`

type Shown = Item & { command?: string | null }

type Sweep = { dryRun: boolean; terminalsRead: boolean; base: string; removed: Shown[]; kept: Shown[] }

function fetchOrigin(root: string): void {
  if (asked(root, ["remote", "get-url", "origin"]) === undefined) {
    return
  }
  const fetched = git(root, ["fetch", "--quiet", "origin"], { limitMs: SLOW_LIMIT_MS })
  if ("error" in fetched) {
    throw new CannotRun(`git fetch origin failed: ${fetched.said}`, "check the network, then call again")
  }
}

/** The branch refs/remotes/origin/HEAD names, if it names one of origin. */
function originHead(root: string): string | undefined {
  const prefix = "refs/remotes/origin/"
  const ref = asked(root, ["symbolic-ref", "-q", "refs/remotes/origin/HEAD"])
  return ref !== undefined && ref.startsWith(prefix) && ref.length > prefix.length
    ? ref.slice(prefix.length)
    : undefined
}

/** The base branch the guard reads: `baseBranch` of the config, under `auto` the branch origin/HEAD names. */
function baseOf(root: string, head: string | undefined): { name: string; ref: string } {
  const configured = resolveConfig(root).config.baseBranch
  const name = configured === "" || configured === "auto" ? head : configured
  if (name === undefined) {
    throw new CannotRun(
      "no base branch is known to check the branches against: origin/HEAD names no branch of origin",
      "run git remote set-head origin --auto, or set baseBranch in .ai/agentic.config.json"
    )
  }
  const ref = `refs/remotes/origin/${name}`
  if (
    asked(root, ["check-ref-format", ref]) === undefined ||
    asked(root, ["rev-parse", "--verify", "-q", `${ref}^{commit}`]) === undefined
  ) {
    throw new CannotRun(
      `the base branch origin/${name} is not here to check the branches against`,
      "run git fetch origin, or fix baseBranch in .ai/agentic.config.json"
    )
  }
  return { name, ref }
}

/** Why the worktree stays, with the dev's command when there is one, or null when its whole set passes. */
function whyTreeStays(
  root: string,
  baseRef: string,
  tree: Tree,
  lock: LockVerdict,
  holders: Holder[]
): Pick<Kept, "reason" | "command"> | null {
  const { path } = tree
  if (lock.state === "stays") {
    return lock
  }
  const held = whyHeld(holders)
  if (held !== null) {
    return held
  }
  if (tree.prunable || !existsSync(path)) {
    const prune = shellLine(["git", "worktree", "prune"])
    return {
      reason: "its folder is gone",
      command: lock.state === "stale" ? `${unlockCommand(path)} && ${prune}` : prune
    }
  }
  const unclean = whyUnclean(path, lock.state === "stale")
  if (unclean !== null) {
    return unclean
  }
  if (!isCommitLanded(root, baseRef, tree.head)) {
    const at = tree.branch === undefined ? `its detached HEAD ${tree.head.slice(0, 9)}` : `its HEAD on ${tree.branch}`
    return { reason: `${at} is on no commit of ${baseRef.replace("refs/remotes/", "")} since it forked`, command: null }
  }
  return null
}

/** What keeps a branch whatever its work: the default branch, the base, a protected branch, a worktree's. */
type Footing = {
  head: string | undefined
  baseBranch: string
  protectedBranches: string[]
  held: Map<string, string>
}

/** A branch kept for what it is, never the dev's to decide. */
function standing(reason: string): Omit<Kept, "kind" | "name"> {
  return { reason, command: null, dev: false }
}

/** Why `branch` stays whatever its work, or null when only its work decides. */
function stays(
  branch: string,
  { head, baseBranch, protectedBranches, held }: Footing
): Omit<Kept, "kind" | "name"> | null {
  if (branch === head) {
    return standing("the default branch")
  }
  if (branch === baseBranch) {
    return standing("the base branch")
  }
  if (protectedBranches.includes(branch)) {
    return standing("a protected branch")
  }
  const path = held.get(branch)
  return path === undefined ? null : { reason: `checked out in the worktree at ${path}`, command: null, dev: true }
}

/** Fetches origin, then sorts each linked worktree, local branch and Worker's terminal into what goes and what stays. */
function judge(root: string, terminals: Terminals | undefined): Judged {
  fetchOrigin(root)
  const head = originHead(root)
  const base = baseOf(root, head)
  const baseName = `origin/${base.name}`
  const [checkout, ...linked] = worktreesOf(root)
  if (checkout === undefined) {
    throw new CannotRun("git lists no worktree", "check the repository with git worktree list")
  }
  const holders =
    terminals === undefined
      ? new Map<string, Holder[]>()
      : holdersOf(
          terminals,
          checkout.path,
          linked.map(({ path }) => path)
        )
  const verdicts = linked.map((tree) => {
    const lock = lockVerdict(tree.path, tree.lock)
    const here = holders.get(tree.path) ?? []
    const pid = lock.state === "stays" ? lock.pid : undefined
    const workerLock = pid !== undefined && lockHolder(pid, here) !== undefined ? { pid } : undefined
    const why = whyTreeStays(root, base.ref, tree, workerLock === undefined ? lock : { state: "none" }, here)
    return { tree, lock, here, why, workerLock }
  })
  const staying = verdicts.filter(({ why }) => why !== null).map(({ tree }) => tree)
  const held = new Map<string, string>()
  for (const { path, branch } of [checkout, ...staying]) {
    if (branch !== undefined) {
      held.set(branch, path)
    }
  }
  const footing: Footing = {
    head,
    baseBranch: base.name,
    protectedBranches: resolveConfig(root).config.guardrails.protectedBranches,
    held
  }
  const removed: Planned[] = []
  const kept: Kept[] = []
  const judged = new Set<string>()
  const judgeBranch = (name: string): void => {
    if (judged.has(name)) {
      return
    }
    judged.add(name)
    const why = stays(name, footing)
    const off = why?.dev === true && held.get(name) === checkout.path ? switchOff(root, base, name) : null
    if (why !== null) {
      kept.push({ kind: "branch", name, ...why, ...off })
      return
    }
    // The tip read once, so the branch goes only while it still points at the commit judged Landed.
    const tip = tipOf(root, name)
    if (tip !== undefined && isCommitLanded(root, base.ref, tip)) {
      removed.push({ kind: "branch", name, reason: `Landed on ${baseName}`, at: tip })
    } else {
      const reason = `its work is on no commit of ${baseName} since it forked`
      kept.push({ kind: "branch", name, reason, command: forcedDelete(name), dev: true })
    }
  }
  const outside =
    terminals === undefined
      ? { remove: [], keep: [] }
      : outsideWorktrees(terminals, [checkout.path, ...linked.map(({ path }) => path)])
  removed.push(...outside.remove)
  for (const { name, reason } of outside.keep) {
    kept.push({ kind: "terminal", name, reason, command: null, dev: true })
  }
  for (const { tree, lock, here, why, workerLock } of verdicts) {
    if (why !== null) {
      kept.push({ kind: "worktree", name: tree.path, ...why, dev: true })
      kept.push(...keptIn(here, tree.path).map((item) => ({ kind: "terminal" as const, ...item, dev: true })))
      continue
    }
    removed.push(...stopsOf(here, tree.path))
    const reason = `clean, its HEAD is Landed on ${baseName}`
    removed.push({
      kind: "worktree",
      name: tree.path,
      reason,
      at: tree.head,
      ...(tree.branch === undefined ? {} : { holds: tree.branch }),
      ...(lock.state === "stale" ? { stale: lock } : {}),
      ...(workerLock === undefined ? {} : { workerLock })
    })
    if (tree.branch !== undefined) {
      judgeBranch(tree.branch)
    }
  }
  branchesOf(root).forEach(judgeBranch)
  return { base: baseName, removed, kept }
}

/** The removed items as the Sweep tells them: a stale lock lifted comes just before its worktree. */
function shownOf(removed: Planned[]): Shown[] {
  return removed.flatMap(({ kind, name, reason, stale, workerLock }) => {
    const item: Shown = { kind, name, reason }
    if (workerLock !== undefined) {
      const why = `held by its Worker's program, pid ${workerLock.pid}: lifted once the stop leaves it stale`
      return [{ kind: "lock", name, reason: why }, item]
    }
    return stale === undefined ? [item] : [{ kind: "lock", name, reason: stale.why }, item]
  })
}

function verbOf(kind: string, dryRun: boolean): string {
  if (kind === "lock") {
    return dryRun ? "would lift" : "lifted"
  }
  return dryRun ? "would remove" : "removed"
}

function linesOf({ dryRun, terminalsRead, removed, kept }: Sweep): string {
  const out = [
    ...removed.map(({ kind, name, reason }) => `${verbOf(kind, dryRun)} ${kind} ${name} — ${reason}`),
    ...kept.map(({ kind, name, reason, command }) => {
      return `kept ${kind} ${name} — ${reason}${command === null || command === undefined ? "" : `; to remove it yourself: ${command}`}`
    })
  ]
  const note = terminalsRead ? [] : ["terminals not read — outside herdr, $HC_TERMINAL_ID is not set"]
  return [...(out.length === 0 ? ["nothing to sweep"] : out), ...note].join("\n")
}

function parseCli(argv: string[]): { help: boolean; json: boolean; dryRun: boolean } {
  const { values, positionals } = readArgs(
    {
      args: argv,
      allowPositionals: true,
      options: {
        help: { type: "boolean", short: "h" },
        json: { type: "boolean" },
        "dry-run": { type: "boolean" }
      }
    },
    USAGE
  )
  if (positionals.length > 0 && values.help !== true) {
    throw usageError(`it takes no argument, not ${JSON.stringify(positionals[0])}`, USAGE)
  }
  return { help: values.help === true, json: values.json === true, dryRun: values["dry-run"] === true }
}

function sweep(json: boolean, dryRun: boolean): number {
  const root = findRepository(process.cwd())
  if (root === undefined) {
    throw new CannotRun(`no git repository holds ${process.cwd()}`, "run it from the main checkout")
  }
  const main = mainCheckout(root)
  if (main !== undefined) {
    throw new CannotRun(
      `${root} is a linked worktree`,
      `run it from the main checkout: ${shellLine(["cd", main])} && dw-sdlc sweep`
    )
  }
  const own = sweepingTerminal()
  const terminals = own === undefined ? undefined : readTerminals(own)
  const judged = judge(root, terminals)
  const { base, removed, kept } = dryRun ? judged : apply(judged, root)
  const done: Sweep = {
    dryRun,
    terminalsRead: terminals !== undefined,
    base,
    removed: shownOf(removed),
    kept: kept.map(({ kind, name, reason, command }) => ({ kind, name, reason, command }))
  }
  process.stdout.write(`${json ? JSON.stringify(done, null, 2) : linesOf(done)}\n`)
  return kept.some(({ dev }) => dev) ? 1 : 0
}

export function run(argv: string[]): number {
  const cli = parseCli(argv)
  if (cli.help) {
    process.stdout.write(`${USAGE}\n`)
    return 0
  }
  return sweep(cli.json, cli.dryRun)
}
