// How the Gate runs one command, a Step or a `gate.checks.run` script: through `sh -c` from the
// repository root, stdin closed, and what it answered.

import { spawnSync } from "node:child_process"

export type Status = "pass" | "fail" | "error"

export type Ran = {
  status: Status
  /** Null when it never started or a signal stopped it. */
  exitCode: number | null
  /** What went wrong, as `exited 3`; absent on a pass. */
  detail?: string
}

/** What the shell answers for a command it cannot find, and for one it cannot execute. */
const NOT_RUNNABLE: Record<number, string> = { 127: "was not found", 126: "could not be executed" }

/** Runs `command` with stderr passed through; stdout too, or onto stderr when `--json` keeps stdout for the document. */
export function runCommand(command: string, root: string, json: boolean): Ran {
  const result = spawnSync(command, { shell: true, cwd: root, stdio: ["ignore", json ? 2 : "inherit", "inherit"] })
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
