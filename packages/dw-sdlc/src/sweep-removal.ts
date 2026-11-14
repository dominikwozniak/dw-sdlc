// How a Sweep carries out what it judged: each item it plans to remove, removed in order, and the one git or
// hc refuses kept with their words. docs/adr/0015 sets the bounds: it never forces.

import { git } from "./git.ts"
import { byHand, lockAfterStop, removeTerminal } from "./sweep-terminals.ts"
import { forcedDelete, forcedRemoval, unlockCommand } from "./sweep-trees.ts"
import type { StaleLock } from "./worktree-lock.ts"

export type Item = { kind: "branch" | "worktree" | "lock" | "terminal"; name: string; reason: string }
export type Kept = Item & { command: string | null; dev: boolean }
/** An item to remove: a worktree's `holds` branch, `stale` lock, `workerLock` its Worker's program holds; a terminal's `stop`, `tree`. */
export type Planned = Item & {
  holds?: string
  stale?: StaleLock
  stop?: boolean
  tree?: string
  workerLock?: { pid: number }
}
export type Judged = { base: string; removed: Planned[]; kept: Kept[] }

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
    if (item.workerLock !== undefined) {
      const now = lockAfterStop(root, item.name)
      if (now.state === "stays") {
        return refusedWith(`its Worker's terminal was stopped, but ${now.reason}`, now.command)
      }
      if (now.state === "stale") {
        item.stale = now
      }
      delete item.workerLock
    }
    if (item.stale !== undefined) {
      const lifted = git(root, ["worktree", "unlock", "--", item.name])
      if ("error" in lifted) {
        return refusedWith(lifted.error, unlockCommand(item.name))
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
export function apply({ base, removed, kept }: Judged, root: string): Judged {
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
