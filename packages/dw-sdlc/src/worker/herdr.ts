// herdr's CLI, `hc`, run from this one place, each reply parsed once into a typed value: a read that fails
// stops the command through `CannotRun` with hc's words, an action answers its refusal. Beside it:
// `herdr-app`, the Lead a command acts for, and the Workers herdr lists for it.

import { CannotRun } from "../cannot-run.ts"
import { type Called, need, whyFailed } from "../exec.ts"
import { isObject, type JsonObject, parseObject } from "../json-text.ts"

const REMEDIES = {
  missing: "install herdr, or run the command in a terminal herdr started",
  stalled: "check herdr is responding, then call again"
}
/** The remedy for a reply in a shape this module does not read. */
const SHAPE = "check hc --version"

/** hc's exit when it has no such terminal. */
const NO_TERMINAL = 3
/** `hc send`'s exit when the target sits on a permission or a question. */
const BLOCKED = 9
/** `hc kill`'s exit when the terminal finished before the stop. */
const FINISHED = 11

/** A terminal as `hc ls --json` lists it. */
export type Listed = {
  address: string
  /** Its name, else its address. */
  name: string
  /** The terminal that started it. */
  parent: string | undefined
  /** herdr's state: live or finished. */
  state: string
  /** The word it reports, undefined before it reports one. */
  status: string | undefined
  /** The folder it was launched in. */
  folder: string
  /** The place herdr shows it at: its space and tab. */
  place: string | undefined
}

/** A terminal as `hc get --json` reports it. */
export type Reading = {
  /** herdr's state: live or finished. */
  state: string | undefined
  /** The state its program reports. */
  status: string | undefined
  /** The herdr space it sits in, its `herdr.space` label. */
  space: string | undefined
  /** Whether herdr sent its first message, and why not when it did not. */
  firstMessage: { sent: boolean; reason: string | undefined } | undefined
  /** The folder its foreground program works in. */
  folder: string | undefined
  /** That program's pid. */
  pid: number | undefined
}

/** What one call answered: its JSON object, or why there is none. */
type Answer = { object: JsonObject } | { status: number; problem: string; remedy?: string }

/** `hc args`; one not on PATH, or past its limit, stops the command. */
function hc(args: string[]): Called {
  return need("hc", args, REMEDIES)
}

/** `herdr-app args`, the window's CLI; one not on PATH, or past its limit, stops the command. */
export function herdrApp(args: string[]): Called {
  return need("herdr-app", args, REMEDIES)
}

/** The JSON object `hc <args>` prints, or why it printed none; `shown` names the call, as `hc get t3`. */
function answer(args: string[], shown: string): Answer {
  const called = hc(args)
  if (called.status !== 0) {
    return { status: called.status, problem: `${shown} failed: ${whyFailed(called)}` }
  }
  const object = parseObject(called.stdout)
  return object === undefined
    ? { status: 0, problem: `${shown} answered something that is no JSON object`, remedy: SHAPE }
    : { object }
}

/** The object `answered` holds; a call that answered none stops the command. */
function objectOf(answered: Answer): JsonObject {
  if ("object" in answered) {
    return answered.object
  }
  throw new CannotRun(answered.problem, answered.remedy)
}

/** A string that says something, else undefined. */
function word(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined
}

function listedOf(entry: unknown): Listed {
  const address = isObject(entry) ? word(entry.address) : undefined
  if (!isObject(entry) || address === undefined || typeof entry.state !== "string" || typeof entry.cwd !== "string") {
    throw new CannotRun("hc ls answered a terminal without an address, state or folder", SHAPE)
  }
  return {
    address,
    name: word(entry.name) ?? address,
    parent: word(entry.parent),
    state: entry.state,
    status: word(entry.status),
    folder: entry.cwd,
    place: word(entry.where)
  }
}

function readingOf({ state, status, labels, first_message: first, foreground }: JsonObject): Reading {
  const program = isObject(foreground) ? foreground : {}
  return {
    state: word(state),
    status: isObject(status) ? word(status.state) : undefined,
    space: isObject(labels) ? word(labels["herdr.space"]) : undefined,
    firstMessage:
      isObject(first) && typeof first.sent === "boolean" ? { sent: first.sent, reason: word(first.reason) } : undefined,
    folder: word(program.cwd),
    pid: typeof program.pid === "number" ? program.pid : undefined
  }
}

