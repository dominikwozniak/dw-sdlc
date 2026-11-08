// `dw-sdlc sweep`: removes each linked worktree whose whole set passes and each Landed local branch.
// docs/adr/0015 sets its bounds: it runs from the main checkout, never forces and never writes to a remote.

import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { parseArgs } from "node:util"

import { findRepository, mainCheckout, resolveConfig } from "../agentic-config.ts"
import { repositoryFreeEnv } from "../git-env.ts"
import { isCommitLanded, isLanded } from "../landed.ts"
import { shellLine } from "../pr/decide.ts"
import { CannotRun } from "../pr/read.ts"
import {
  byHand,
  type Holder,
  holdersOf,
  outsideWorktrees,
  readTerminals,
  removeTerminal,
  stopsOf,
  sweepingTerminal,
  type Terminals,
  whyHeld,
  atWork
} from "../sweep-terminals.ts"
import { dirtyFiles, must, pausedOperation, type Tree, worktreesOf } from "../sweep-trees.ts"
import { asked, git } from "../working-tree.ts"
import { type LockVerdict, lockVerdict, type StaleLock } from "../worktree-lock.ts"

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
  the default branch, the base branch, a protected branch and a branch a kept worktree has checked out;
  a branch whose work is on no commit of the base, with the forced delete.
It never changes anything on a remote: the fetch only writes remote-tracking refs. A removal git refuses is
kept with git's words, and the sweep goes on.

In herdr ($HC_TERMINAL_ID set) it reads, with hc, the Workers of this session, the terminals whose parent is
this one, and every other live terminal. A Worker whose status is none of working, blocked or yet to report
is stopped (hc kill) and then removed (hc rm) when its worktree goes in the same Sweep or its folder is
already gone; a worktree is judged whole first, so no Worker is stopped beside work it could still commit. A
finished Worker of this session is removed. It never stops this session's own terminal or another session's:
a worktree one of those is in stays, named with the terminal's address and place and hc kill as the dev's
command. Outside herdr no terminal is read, and the output says so. An hc that fails ends the Sweep with
exit 2 before anything is removed.

--dry-run removes and stops nothing and answers the same items. One line an item, or one document with --json:
  { dryRun, terminalsRead, base, removed: [item], kept: [item] }, an item { kind, name, reason, command? },
  kind branch, worktree, lock (a lifted one) or terminal, name its path or its address, command the one the
  dev would run for a kept item.

Exit 0 nothing is kept but the default, the base or a protected branch, 1 something else is, 2 when it
cannot run: in a linked worktree, with no base to read, when the fetch fails or when hc fails in herdr.`

type Item = { kind: "branch" | "worktree" | "lock" | "terminal"; name: string; reason: string }
type Kept = Item & { command: string | null; dev: boolean }
/** An item to remove: a worktree's `holds` is the branch it has checked out, `stale` the lock to lift first; a terminal's `stop` says it is stopped first, `tree` the worktree it is in. */
type Planned = Item & { holds?: string; stale?: StaleLock; stop?: boolean; tree?: string }
type Shown = Item & { command?: string | null }

type Sweep = { dryRun: boolean; terminalsRead: boolean; base: string; removed: Shown[]; kept: Shown[] }

function forcedDelete(branch: string): string {
  return shellLine(["git", "branch", "-D", branch])
}

/** The forced removal; git wants --force twice for a worktree still locked. */
function forcedRemoval(path: string, locked = false): string {
  return shellLine(["git", "worktree", "remove", "--force", ...(locked ? ["--force"] : []), path])
}

function fetchOrigin(root: string): void {
  if (asked(root, ["remote", "get-url", "origin"]) === undefined) {
    return
  }
  const env = { ...repositoryFreeEnv(), GIT_TERMINAL_PROMPT: "0" }
  const result = spawnSync("git", ["-C", root, "fetch", "--quiet", "origin"], { encoding: "utf8", env, stdio: "pipe" })
  if (result.status !== 0) {
    const said = result.stderr.split("\n").find((line) => line.trim() !== "")
    throw new CannotRun(
      `git fetch origin failed: ${said?.trim() ?? `exited ${result.status}`}`,
      "check the network, then call again"
    )
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

function branchesOf(root: string): string[] {
  return must(root, ["for-each-ref", "--format=%(refname:lstrip=2)", "refs/heads"])
    .split("\n")
    .filter((name) => name !== "")
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
      command: lock.state === "stale" ? `${shellLine(["git", "worktree", "unlock", path])} && ${prune}` : prune
    }
  }
  const operation = pausedOperation(path)
  if (operation !== undefined) {
    return { reason: `a ${operation} is paused in it`, command: null }
  }
  const files = dirtyFiles(path)
  if ("error" in files) {
    return { reason: files.error, command: null }
  }
  if (files.length > 0) {
    return {
      reason: `modified or untracked: ${files.join(", ")}`,
      command: forcedRemoval(path, lock.state === "stale")
    }
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

type Judged = { base: string; removed: Planned[]; kept: Kept[] }

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
    return { tree, lock, here, why: whyTreeStays(root, base.ref, tree, lock, here) }
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
    if (why !== null) {
      kept.push({ kind: "branch", name, ...why })
    } else if (isLanded(root, base.ref, name)) {
      removed.push({ kind: "branch", name, reason: `Landed on ${baseName}` })
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
  for (const { tree, lock, here, why } of verdicts) {
    if (why !== null) {
      kept.push({ kind: "worktree", name: tree.path, ...why, dev: true })
      for (const holder of here) {
        if (holder.role === "other") {
          const { address, place } = holder.terminal
          const reason = `another session's terminal, in the worktree at ${tree.path}, at ${place}`
          kept.push({ kind: "terminal", name: address, reason, command: shellLine(["hc", "kill", address]), dev: true })
        } else if (holder.role === "worker") {
          const { name, address, status } = holder.worker
          const at = atWork(holder.worker)
          const reason = `Worker ${name} is ${at ?? status}${at === undefined ? ", but its worktree stays" : ""}`
          kept.push({ kind: "terminal", name: address, reason, command: null, dev: true })
        }
      }
      continue
    }
    removed.push(...stopsOf(here, tree.path))
    const reason = `clean, its HEAD is Landed on ${baseName}`
    removed.push({
      kind: "worktree",
      name: tree.path,
      reason,
      ...(tree.branch === undefined ? {} : { holds: tree.branch }),
      ...(lock.state === "stale" ? { stale: lock } : {})
    })
    if (tree.branch !== undefined) {
      judgeBranch(tree.branch)
    }
  }
  branchesOf(root).forEach(judgeBranch)
  return { base: baseName, removed, kept }
}

