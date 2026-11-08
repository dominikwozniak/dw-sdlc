// What a worktree's lock means to a Sweep. Claude Code locks the worktree of a session with the reason
// `claude session <name> (pid <N> start <time>)`, <time> as `ps -o lstart` writes it. Such a lock is stale
// once no process N runs or N started at another time. Any other reason is the dev's to lift.

import { spawnSync } from "node:child_process"

import { shellLine } from "./pr/decide.ts"

const CLAUDE_LOCK = /^claude session (.*) \(pid (\d{1,10}) start (.+)\)$/
const MAX_PID = 2 ** 31 - 1

export type LockVerdict =
  | { state: "none" }
  /** The process is gone: `held` is the reason to put back should the removal fail, `why` what the Sweep tells. */
  | { state: "stale"; held: string; why: string }
  | { state: "stays"; reason: string; command: string | null }

type Process = { at: "gone" } | { at: "unknown" } | { at: "running"; start: string }

/** Whether process `pid` runs and, if so, the start time `ps` reports, whitespace collapsed. */
function processOf(pid: number): Process {
  try {
    process.kill(pid, 0)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") {
      return { at: "gone" }
    }
  }
  const result = spawnSync("ps", ["-o", "lstart=", "-p", String(pid)], {
    encoding: "utf8",
    env: { ...process.env, LC_ALL: "C" }
  })
  const start = result.status === 0 ? result.stdout.trim().replace(/\s+/g, " ") : ""
  return start === "" ? { at: "unknown" } : { at: "running", start }
}

/** What the lock of the worktree at `path`, held for `reason`, says about whether the Sweep may lift it. */
export function lockVerdict(path: string, reason: string | undefined): LockVerdict {
  if (reason === undefined) {
    return { state: "none" }
  }
  const unlock = shellLine(["git", "worktree", "unlock", path])
  const match = CLAUDE_LOCK.exec(reason)
  const pid = Number(match?.[2])
  if (match === null || pid < 1 || pid > MAX_PID) {
    const said = reason === "" ? "locked, with no reason given" : `locked: ${reason}`
    return { state: "stays", reason: said, command: unlock }
  }
  const [, , , start = ""] = match
  const now = processOf(pid)
  if (now.at === "gone") {
    return { state: "stale", held: reason, why: `pid ${pid} is gone, no process runs under it` }
  }
  if (now.at === "unknown") {
    return { state: "stays", reason: `locked: ${reason}; ps could not say whether pid ${pid} runs`, command: unlock }
  }
  if (now.start !== start.trim().replace(/\s+/g, " ")) {
    return {
      state: "stale",
      held: reason,
      why: `pid ${pid} is gone, it now belongs to another process (started ${now.start})`
    }
  }
  return {
    state: "stays",
    reason: `locked by a live Claude Code session: pid ${pid} is running (${reason})`,
    command: null
  }
}