/** The terminals `hc ls` lists: the live ones, every one with `all`, only those labelled `label` when given. */
export function listTerminals(filter: { all?: boolean; label?: string } = {}): Listed[] {
  const all = filter.all === true ? ["--all"] : []
  const label = filter.label === undefined ? [] : ["--label", filter.label]
  const { terminals } = objectOf(answer(["ls", "--json", ...all, ...label], "hc ls"))
  if (!Array.isArray(terminals)) {
    throw new CannotRun("hc ls answered no list of terminals", SHAPE)
  }
  return terminals.map(listedOf)
}

/** What `hc get` reports of the terminal at `address`, or `gone`, in hc's words, when herdr has no such terminal. */
export function readTerminal(address: string): Reading | { gone: string } {
  const answered = answer(["get", address, "--json"], `hc get ${address}`)
  if ("status" in answered && answered.status === NO_TERMINAL) {
    return { gone: answered.problem }
  }
  return readingOf(objectOf(answered))
}

export type Start = {
  name: string
  /** Its labels, each passed as `--label key=value` in order. */
  labels: Record<string, string>
  /** The folder it starts in. */
  cwd: string
  /** The program and its arguments. */
  argv: string[]
}

/** Runs `argv` in a terminal of its own in the background, outliving its caller; the address hc gives it. */
export function startTerminal({ name, labels, cwd, argv }: Start): string {
  const label = Object.entries(labels).flatMap(([key, value]) => ["--label", `${key}=${value}`])
  const args = ["run", "--bg", "--json", "--name", name, ...label, "--outlive-parent", "--cwd", cwd, "--", ...argv]
  const address = word(objectOf(answer(args, "hc run")).address)
  if (address === undefined) {
    throw new CannotRun(
      "hc run answered no address for the terminal it started",
      "check hc ls before starting it again"
    )
  }
  return address
}

/** Stops the terminal at `address`: hc's words when it refuses, undefined once it is stopped or had finished. */
export function stopTerminal(address: string): string | undefined {
  const called = hc(["kill", address])
  return called.status === 0 || called.status === FINISHED
    ? undefined
    : `hc kill ${address} failed: ${whyFailed(called)}`
}

/** Removes the terminal at `address`: hc's words when it refuses, undefined once it is gone. */
export function removeTerminal(address: string): string | undefined {
  const called = hc(["rm", address])
  return called.status === 0 || called.status === NO_TERMINAL
    ? undefined
    : `hc rm ${address} failed: ${whyFailed(called)}`
}

/** Types `message` into the terminal at `address`: `sent`, `blocked` while it sits on a dialog, else hc's words. */
export function sendTo(address: string, message: string): "sent" | "blocked" | { refused: string } {
  const called = hc(["send", address, message])
  if (called.status === 0) {
    return "sent"
  }
  return called.status === BLOCKED ? "blocked" : { refused: `hc send failed: ${whyFailed(called)}` }
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
    throw new CannotRun(
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

/** Whether herdr still runs the Worker's terminal; the one test of it every command shares. */
export function isLive(worker: Worker): boolean {
  return worker.state === "live"
}

/**
 * The Workers with the folder each live one works in, its worktree, which `hc get` reports and `hc ls`
 * leaves out. A Worker herdr cannot tell it for keeps its launch folder.
 */
export function workingFolders(workers: Worker[]): Worker[] {
  return workers.map((worker) => {
    if (!isLive(worker)) {
      return worker
    }
    const answered = answer(["get", worker.address, "--json"], `hc get ${worker.address}`)
    const folder = "object" in answered ? readingOf(answered.object).folder : undefined
    return folder === undefined ? worker : { ...worker, folder }
  })
}

/** The Workers `leadId` started, in the order herdr lists them; `all` adds the finished ones. */
export function workersOf(leadId: string, all: boolean): Worker[] {
  return listTerminals({ all, label: "role=worker" })
    .filter(({ parent }) => parent === leadId)
    .map(({ name, address, state, status, folder }) => ({
      name,
      address,
      state,
      status: state === "finished" ? "finished" : (status ?? "unknown"),
      folder
    }))
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
