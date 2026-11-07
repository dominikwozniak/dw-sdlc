// What the `worker` commands share: `hc` and `herdr-app` as child processes, the Lead a command acts for,
// and the Workers herdr lists for it.

import { spawnSync } from "node:child_process"

import { isObject, type JsonObject, parseObject } from "../json-text.ts"

/** What stops a `worker` command before it acts: exit 2, the problem and, when there is one, its remedy. */
export class Refusal extends Error {
  remedy: string | undefined
  constructor(message: string, remedy?: string) {
    super(message)
    this.remedy = remedy
  }
}

export type Called = { status: number; stdout: string; stderr: string }

/** The first line of a tool's output that says anything, or the exit it ended with. */
export function said(called: Called): string {
  const line = `${called.stderr}\n${called.stdout}`.split("\n").find((text) => text.trim() !== "")
  return line?.trim() ?? `exited ${called.status}`
}

/** `tool args` as a child process; a tool that is not on PATH stops the command. */
export function call(tool: "hc" | "herdr-app", args: string[]): Called {
  const result = spawnSync(tool, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  if (result.error !== undefined) {
    if ("code" in result.error && result.error.code === "ENOENT") {
      throw new Refusal(`${tool} is not on PATH`, "install herdr, or run the command in a terminal herdr started")
    }
    throw result.error
  }
  return { status: result.status ?? 1, stdout: result.stdout, stderr: result.stderr }
}

/** The JSON object `hc <args>` prints; a failing call or a reply that is no object stops the command. */
export function hcObject(args: string[]): JsonObject {
  const called = call("hc", args)
  if (called.status !== 0) {
    throw new Refusal(`hc ${args[0] ?? ""} failed: ${said(called)}`)
  }
  const parsed = parseObject(called.stdout)
  if (parsed === undefined) {
    throw new Refusal(`hc ${args[0] ?? ""} answered something that is no JSON object`, "check hc --version")
  }
  return parsed
}

/** What an error says, whatever was thrown. */
export function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Reports a `Refusal` of `command` on stderr and answers exit 2; any other error is a bug and goes on up. */
export function refuse(command: string, error: unknown): number {
  if (!(error instanceof Refusal)) {
    throw error
  }
  process.stderr.write(
    `dw-sdlc ${command}: ${error.message}${error.remedy === undefined ? "" : ` — ${error.remedy}`}\n`
  )
  return 2
}

/** The option `flag` as a whole number from `min`, `fallback` when the command line leaves it out. */
export function wholeNumber(
  flag: string,
  value: string | undefined,
  fallback: number,
  min: number
): number | { error: string } {
  const number = value === undefined ? fallback : Number(value)
  return Number.isInteger(number) && number >= min
    ? number
    : { error: `${flag} takes a whole number from ${min}, not ${JSON.stringify(value)}` }
}

/** The terminal the command runs in, which is the Lead of the Workers it starts or reads. */
export function lead(): string {
  const id = process.env.HC_TERMINAL_ID
  if (id === undefined || id === "") {
    throw new Refusal(
      "outside herdr: $HC_TERMINAL_ID is not set",
      "run it in a terminal herdr started, where the Lead has an address"
    )
  }
  return id
}

export type Worker = {
  name: string
  address: string
  /** herdr's state: live or finished. */
  state: string
  /** What the Worker reports (idle, working, done, blocked, error), `finished` once it has ended, `unknown` before it reports. */
  status: string
  /** The folder it was launched in, or the one it works in once `workingFolders` has asked herdr. */
  folder: string
}

/**
 * The Workers with the folder each live one works in, its worktree, which `hc get` reports as
 * `foreground.cwd` and `hc ls` leaves out. A Worker herdr cannot tell it for keeps its launch folder.
 */
export function workingFolders(workers: Worker[]): Worker[] {
  return workers.map((worker) => {
    if (worker.state !== "live") {
      return worker
    }
    const got = call("hc", ["get", worker.address, "--json"])
    const foreground = got.status === 0 ? parseObject(got.stdout)?.foreground : undefined
    const cwd = isObject(foreground) ? foreground.cwd : undefined
    return typeof cwd === "string" && cwd !== "" ? { ...worker, folder: cwd } : worker
  })
}

function word(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

/** The Workers `lead` started, in the order herdr lists them; `all` adds the finished ones. */
export function workersOf(leadId: string, all: boolean): Worker[] {
  const listing = hcObject(["ls", "--json", ...(all ? ["--all"] : []), "--label", "role=worker"])
  const { terminals } = listing
  if (!Array.isArray(terminals)) {
    throw new Refusal("hc ls answered no list of terminals", "check hc --version")
  }
  return terminals.flatMap((entry: unknown): Worker[] => {
    if (!isObject(entry) || entry.parent !== leadId) {
      return []
    }
    const { address, state, cwd } = entry
    if (typeof address !== "string" || typeof state !== "string" || typeof cwd !== "string") {
      throw new Refusal("hc ls answered a terminal without an address, state or folder", "check hc --version")
    }
    const status = state === "finished" ? "finished" : (word(entry.status) ?? "unknown")
    return [{ name: word(entry.name) ?? address, address, state, status, folder: cwd }]
  })
}

/** A table of rows, every column but the last padded to its widest cell and two spaces apart. */
export function table(rows: string[][]): string {
  const widths = (rows[0] ?? []).map((_, column) => Math.max(...rows.map((row) => (row[column] ?? "").length)))
  return rows
    .map((row) =>
      row.map((cell, column) => (column === row.length - 1 ? cell : cell.padEnd((widths[column] ?? 0) + 2))).join("")
    )
    .join("\n")
}
