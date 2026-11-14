// How a Sweep carries out what it judged: each item it plans to remove, removed in order, and the one git or
// hc refuses, or that outlives its time limit, kept with why. docs/adr/0015 sets the bounds: it never forces.

import { SLOW_LIMIT_MS, TimedOut } from "./exec.ts"
import { git, type GitAnswer } from "./git.ts"
import { byHand, lockAfterStop, takeDown } from "./sweep-terminals.ts"
import { forcedDelete, forcedRemoval, tipOf, unlockCommand, whyUnclean, worktreesOf } from "./sweep-trees.ts"
import type { StaleLock } from "./worktree-lock.ts"

export type Item = { kind: "branch" | "worktree" | "lock" | "terminal"; name: string; reason: string }
export type Kept = Item & { command: string | null; dev: boolean }
/**
 * An item to remove: `at` the commit it was judged at, a worktree's HEAD or a branch's tip; a worktree's
 * `holds` branch, `stale` lock, `workerLock` its Worker's program holds; a terminal's `stop`, `tree`.
 */
export type Planned = Item & {
  at?: string
  holds?: string
  stale?: StaleLock
  stop?: boolean
  tree?: string
  workerLock?: { pid: number }
}
export type Judged = { base: string; removed: Planned[]; kept: Kept[] }

/** Why the worktree `item` stays after all, read again just before it goes: what changed since it was judged. */
function whyChanged(root: string, item: Planned): Pick<Kept, "reason" | "command"> | null {
  const now = worktreesOf(root).find(({ path }) => path === item.name)
  if (now === undefined) {
    return { reason: "git no longer lists it", command: null }
  }
  if (now.head !== item.at) {
    return { reason: `its HEAD moved to ${now.head.slice(0, 9)} since the Sweep judged it`, command: null }
  }
  if (now.branch !== item.holds) {
    const on = now.branch === undefined ? "a detached HEAD" : `${now.branch} checked out`
    return { reason: `it has ${on} since the Sweep judged it`, command: null }
  }
  if (now.lock !== item.stale?.held) {
    return { reason: "its lock changed since the Sweep judged it", command: null }
  }
  return whyUnclean(item.name, item.stale !== undefined)
}

type Why = Pick<Kept, "reason" | "command">

/** The command that removes `item` by hand, for one the Sweep did not remove. */
function byHandOf(item: Planned): string {
  if (item.kind === "terminal") {
    return byHand(item)
  }
  return item.kind === "worktree" ? forcedRemoval(item.name, item.stale !== undefined) : forcedDelete(item.name)
}

/** Stops, if it asks, and removes the terminal of `item`; why it stays, in hc's words, or undefined once it is gone. */
function removeTerminalOf(item: Planned, unstopped: Map<string, string>): Why | undefined {
  const failed = takeDown(item)
  if (failed === undefined) {
    return undefined
  }
  if (item.tree !== undefined) {
    unstopped.set(item.tree, `its Worker's terminal ${item.name} stays: ${failed}`)
  }
  return { reason: failed, command: byHandOf(item) }
}

/** Removes the worktree of `item` once it still passes, its stale lock lifted just before; why it stays, or undefined. */
function removeTree(root: string, item: Planned, unstopped: Map<string, string>): Why | undefined {
  const unstoppable = unstopped.get(item.name)
  if (unstoppable !== undefined) {
    return { reason: unstoppable, command: null }
  }
  if (item.workerLock !== undefined) {
    const now = lockAfterStop(root, item.name)
    if (now.state === "stays") {
      return { reason: `its Worker's terminal was stopped, but ${now.reason}`, command: now.command }
    }
    if (now.state === "stale") {
      item.stale = now
    }
    delete item.workerLock
  }
  const changed = whyChanged(root, item)
  if (changed !== null) {
    return changed
  }
  if (item.stale !== undefined) {
    const lifted = git(root, ["worktree", "unlock", "--", item.name])
    if ("error" in lifted) {
      return { reason: lifted.error, command: unlockCommand(item.name) }
    }
  }
  let result: GitAnswer
  try {
    result = git(root, ["worktree", "remove", "--", item.name], { limitMs: SLOW_LIMIT_MS })
  } catch (error) {
    if (!(error instanceof TimedOut)) {
      throw error
    }
    result = { error: error.message, said: error.message }
  }
  if (!("error" in result)) {
    return undefined
  }
  const relocked =
    item.stale === undefined ? undefined : git(root, ["worktree", "lock", "--reason", item.stale.held, "--", item.name])
  const lost =
    relocked !== undefined && "error" in relocked ? `; its lock could not be put back: ${relocked.error}` : ""
  return { reason: `${result.error}${lost}`, command: byHandOf(item) }
}

/** Deletes the branch of `item` while it still points at the commit judged Landed; why it stays, or undefined. */
function removeBranch(root: string, item: Planned, heldBy: Map<string, string>): Why | undefined {
  const path = heldBy.get(item.name)
  if (path !== undefined) {
    return { reason: `checked out in the worktree at ${path}`, command: null }
  }
  // Read just before the delete: git branch -D, the delete the guard lets an agent make, takes no expected tip.
  const now = tipOf(root, item.name)
  if (now !== undefined && now !== item.at) {
    return { reason: `it moved to ${now.slice(0, 9)} since the Sweep judged it`, command: null }
  }
  const result = git(root, ["branch", "-D", "--", item.name])
  return "error" in result ? { reason: result.error, command: byHandOf(item) } : undefined
}

/** Removes `item`; why it stays, in git's or hc's words or as the time limit it hit, or undefined once it is gone. */
function removal(
  root: string,
  item: Planned,
  heldBy: Map<string, string>,
  unstopped: Map<string, string>
): Why | undefined {
  try {
    if (item.kind === "terminal") {
      return removeTerminalOf(item, unstopped)
    }
    return item.kind === "worktree" ? removeTree(root, item, unstopped) : removeBranch(root, item, heldBy)
  } catch (error) {
    if (error instanceof TimedOut) {
      return { reason: error.message, command: byHandOf(item) }
    }
    throw error
  }
}

/** Removes each item judged to go, in order; a worktree that stays keeps the branch it holds as well. */
export function apply({ base, removed, kept }: Judged, root: string): Judged {
  const gone: Planned[] = []
  const refused: Kept[] = []
  const heldBy = new Map<string, string>()
  const unstopped = new Map<string, string>()
  for (const item of removed) {
    const why = removal(root, item, heldBy, unstopped)
    if (why === undefined) {
      gone.push(item)
      continue
    }
    if (item.kind === "worktree" && item.holds !== undefined) {
      heldBy.set(item.holds, item.name)
    }
    refused.push({ kind: item.kind, name: item.name, ...why, dev: true })
  }
  return { base, removed: gone, kept: [...kept, ...refused] }
}
