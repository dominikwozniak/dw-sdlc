// What a Sweep does with herdr terminals: it stops and removes only a Worker of its own whose turn has ended,
// in a worktree that goes in the same Sweep or is already gone. docs/adr/0015 sets the bounds.

import { existsSync, realpathSync } from "node:fs"

import { isObject } from "./json-text.ts"
import { shellLine } from "./pr/decide.ts"
import { CannotRun } from "./pr/read.ts"
import { call, hcObject, isLive, Refusal, said, type Worker, workersOf, workingFolders } from "./worker/herdr.ts"

/** A live terminal of another session, or the sweeping one's own, with the place herdr shows it at. */
type Seen = { address: string; name: string; folder: string; place: string }

export type Terminals = { own: Seen | undefined; workers: Worker[]; others: Seen[] }

/** What holds a worktree: the terminal of this session, another session's, or a Worker of this one. */
export type Holder =
  | { role: "own"; terminal: Seen }
  | { role: "other"; terminal: Seen }
  | { role: "worker"; worker: Worker }

/** The terminal to stop and remove, or only to remove once it has finished. */
export type Planned = { kind: "terminal"; name: string; reason: string; stop: boolean; tree?: string }

/** Statuses of a Worker that is not at the end of its turn, with how the Sweep says it. */
const AT_WORK: Record<string, string> = {
  working: "working",
  blocked: "blocked, waiting for the dev",
  unknown: "yet to report"
}

/** The address of the terminal the Sweep runs in, or undefined outside herdr. */
export function sweepingTerminal(): string | undefined {
  const id = process.env.HC_TERMINAL_ID
  return id === undefined || id === "" ? undefined : id
}

function word(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined
}

/** The live terminals `hc ls` lists, each with the folder it works in. */
function liveTerminals(): Seen[] {
  const { terminals } = hcObject(["ls", "--json"])
  if (!Array.isArray(terminals)) {
    throw new Refusal("hc ls answered no list of terminals", "check hc --version")
  }
  const places = new Map<string, string | undefined>()
  const listed = terminals.flatMap((entry: unknown): Worker[] => {
    const address = isObject(entry) ? word(entry.address) : undefined
    if (!isObject(entry) || address === undefined || typeof entry.cwd !== "string") {
      throw new Refusal("hc ls answered a terminal without an address or a folder", "check hc --version")
    }
    places.set(address, word(entry.where))
    const name = word(entry.name) ?? address
    return [{ name, address, state: "live", status: word(entry.status) ?? "unknown", folder: entry.cwd }]
  })
  return workingFolders(listed).map(({ name, address, folder }) => ({
    name,
    address,
    folder,
    place: places.get(address) ?? folder
  }))
}

/**
 * Reads herdr for the sweeping terminal `own`: its Workers, finished ones included, and the other live
 * terminals. An `hc` that fails stops the Sweep, since a terminal it cannot see must not count as absent.
 */
export function readTerminals(own: string): Terminals {
  try {
    const workers = workingFolders(workersOf(own, true))
    const live = liveTerminals()
    const addresses = new Set(workers.map(({ address }) => address))
    return {
      own: live.find(({ address }) => address === own),
      workers,
      others: live.filter(({ address }) => address !== own && !addresses.has(address))
    }
  } catch (error) {
    if (error instanceof Refusal) {
      throw new CannotRun(error.message, error.remedy ?? "check hc, then call again")
    }
    throw error
  }
}

