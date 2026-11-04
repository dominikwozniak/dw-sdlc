// Drift: a file a Step creates, changes or deletes while the Gate runs. Before and after each Step the
// Gate records the tree of every file git tracks or would track, never against HEAD, so an ignored
// file never drifts and an edit made before the run sits in both records.

import type { Gate } from "./agentic-config.ts"
import { git, workTree } from "./gate-cache.ts"
import type { Failure } from "./report.ts"
import { type Status, stoppedBy } from "./run-command.ts"

const REMEDIES = {
  drift: "commit the change, or make the Step only read",
  cannotWatch: 'run the Gate in a git checkout, or set gate.drift to "allow"'
}

/** What a letter of `git diff-tree --name-status` did to the file; T is a change of type, as a link to a file. */
const CHANGES: Record<string, string> = { A: "created", D: "deleted", M: "changed", T: "changed" }

/** Steps run under watch, and what the watch found. */
export type DriftWatch = {
  /** Runs one Step by `run`, and returns what it answered with one failure per file it created, changed or deleted. */
  step: <T>(command: string, run: () => Promise<T>) => Promise<{ result: T; drift: Failure[] }>
  /** `fail` once a Step drifted, `error` once the tree could not be recorded, `pass` otherwise. */
  status: () => Status
}

/** One failure per file that differs between the trees `before` and `after`, naming `command`. */
function drifted(root: string, command: string, before: string, after: string): Failure[] | { error: string } {
  if (before === after) {
    return []
  }
  const diff = git(root, ["diff-tree", "-r", "-z", "--no-renames", "--name-status", before, after])
  if ("error" in diff) {
    return diff
  }
  // NUL-terminated pairs: the letter, then the path, which may hold any byte but NUL.
  return [...diff.out.matchAll(/([A-Z])\0([^\0]+)\0/g)].map(([, letter = "", file = ""]) => {
    const message = `${JSON.stringify(command)} ${CHANGES[letter] ?? "changed"} it`
    return { file, rule: "drift", message, remedy: REMEDIES.drift }
  })
}

/** A watch over the Steps of `gate` at `root`; under `gate.drift: "allow"` it only runs them. */
export function watchDrift(root: string, gate: Gate): DriftWatch {
  let status: Status = "pass"
  let watching = gate.drift !== "allow"
  /** The tree after the last Step, the record before the next: nothing runs between two Steps. */
  let last: string | undefined

  /** The one failure of a tree that cannot be recorded; the watch stops there. */
  const cannotWatch = (command: string, error: string): Failure[] => {
    watching = false
    status = "error"
    const message = `cannot watch ${JSON.stringify(command)}: ${error}`
    return [{ rule: "drift", message, remedy: REMEDIES.cannotWatch }]
  }

  const step = async <T>(command: string, run: () => Promise<T>): Promise<{ result: T; drift: Failure[] }> => {
    if (!watching) {
      return { result: await run(), drift: [] }
    }
    const before = last === undefined ? workTree(root) : { tree: last }
    const result = await run()
    if ("error" in before) {
      return { result, drift: cannotWatch(command, before.error) }
    }
    if (stoppedBy() !== undefined) {
      // A signal cut the Step short and ends the Gate, so nothing is compared after it.
      return { result, drift: [] }
    }
    const after = workTree(root)
    if ("error" in after) {
      return { result, drift: cannotWatch(command, after.error) }
    }
    last = after.tree
    const drift = drifted(root, command, before.tree, after.tree)
    if ("error" in drift) {
      return { result, drift: cannotWatch(command, drift.error) }
    }
    if (drift.length > 0) {
      status = "fail"
    }
    return { result, drift }
  }

  return { step, status: () => status }
}
