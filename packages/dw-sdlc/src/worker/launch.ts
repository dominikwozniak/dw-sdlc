// What `worker start` and `lead start` share: a session started in a herdr terminal of its own beside the
// caller, its tab named, and the terminal read back until the session shows it took its first message.

import { setTimeout as sleep } from "node:timers/promises"

import { isObject, type JsonObject } from "../json-text.ts"
import { describe, hcObject, Refusal } from "./herdr.ts"
import { type Named, nameTab } from "./tabs.ts"

/** hc names a terminal with 1-32 of a-z, 0-9, - and _. */
export const NAME = /^[a-z0-9][a-z0-9_-]{0,31}$/
/** The most seconds a start looks for the new tab in the window, beside the read-back. */
export const TAB_WAIT = 10
/** What a session reports once it has taken its first message. */
const WORKING = new Set(["working", "blocked", "done"])
/** How long the read-back waits between two reads of the terminal. */
const POLL_MS = 1000

/** The status a session reports, if it has reported one. */
function reportedStatus(terminal: JsonObject): string | undefined {
  const { status } = terminal
  return isObject(status) && typeof status.state === "string" ? status.state : undefined
}

/** Why the session, called `who`, can no longer take its first message, or undefined while it still may. */
function failure(terminal: JsonObject, who: string): string | undefined {
  const { first_message: first, state } = terminal
  if (isObject(first) && first.sent === false) {
    return typeof first.reason === "string" ? first.reason : "herdr gave no reason"
  }
  if (state !== "live") {
    return "the terminal has finished"
  }
  return reportedStatus(terminal) === "error" ? `the ${who} reports its status as error` : undefined
}

/** Reads the terminal until the session shows work, for up to `wait` seconds; why it did not, or undefined once it did. */
async function delivery(address: string, wait: number, who: string): Promise<string | undefined> {
  const deadline = Date.now() + wait * 1000
  for (;;) {
    let terminal: JsonObject
    try {
      terminal = hcObject(["get", address, "--json"])
    } catch (error) {
      if (!(error instanceof Refusal)) {
        throw error
      }
      // The session is running by now, so a failed read is a message not confirmed, never a start that did not happen.
      return `the terminal could not be read back: ${describe(error)}`
    }
    const failed = failure(terminal, who)
    if (failed !== undefined) {
      return failed
    }
    if (WORKING.has(reportedStatus(terminal) ?? "")) {
      return undefined
    }
    if (Date.now() >= deadline) {
      return `the ${who} showed no sign of work within ${wait} s`
    }
    await sleep(POLL_MS)
  }
}

/** The id of the herdr space the terminal `id` sits in, if it sits in one. */
export function spaceOf(id: string): string | undefined {
  const { labels } = hcObject(["get", id, "--json"])
  const space = isObject(labels) ? labels["herdr.space"] : undefined
  return typeof space === "string" ? space : undefined
}

export type Launch = {
  name: string
  /** The `role` label of the new terminal. */
  role: "worker" | "lead"
  /** The herdr space of the caller, which the new terminal joins; none leaves the tab alone. */
  space: string | undefined
  /** The folder it starts in. */
  cwd: string
  /** The program and its arguments, its first message last. */
  argv: string[]
  /** The most seconds the read-back waits. */
  wait: number
  /** What the session is called in a reason, as `Worker`. */
  who: string
}

export type Launched = { address: string; tab: "none" | "renamed" | "kept"; reason: string | undefined }

/**
 * Runs `hc run` once for `launch`, outliving its caller, then names the tab and reads the terminal back side
 * by side. It never sends the first message again; `reason` says why the session did not take it.
 */
export async function launch(command: string, { name, role, space, cwd, argv, wait, who }: Launch): Promise<Launched> {
  const { address } = hcObject([
    "run",
    "--bg",
    "--json",
    "--name",
    name,
    "--label",
    `role=${role}`,
    ...(space === undefined ? [] : ["--label", `herdr.space=${space}`]),
    "--outlive-parent",
    "--cwd",
    cwd,
    "--",
    ...argv
  ])
  if (typeof address !== "string") {
    throw new Refusal("hc run answered no address for the terminal it started", "check hc ls before starting it again")
  }
  // Side by side, so the wait for the tab overlaps the wait for the session to start.
  const naming: Promise<"none" | Named> =
    space === undefined ? Promise.resolve("none") : nameTab(address, name, Math.min(TAB_WAIT, wait))
  const [named, reason] = await Promise.all([naming, delivery(address, wait, who)])
  if (typeof named === "object") {
    process.stderr.write(`dw-sdlc ${command}: warning: ${named.kept}\n`)
  }
  return { address, tab: typeof named === "object" ? "kept" : named, reason }
}

/** The line that says a started session did not take its first message, and how to recover. */
export function undelivered(command: string, name: string, address: string, reason: string, message: string): string {
  return (
    `dw-sdlc ${command}: ${name} (${address}) started but its first message was not delivered: ${reason} — ` +
    `run hc read ${address} to see why; do not send the ${message} again before you have read it\n`
  )
}