/** Removes `item`; the item kept when git refuses it, with git's words, or undefined once it is gone. */
function removal(
  root: string,
  item: Planned,
  heldBy: Map<string, string>,
  unstopped: Map<string, string>
): Kept | undefined {
  const refused = (reason: string, command: string | null): Kept => ({
    kind: item.kind,
    name: item.name,
    reason,
    command,
    dev: true
  })
  if (item.kind === "terminal") {
    const failed = removeTerminal(item)
    if (failed === undefined) {
      return undefined
    }
    if (item.tree !== undefined) {
      unstopped.set(item.tree, `its Worker's terminal ${item.name} stays: ${failed}`)
    }
    return refused(failed, byHand(item))
  }
  if (item.kind === "worktree") {
    const refusedWith = (reason: string, command: string | null): Kept => {
      if (item.holds !== undefined) {
        heldBy.set(item.holds, item.name)
      }
      return refused(reason, command)
    }
    const unstoppable = unstopped.get(item.name)
    if (unstoppable !== undefined) {
      return refusedWith(unstoppable, null)
    }
    if (item.stale !== undefined) {
      const lifted = git(root, ["worktree", "unlock", "--", item.name])
      if ("error" in lifted) {
        return refusedWith(lifted.error, shellLine(["git", "worktree", "unlock", item.name]))
      }
    }
    const result = git(root, ["worktree", "remove", "--", item.name])
    if (!("error" in result)) {
      return undefined
    }
    const relocked =
      item.stale === undefined
        ? undefined
        : git(root, ["worktree", "lock", "--reason", item.stale.held, "--", item.name])
    const lost =
      relocked !== undefined && "error" in relocked ? `; its lock could not be put back: ${relocked.error}` : ""
    return refusedWith(`${result.error}${lost}`, forcedRemoval(item.name, item.stale !== undefined))
  }
  const path = heldBy.get(item.name)
  if (path !== undefined) {
    return refused(`checked out in the worktree at ${path}`, null)
  }
  const result = git(root, ["branch", "-D", "--", item.name])
  return "error" in result ? refused(result.error, forcedDelete(item.name)) : undefined
}

/** Removes each item judged to go, in order; a refused worktree keeps the branch it holds as well. */
function apply({ base, removed, kept }: Judged, root: string): Judged {
  const gone: Planned[] = []
  const refused: Kept[] = []
  const heldBy = new Map<string, string>()
  const unstopped = new Map<string, string>()
  for (const item of removed) {
    const stayed = removal(root, item, heldBy, unstopped)
    if (stayed === undefined) {
      gone.push(item)
    } else {
      refused.push(stayed)
    }
  }
  return { base, removed: gone, kept: [...kept, ...refused] }
}

/** The removed items as the Sweep tells them: a stale lock lifted comes just before its worktree. */
function shownOf(removed: Planned[]): Shown[] {
  return removed.flatMap(({ kind, name, reason, stale }) => {
    const item: Shown = { kind, name, reason }
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

function parseCli(argv: string[]): { help: boolean; json: boolean; dryRun: boolean } | { error: string } {
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        help: { type: "boolean", short: "h" },
        json: { type: "boolean" },
        "dry-run": { type: "boolean" }
      }
    })
    if (positionals.length > 0 && values.help !== true) {
      return { error: `it takes no argument, not ${JSON.stringify(positionals[0])}` }
    }
    return { help: values.help === true, json: values.json === true, dryRun: values["dry-run"] === true }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
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
  if ("error" in cli) {
    process.stderr.write(`dw-sdlc sweep: ${cli.error}\n\n${USAGE}\n`)
    return 2
  }
  if (cli.help) {
    process.stdout.write(`${USAGE}\n`)
    return 0
  }
  try {
    return sweep(cli.json, cli.dryRun)
  } catch (error) {
    if (error instanceof CannotRun) {
      process.stderr.write(`dw-sdlc sweep: ${error.message} — ${error.remedy}\n`)
      return 2
    }
    throw error
  }
}
