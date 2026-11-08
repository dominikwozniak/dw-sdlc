// Every short-lived child process the package runs: stopped at a time limit, so a tool that hangs cannot
// hang the command, and with git's prompts off, since nobody would see one. A Step of the Gate runs
// through `run-command.ts` instead, and takes as long as it takes.

import { spawnSync, type SpawnSyncReturns } from "node:child_process"

const LIMIT_MS = 120_000
/** For what the network or a repository's size can stretch: a clone, a fetch, a scan of its history. */
export const SLOW_LIMIT_MS = 600_000
/** A Step that writes thousands of files makes a diff-tree past the default of 1 MiB. */
const MAX_BUFFER = 64 * 1024 * 1024
const SHOWN = 80

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

/** `tool args` as a child process; a tool's own exit, or its absence, is the caller's. Throws `TimedOut` at the limit. */
export function exec(tool: string, args: string[], options: ExecOptions = {}): SpawnSyncReturns<string> {
  const { cwd, env = process.env, input } = options
  const limitMs = limitOf(options.limitMs ?? LIMIT_MS)
  const result = spawnSync(tool, args, {
    ...(cwd === undefined ? {} : { cwd }),
    ...(input === undefined ? {} : { input }),
    encoding: "utf8",
    env: { ...env, GIT_TERMINAL_PROMPT: "0" },
    killSignal: "SIGKILL",
    maxBuffer: MAX_BUFFER,
    timeout: limitMs
  })
  if (result.error !== undefined && "code" in result.error && result.error.code === "ETIMEDOUT") {
    throw new TimedOut(`${shown(tool, args)} did not answer within ${limitMs / 1000} s`)
  }
  return result
}
