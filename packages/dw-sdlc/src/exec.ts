// Every short-lived child process the package runs: in a session of its own, so a time limit stops it with
// every child it started; no terminal, so no prompt, ssh's included; Ctrl-C stops the package, not the
// tool. A Step of the Gate runs through `run-command.ts`, as long as it takes.

import { spawnSync, type SpawnSyncOptionsWithStringEncoding, type SpawnSyncReturns } from "node:child_process"

import { CannotRun } from "./cannot-run.ts"

const LIMIT_MS = 120_000
/** For what the network or a repository's size can stretch: a clone, a fetch, a scan of its history. */
export const SLOW_LIMIT_MS = 600_000
/** A Step that writes thousands of files makes a diff-tree past the default of 1 MiB. */
const MAX_BUFFER = 64 * 1024 * 1024
const SHOWN = 80

/** Node's spawnSync honours `detached`, a session of its own on POSIX; its types leave it out. */
type SessionOptions = SpawnSyncOptionsWithStringEncoding & { detached: boolean }

export type ExecOptions = { cwd?: string; env?: NodeJS.ProcessEnv; input?: string; limitMs?: number }

/** A tool that outlived its limit and was stopped; the message names it. */
export class TimedOut extends Error {}

/** DW_SDLC_LIMIT_MS, which a test sets to reach a limit quickly, else the limit the call asks for. */
function limitOf(asked: number): number {
  const given = Number(process.env.DW_SDLC_LIMIT_MS)
  return given > 0 ? given : asked
}

function shown(tool: string, args: string[]): string {
  return [tool, ...args].join(" ").replaceAll(/\s+/g, " ").trim().slice(0, SHOWN)
}

/** Sends `signal` to every process of the group `pid` leads; nothing when the group is gone. */
export function signalGroup(pid: number, signal: NodeJS.Signals): void {
  // A pid of 0 would make the kill reach this process's own group.
  if (pid <= 0) {
    return
  }
  try {
    process.kill(-pid, signal)
  } catch (error) {
    // ESRCH: no process is left in the group.
    if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) {
      throw error
    }
  }
}

/** `tool args` as a child process; a tool's own exit, or its absence, is the caller's. Throws `TimedOut` at the limit. */
export function exec(tool: string, args: string[], options: ExecOptions = {}): SpawnSyncReturns<string> {
  const { cwd, env = process.env, input } = options
  const limitMs = limitOf(options.limitMs ?? LIMIT_MS)
  const spawnOptions: SessionOptions = {
    ...(cwd === undefined ? {} : { cwd }),
    ...(input === undefined ? {} : { input }),
    detached: true,
    encoding: "utf8",
    env: { ...env, GIT_TERMINAL_PROMPT: "0" },
    killSignal: "SIGKILL",
    maxBuffer: MAX_BUFFER,
    timeout: limitMs
  }
  const result = spawnSync(tool, args, spawnOptions)
  if (result.error !== undefined && "code" in result.error && result.error.code === "ETIMEDOUT") {
    // Every process left in the group the tool led; the tool itself is stopped and reaped by now.
    signalGroup(result.pid, "SIGKILL")
    throw new TimedOut(`${shown(tool, args)} did not answer within ${limitMs / 1000} s`)
  }
  return result
}

/** What a tool the command needs answered: its exit status, 1 for a signal, and both streams. */
export type Called = { status: number; stdout: string; stderr: string }

/** The first line of a tool's output that says anything, trimmed; undefined where none does. */
export function firstLine(text: string): string | undefined {
  return text
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line !== "")
}

/** Why a call failed, in the tool's words: its first line, stderr before stdout, else the exit it ended with. */
export function whyFailed({ status, stdout, stderr }: Called): string {
  return firstLine(`${stderr}\n${stdout}`) ?? `exited ${status}`
}

/**
 * `tool args` for a command that cannot go on without the tool: one not on PATH stops the command with
 * `missing`, one past its limit with `stalled`. Its own exit is the caller's.
 */
export function need(tool: string, args: string[], remedies: { missing: string; stalled: string }): Called {
  let result: SpawnSyncReturns<string>
  try {
    result = exec(tool, args)
  } catch (error) {
    throw error instanceof TimedOut ? new CannotRun(error.message, remedies.stalled) : error
  }
  if (result.error !== undefined) {
    if ("code" in result.error && result.error.code === "ENOENT") {
      throw new CannotRun(`${tool} is not on PATH`, remedies.missing)
    }
    throw result.error
  }
  return { status: result.status ?? 1, stdout: result.stdout, stderr: result.stderr }
}
