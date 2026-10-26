// What the References tests share: throwaway repositories kept apart from the machine's git config and
// from the git variables of the process running the tests, and `dw-sdlc references <command>` spawned
// the way its callers spawn it: plain `node` on the bin, the exit code and both streams.

import { spawn, spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { after } from "node:test"

import { BIN } from "./harness.ts"

export type Run = { status: number; stdout: string; stderr: string }

/** The variables that tie git to one repository, as git itself lists them. */
const REPOSITORY_VARS = new Set(
  spawnSync("git", ["rev-parse", "--local-env-vars"], { encoding: "utf8" }).stdout.split("\n").filter(Boolean)
)

/**
 * This environment without them, and without the machine's git config. A git hook exports GIT_DIR:
 * inherited, it would aim every scratch commit at the repository the hook runs for.
 */
function scratchEnv(over: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !REPOSITORY_VARS.has(name)))
  return { ...env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", ...over }
}

/**
 * `command` from `cwd` under `scratchEnv()`, `env` over it, with `input` on stdin. The references
 * plugin's hook test spawns its hook through it.
 */
export function spawnIsolated(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  input?: string
): Run {
  const result = spawnSync(command, args, { cwd, env: scratchEnv(env), input, encoding: "utf8" })
  if (result.error !== undefined) {
    throw result.error
  }
  return { status: result.status ?? -1, stdout: result.stdout, stderr: result.stderr }
}

/** The arguments `node` takes to run `dw-sdlc references <name>` with `args`. */
function commandArgs(name: string, args: string[]): string[] {
  return [BIN, "references", name, ...args]
}

/** Runs `dw-sdlc references <name>` from `cwd` under `scratchEnv()`, `env` over it. */
export function runReferences(name: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = {}): Run {
  return spawnIsolated(process.execPath, commandArgs(name, args), cwd, env)
}

/** `runReferences` started without waiting for it, so that two commands run at once. */
export function startReferences(name: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = {}): Promise<Run> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, commandArgs(name, args), { cwd, env: scratchEnv(env) })
    let stdout = ""
    let stderr = ""
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk
    })
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk
    })
    child.on("error", reject)
    child.on("close", (status) => {
      resolve({ status: status ?? -1, stdout, stderr })
    })
  })
}

const made: string[] = []
after(() => {
  for (const dir of made) {
    rmSync(dir, { recursive: true, force: true })
  }
})

/** A fresh directory by its real path — git reports real paths and macOS keeps $TMPDIR behind a symlink. */
export function scratch(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), `references-${prefix}-`)))
  made.push(dir)
  return dir
}

export function git(cwd: string, ...args: string[]): string {
  const result = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8", env: scratchEnv() })
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} in ${cwd}: ${result.stderr}`)
  }
  return result.stdout
}

const IDENTITY = ["-c", "user.email=t@example.com", "-c", "user.name=t"]

/** A commit under a fixed identity. */
export function commit(cwd: string, ...args: string[]): void {
  git(cwd, ...IDENTITY, "commit", "-q", ...args)
}

/** An annotated tag, the kind a release carries, under the same identity: a tagger is required. */
export function tag(cwd: string, name: string): void {
  git(cwd, ...IDENTITY, "tag", "-a", name, "-m", name)
}

/** `git init -q -b main` at `dir`. */
export function initRepo(dir: string): string {
  mkdirSync(dir, { recursive: true })
  git(dir, "init", "-q", "-b", "main")
  return dir
}

export function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

export function writeJson(path: string, value: unknown): void {
  write(path, `${JSON.stringify(value, null, 2)}\n`)
}
