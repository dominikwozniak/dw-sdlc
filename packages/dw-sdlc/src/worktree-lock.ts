// What a worktree's lock means to a Sweep. Claude Code locks the worktree of a session with the reason
// `claude session <name> (pid <N> start <time>)`, <time> as `ps -o lstart` writes it in UTC. Such a lock is
// stale once no process N runs or N started at another time. Any other reason is the dev's to lift.

import { exec } from "./exec.ts"
import { shellLine } from "./pr/decide.ts"

const CLAUDE_LOCK = /^claude session .* \(pid (?<pid>\d{1,10}) start (?<start>.+)\)$/
const MAX_PID = 2 ** 31 - 1

/** The process is gone: `held` is the reason to put back should the removal fail, `why` what the Sweep tells. */
export type StaleLock = { state: "stale"; held: string; why: string }

/** A lock that keeps the worktree; `pid` is the live process a Claude Code lock names. */
export type LockStays = { state: "stays"; reason: string; command: string | null; pid?: number }

export type LockVerdict = { state: "none" } | StaleLock | LockStays

type Running = { at: "gone" } | { at: "unknown" } | { at: "running"; starts: string[] }

const squeezed = (text: string): string => text.trim().replace(/\s+/g, " ")

/**
 * Whether process `pid` runs and, if so, its start time as `ps` writes it in UTC and in local time, so a
 * live lock is never taken for stale over a time zone.
 */
function runningOf(pid: number): Running {
  try {
    process.kill(pid, 0)
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ESRCH") {
      return { at: "gone" }
    }
  }
  const starts = [{ TZ: "UTC" }, {}]
    .map((zone) => {
      const env = { ...process.env, LC_ALL: "C", ...zone }
      const result = exec("ps", ["-o", "lstart=", "-p", String(pid)], { env })
      return result.status === 0 ? squeezed(result.stdout) : ""
    })
    .filter((start) => start !== "")
  return starts.length === 0 ? { at: "unknown" } : { at: "running", starts }
}

/** What the lock of the worktree at `path`, held for `reason`, says about whether the Sweep may lift it. */
export function lockVerdict(path: string, reason: string | undefined): LockVerdict {
  if (reason === undefined) {
    return { state: "none" }
  }
  const unlock = shellLine(["git", "worktree", "unlock", path])
  const { pid: pidText = "", start = "" } = CLAUDE_LOCK.exec(reason)?.groups ?? {}
  const pid = Number(pidText)
  if (pidText === "" || pid < 1 || pid > MAX_PID) {
    const said = reason === "" ? "locked, with no reason given" : `locked: ${reason}`
    return { state: "stays", reason: said, command: unlock }
  }
  const now = runningOf(pid)
  if (now.at === "gone") {
    return { state: "stale", held: reason, why: `pid ${pid} is gone, no process runs under it` }
  }
  if (now.at === "unknown") {
    return { state: "stays", reason: `locked: ${reason}; ps could not say whether pid ${pid} runs`, command: unlock }
  }
  if (!now.starts.includes(squeezed(start))) {
    const started = now.starts[0] ?? ""
    return {
      state: "stale",
      held: reason,
      why: `pid ${pid} is gone, it now belongs to another process (started ${started} UTC)`
    }
  }
  return {
    state: "stays",
    reason: `locked by a live Claude Code session: pid ${pid} is running (${reason})`,
    command: null,
    pid
  }
}
