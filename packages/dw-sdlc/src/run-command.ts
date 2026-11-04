// How the Gate runs one command, a Step or a `gate.checks.run` script: through `sh -c` from the
// repository root, stdin closed, its output captured or passed through, and what it answered.

import { type SpawnSyncReturns, spawnSync, type StdioOptions } from "node:child_process"
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
  seconds: number
  /** What went wrong, as `exited 3`; absent on a pass. */
  detail?: string
  /** Its last `TAIL_LINES` lines, both streams in the order written, when captured and not passing. */
  tail: string[] | null
}

export const TAIL_LINES = 50

/** What the shell answers for a command it cannot find, and for one it cannot execute. */
const NOT_RUNNABLE: Record<number, string> = { 127: "was not found", 126: "could not be executed" }

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

function answer(result: SpawnSyncReturns<Buffer>): Pick<Ran, "status" | "exitCode" | "detail"> {
  if (result.error !== undefined) {
    return { status: "error", exitCode: null, detail: `could not start: ${result.error.message}` }
  }
  if (result.status === 0) {
    return { status: "pass", exitCode: 0 }
  }
  if (result.status === null) {
    return { status: "fail", exitCode: null, detail: `was stopped by ${result.signal ?? "a signal"}` }
  }
  const notRunnable = NOT_RUNNABLE[result.status]
  if (notRunnable !== undefined) {
    return { status: "error", exitCode: result.status, detail: `${notRunnable} (exit ${result.status})` }
  }
  return { status: "fail", exitCode: result.status, detail: `exited ${result.status}` }
}

export function runCommand(command: string, root: string, output: Output): Ran {
  const run = (stdio: StdioOptions): Pick<Ran, "status" | "exitCode" | "detail" | "seconds"> => {
    const started = performance.now()
    const answered = answer(spawnSync(command, { shell: true, cwd: root, stdio }))
    return { ...answered, seconds: (performance.now() - started) / 1000 }
  }
  if (output !== "capture") {
    return { ...run(["ignore", output === "stderr" ? 2 : "inherit", "inherit"]), tail: null }
  }
  // Both streams share one open file, so its lines keep the order the command wrote them in. The file
  // leaves the disk before the command starts, so no run, an interrupted one included, leaves it behind.
  const scratch = mkdtempSync(join(tmpdir(), "dw-sdlc-run-"))
  const fd = openSync(join(scratch, "output"), "w+")
  rmSync(scratch, { recursive: true, force: true })
  try {
    const ran = run(["ignore", fd, fd])
    return { ...ran, tail: ran.status === "pass" ? null : lastLines(written(fd)) }
  } finally {
    closeSync(fd)
  }
}