function canonical(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

function lies(folder: string, root: string): boolean {
  return folder === root || folder.startsWith(root.endsWith("/") ? root : `${root}/`)
}

/** The deepest of `roots` whose folder holds `folder`, or undefined. */
function treeOf(folder: string, roots: string[]): string | undefined {
  const real = canonical(folder)
  const holding = roots.filter((root) => lies(folder, root) || lies(real, canonical(root)))
  return holding.toSorted((a, b) => b.length - a.length)[0]
}

/** A Worker whose terminal is live but whose folder is gone could commit nothing more. */
export function workerWithoutFolder({ workers }: Terminals): Worker[] {
  return workers.filter((worker) => isLive(worker) && !existsSync(worker.folder))
}

/** The terminals in the folder of each of `trees`; the main checkout `main` takes those not in a linked one. */
export function holdersOf({ own, workers, others }: Terminals, main: string, trees: string[]): Map<string, Holder[]> {
  const held = new Map<string, Holder[]>()
  const place = (folder: string, holder: Holder): void => {
    const tree = treeOf(folder, [main, ...trees])
    if (tree !== undefined && tree !== main) {
      held.set(tree, [...(held.get(tree) ?? []), holder])
    }
  }
  if (own !== undefined) {
    place(own.folder, { role: "own", terminal: own })
  }
  for (const terminal of others) {
    place(terminal.folder, { role: "other", terminal })
  }
  for (const worker of workers) {
    if (isLive(worker) && existsSync(worker.folder)) {
      place(worker.folder, { role: "worker", worker })
    }
  }
  return held
}

/** How the Sweep says a Worker that is working, blocked or yet to report is, or undefined for one that is done. */
export function atWork({ status }: Worker): string | undefined {
  return AT_WORK[status]
}

/** What the terminals in a worktree keep it for, or null when only Workers at the end of their turn are in it. */
export function whyHeld(holders: Holder[]): { reason: string; command: string | null } | null {
  const reasons: string[] = []
  const kills: string[] = []
  for (const holder of holders) {
    if (holder.role === "own") {
      reasons.push(`the terminal this Sweep runs in, ${holder.terminal.address}, is in it`)
    } else if (holder.role === "other") {
      const { address, place } = holder.terminal
      reasons.push(`another session's terminal ${address} is in it, at ${place}`)
      kills.push(shellLine(["hc", "kill", address]))
    } else {
      const at = atWork(holder.worker)
      if (at !== undefined) {
        reasons.push(`its Worker ${holder.worker.name} (${holder.worker.address}) is ${at}`)
      }
    }
  }
  return reasons.length === 0
    ? null
    : { reason: reasons.join("; "), command: kills.length === 0 ? null : kills.join(" && ") }
}

/** The terminals of the Workers done in a worktree that goes, to stop and remove with it. */
export function stopsOf(holders: Holder[], tree: string): Planned[] {
  return holders.flatMap((holder) =>
    holder.role === "worker"
      ? [
          {
            kind: "terminal" as const,
            name: holder.worker.address,
            reason: `Worker ${holder.worker.name} is ${holder.worker.status}: stopped, then removed with its worktree`,
            stop: true,
            tree
          }
        ]
      : []
  )
}

/** Stops, if `item` asks, and removes its terminal; the words of the `hc` that refused, or undefined when it is gone. */
export function removeTerminal(item: { name: string; stop?: boolean }): string | undefined {
  try {
    if (item.stop === true) {
      const killed = call("hc", ["kill", item.name])
      // 11: the terminal finished between the read and the stop.
      if (killed.status !== 0 && killed.status !== 11) {
        return `hc kill ${item.name} failed: ${said(killed)}`
      }
    }
    const removed = call("hc", ["rm", item.name])
    // 3: the terminal is gone already.
    return removed.status === 0 || removed.status === 3 ? undefined : `hc rm ${item.name} failed: ${said(removed)}`
  } catch (error) {
    if (error instanceof Refusal) {
      return error.message
    }
    throw error
  }
}

/** A Worker the Sweep keeps, with why. */
export type KeptWorker = { name: string; reason: string }

/** The Workers no worktree of this Sweep decides: a finished one is removed, one whose folder is gone goes under the status rule. */
export function outsideWorktrees(terminals: Terminals): { remove: Planned[]; keep: KeptWorker[] } {
  const remove: Planned[] = []
  const keep: KeptWorker[] = []
  for (const worker of terminals.workers.filter((one) => !isLive(one))) {
    remove.push({ kind: "terminal", name: worker.address, reason: `Worker ${worker.name} is finished`, stop: false })
  }
  for (const worker of workerWithoutFolder(terminals)) {
    const at = atWork(worker)
    if (at === undefined) {
      const reason = `Worker ${worker.name} is ${worker.status} and its folder ${worker.folder} is gone: stopped, then removed`
      remove.push({ kind: "terminal", name: worker.address, reason, stop: true })
    } else {
      keep.push({ name: worker.address, reason: `Worker ${worker.name} is ${at}, its folder ${worker.folder} is gone` })
    }
  }
  return { remove, keep }
}

/** The command that stops or removes the terminal of a Planned item by hand. */
export function byHand(item: { name: string; stop?: boolean }): string {
  return item.stop === true
    ? `${shellLine(["hc", "kill", item.name])}; ${shellLine(["hc", "rm", item.name])}`
    : shellLine(["hc", "rm", item.name])
}
