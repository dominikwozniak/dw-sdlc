// How the Gate runs one command, a Step or a `gate.checks.run` script: `sh -c` from the repository
// root in a process group of its own, stdin closed, output captured or passed through; and how SIGINT
// and SIGTERM stop it, every process it started and every command after it.

import { spawn, type StdioOptions } from "node:child_process"
import { closeSync, fstatSync, mkdtempSync, openSync, readSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

export type Status = "pass" | "fail" | "error"

/**
 * Where a command's output goes: `capture` keeps its last lines when it does not pass; `stdout` and
 * `stderr` pass it through as it is written, onto stderr when `--json` keeps stdout for the document.
 */
export type Output = "capture" | "stdout" | "stderr"

export type Ran = {
  status: Status
  /** Null when it never started or a signal stopped it. */
  exitCode: number | null
  /** The signal that stopped it: one the Gate got while it ran, or one that ended it. */
  signal: NodeJS.Signals | null
  seconds: number
  /** What went wrong, as `exited 3`; absent on a pass. */
  detail?: string
  /** Its last `TAIL_LINES` lines, both streams in the order written, when captured and not passing. */
  tail: string[] | null
}

export const TAIL_LINES = 50

/** What the shell answers for a command it cannot find, and for one it cannot execute. */
const NOT_RUNNABLE: Record<number, string> = { 127: "was not found", 126: "could not be executed" }
const STOPPING: NodeJS.Signals[] = ["SIGINT", "SIGTERM"]

/** The process group the running command leads, which a signal the Gate gets is passed on to. */
let running: number | undefined
/** The first SIGINT or SIGTERM the Gate got; no command starts after it. */
let received: NodeJS.Signals | undefined
/**
 * The SIGINT or SIGTERM that ended a command; no command starts after it either. A signal sent to
 * the command and the Gate together can show in the command's exit before the Gate's own handler runs.
 */
let commandEndedBy: NodeJS.Signals | undefined

function release(): void {
  for (const signal of STOPPING) {
    process.off(signal, stop)
  }
  process.off("SIGHUP", hangUp)
}

/** Sends `signal` to every process of the running command's group. */
function signalCommand(signal: NodeJS.Signals): void {
  // A pid of 0 would make the kill reach the Gate's own group.
  if (running === undefined || running <= 0) {
    return
  }
  try {
    process.kill(-running, signal)
  } catch (error) {
    // ESRCH: no process is left in the group.
    if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) {
      throw error
    }
  }
}

function stop(signal: NodeJS.Signals): void {
  if (received !== undefined) {
    // A second signal ends the Gate at once, as it would with no handler, and kills the command, which
    // ignored the first.
    signalCommand("SIGKILL")
    release()
    process.kill(process.pid, signal)
    return
  }
  received = signal
  signalCommand(signal)
}

/** A hangup ends the Gate as with no handler, passed on first: a terminal's hangup misses the command's session. */
function hangUp(): void {
  signalCommand("SIGHUP")
  release()
  process.kill(process.pid, "SIGHUP")
}

/**
 * Runs `body` with SIGINT and SIGTERM held, so a signal stops the command running and the Gate
 * reports it, and SIGHUP passed on to the command.
 */
export async function holdingSignals<T>(body: () => Promise<T>): Promise<T> {
  running = undefined
  received = undefined
  commandEndedBy = undefined
  release()
  for (const signal of STOPPING) {
    process.on(signal, stop)
  }
  process.on("SIGHUP", hangUp)
  try {
    return await body()
  } finally {
    // libuv takes a signal at once but hands it to its handler only when the loop next polls, and a
    // handler released before that poll loses it. The last command's exit is read in a poll and the
    // first immediate runs right after it, so the second waits for one more poll.
    await new Promise((resolve) => setImmediate(() => setImmediate(resolve)))
    // The Gate's own signal may still be on its way after a command it ended: the handlers stay, so
    // that signal does not end the Gate before its report.
    if (commandEndedBy === undefined || received !== undefined) {
      release()
    }
  }
}

/** The signal that stopped the run, once one has: one the Gate got or one that ended a command. */
export function stoppedBy(): NodeJS.Signals | undefined {
  return received ?? commandEndedBy
}

/** Everything written to `fd`, read from its start: the command's writes moved the offset it shares to the end. */
function written(fd: number): string {
  const buffer = Buffer.alloc(fstatSync(fd).size)
  let filled = 0
  while (filled < buffer.length) {
    const read = readSync(fd, buffer, filled, buffer.length - filled, filled)
    if (read === 0) {
      break
    }
    filled += read
  }
  return buffer.toString("utf8", 0, filled)
}

/** The last lines of `text`; a line a lone `\r` rewrote keeps the last text written over it, as a terminal shows it. */
function lastLines(text: string): string[] {
  const all = text.split(/\r?\n/)
  if (all.at(-1) === "") {
    all.pop()
  }
  return all.slice(-TAIL_LINES).map((line) => line.split("\r").findLast((part) => part !== "") ?? "")
}

type Answer = Pick<Ran, "status" | "exitCode" | "signal" | "detail">

/** What the command's exit says; a signal the Gate got while it ran stops it, however it then exited. */
function answer(exitCode: number | null, ended: NodeJS.Signals | null): Answer {
  const signal = received ?? ended
  if (signal !== null) {
    return { status: "fail", exitCode, signal, detail: `was stopped by ${signal}` }
  }
  if (exitCode === 0) {
    return { status: "pass", exitCode, signal }
  }
  const notRunnable = exitCode === null ? undefined : NOT_RUNNABLE[exitCode]
  if (notRunnable !== undefined) {
    return { status: "error", exitCode, signal, detail: `${notRunnable} (exit ${exitCode})` }
  }
  return { status: "fail", exitCode, signal, detail: `exited ${exitCode}` }
}

function run(command: string, root: string, stdio: StdioOptions): Promise<Omit<Ran, "tail">> {
  const started = performance.now()
  return new Promise((resolve) => {
    const done = (answered: Answer): void => {
      running = undefined
      resolve({ ...answered, seconds: (performance.now() - started) / 1000 })
    }
    // A session of its own makes the command lead a process group, which every process it starts joins.
    const child = spawn(command, { shell: true, cwd: root, stdio, detached: true })
    running = child.pid
    // A signal that cannot be delivered is an error too; only a child with no pid never started.
    child.on("error", (error) => {
      if (child.pid === undefined) {
        done({ status: "error", exitCode: null, signal: null, detail: `could not start: ${error.message}` })
      }
    })
    child.once("exit", (exitCode, signal) => {
      if (signal !== null && STOPPING.includes(signal)) {
        commandEndedBy ??= signal
      }
      done(answer(exitCode, signal))
    })
  })
}

export async function runCommand(command: string, root: string, output: Output): Promise<Ran> {
  if (output !== "capture") {
    return { ...(await run(command, root, ["ignore", output === "stderr" ? 2 : "inherit", "inherit"])), tail: null }
  }
  // Both streams share one open file, so its lines keep the order the command wrote them in. The file
  // leaves the disk before the command starts, so no run, an interrupted one included, leaves it behind.
  const scratch = mkdtempSync(join(tmpdir(), "dw-sdlc-run-"))
  const fd = openSync(join(scratch, "output"), "w+")
  rmSync(scratch, { recursive: true, force: true })
  try {
    const ran = await run(command, root, ["ignore", fd, fd])
    return { ...ran, tail: ran.status === "pass" ? null : lastLines(written(fd)) }
  } finally {
    closeSync(fd)
  }
}
