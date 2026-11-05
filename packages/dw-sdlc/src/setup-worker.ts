// The `worker` block of the machine's local layer: the command a Worker starts with, which the setup
// writes once when `cswap` is on PATH so no prompt ever carries it.

import { accessSync, constants, statSync } from "node:fs"
import { delimiter, join } from "node:path"

import { isObject, type JsonObject } from "./json-text.ts"

/** The command that starts a Worker on the account `cswap` maps to the repository, prompts bypassed. */
export const CSWAP_WORKER_COMMAND = "cswap run -- --dangerously-skip-permissions"

/** Whether an executable file `name` sits in a directory of `pathVariable`, a PATH as the shell reads it. */
export function onPath(name: string, pathVariable: string | undefined): boolean {
  return (pathVariable ?? "").split(delimiter).some((dir) => {
    if (dir === "") {
      return false
    }
    try {
      const file = join(dir, name)
      accessSync(file, constants.X_OK)
      return statSync(file).isFile()
    } catch {
      return false
    }
  })
}

/** The `worker` block a local file holds, carried through on every run, `--force` included. */
export function keptWorker(existing: unknown): JsonObject | undefined {
  return isObject(existing) && isObject(existing.worker) ? existing.worker : undefined
}

/**
 * The `worker` block to write: the one the file holds, with `command` added when it has none and `cswap`
 * is on PATH. A command already there, whatever it holds, stays; without `cswap` nothing is added.
 */
export function pinnedWorker(
  kept: JsonObject | undefined,
  pathVariable: string | undefined
): { worker: JsonObject | undefined; added: boolean } {
  if ((kept !== undefined && "command" in kept) || !onPath("cswap", pathVariable)) {
    return { worker: kept, added: false }
  }
  return { worker: { ...kept, command: CSWAP_WORKER_COMMAND }, added: true }
}
