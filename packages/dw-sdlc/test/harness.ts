// What the package's tests share: throwaway repositories, kept apart from the machine's git config,
// and the `dw-sdlc` bin spawned the way a user, a hook or CI spawns it, on such a repository, with the
// exit code and both streams.

import { spawn, spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { after } from "node:test"

/** The checkout of dw-sdlc holding this package. */
export const REPO_ROOT = join(import.meta.dirname, "..", "..", "..")
/** This package's directory, the one `pnpm pack` packs. */
export const PACKAGE_ROOT = join(import.meta.dirname, "..")

/** The file the manifest's `bin` names for `dw-sdlc`, so a test runs what the workspace link runs. */
function binPath(): string {
  const manifest: unknown = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8"))
  if (typeof manifest === "object" && manifest !== null && "bin" in manifest) {
    const { bin } = manifest
    if (typeof bin === "object" && bin !== null && "dw-sdlc" in bin && typeof bin["dw-sdlc"] === "string") {
      return join(PACKAGE_ROOT, bin["dw-sdlc"])
    }
  }
  throw new Error(`${PACKAGE_ROOT}/package.json names no dw-sdlc bin`)
}

/** The bin's path; the References harness spawns it its own way. */
export const BIN = binPath()

export type Run = { status: number; stdout: string; stderr: string }

/** The variables that tie git to one repository, as git itself lists them. */
const REPOSITORY_VARS = new Set(
  spawnSync("git", ["rev-parse", "--local-env-vars"], { encoding: "utf8" }).stdout.split("\n").filter(Boolean)
)

/**
 * This environment without them, without the machine's git config, and outside GitHub Actions unless
 * a test says so: CI sets GITHUB_ACTIONS, which adds an annotation to every failure line.
 */
function scratchEnv(over: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const kept = Object.entries(process.env).filter(([name]) => !REPOSITORY_VARS.has(name) && name !== "GITHUB_ACTIONS")
  return { ...Object.fromEntries(kept), GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", ...over }
}

/** Runs `command <args>` from `cwd` under `scratchEnv()`, `env` over it. */
export function runCommand(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = {}): Run {
  // A Gate that names thousands of files prints past spawnSync's default buffer of 1 MiB.
  const result = spawnSync(command, args, { cwd, env: scratchEnv(env), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  if (result.error !== undefined) {
    throw result.error
  }
  return { status: result.status ?? -1, stdout: result.stdout, stderr: result.stderr }
}

/** Runs `dw-sdlc <args>` from `cwd` under `scratchEnv()`, `env` over it. */
export function runBin(args: string[], cwd: string, env: NodeJS.ProcessEnv = {}): Run {
  return runCommand(process.execPath, [BIN, ...args], cwd, env)
}

/** A run of the bin started by `startBin`, and the signal that ended it, if one did. */
export type Started = { group: number; done: Promise<Run & { signal: NodeJS.Signals | null }> }

/**
 * Starts `dw-sdlc <args>` from `cwd` as the leader of a process group of its own, so a test signals the
 * bin and the commands it runs together, as Ctrl-C in a terminal does.
 */
export function startBin(args: string[], cwd: string): Started {
  const child = spawn(process.execPath, [BIN, ...args], { cwd, env: scratchEnv({}), detached: true })
  if (child.pid === undefined) {
    throw new Error(`dw-sdlc ${args.join(" ")} did not start`)
  }
  let stdout = ""
  let stderr = ""
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
    stdout += chunk
  })
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
    stderr += chunk
  })
  const done = new Promise<Run & { signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once("error", reject)
    child.once("close", (status, signal) => resolve({ status: status ?? -1, stdout, stderr, signal }))
  })
  return { group: child.pid, done }
}

/** Kills what is left of the process group `group`; it may have exited already. */
export function killGroup(group: number): void {
  try {
    process.kill(-group, "SIGKILL")
  } catch {
    // The group has exited.
  }
}

/** Resolves once `ready` holds, checking every 20 ms; rejects after 10 s. */
export async function until(ready: () => boolean): Promise<void> {
  for (let waited = 0; !ready(); waited += 20) {
    if (waited >= 10_000) {
      throw new Error("timed out waiting")
    }
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

/** The non-empty lines of a command's output. */
export function lines(text: string): string[] {
  return text.split("\n").filter((line) => line !== "")
}

/** The remedy of a Step or run script that did not pass. */
export const FAILED_REMEDY = "fix what it printed above; run it alone for the full output"
/** A command printing `line 1` to `line 80`, the odd ones on stdout and the even ones on stderr, then exiting 3. */
export const NUMBERED =
  'i=1; while [ $i -le 80 ]; do if [ $((i % 2)) -eq 0 ]; then echo "line $i" >&2; else echo "line $i"; fi; i=$((i + 1)); done; exit 3'
/** The lines a failed `NUMBERED` leaves in its tail: the last 50. */
export const NUMBERED_TAIL = Array.from({ length: 50 }, (_, index) => `line ${index + 31}`)

/** The lines of a quiet Gate run, each Step's time read as `N`. */
export function timed(stdout: string): string[] {
  return lines(stdout).map((line) => line.replace(/ \(\d+ s\)/, " (N s)"))
}

const made: string[] = []
after(() => {
  for (const dir of made) {
    rmSync(dir, { recursive: true, force: true })
  }
})

/** A fresh directory by its real path — git reports real paths and macOS keeps $TMPDIR behind a symlink. */
export function scratch(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), `dw-sdlc-${prefix}-`)))
  made.push(dir)
  return dir
}

export function git(cwd: string, ...args: string[]): string {
  const result = runCommand("git", ["-C", cwd, ...args], cwd)
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} in ${cwd}: ${result.stderr}`)
  }
  return result.stdout
}

/** A commit under a fixed identity and never signed, whatever the machine's git config says. */
export function commit(cwd: string, ...args: string[]): void {
  git(cwd, "-c", "user.email=t@example.com", "-c", "user.name=t", "-c", "commit.gpgsign=false", "commit", "-q", ...args)
}

/** `git init -q` at `dir`, on `branch` when given, with an origin remote when given. */
export function initRepo(dir: string, options: { branch?: string; remote?: string } = {}): string {
  mkdirSync(dir, { recursive: true })
  git(dir, "init", "-q", ...(options.branch === undefined ? [] : ["-b", options.branch]))
  if (options.remote !== undefined) {
    git(dir, "remote", "add", "origin", options.remote)
  }
  return dir
}

export function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

/** A throwaway repository; `files` maps a relative path to its text, an object is written as JSON. */
export function repo(options: { git?: false; remote?: string; files?: Record<string, string | object> } = {}): string {
  const root = scratch("repo")
  if (options.git !== false) {
    initRepo(root, options.remote === undefined ? {} : { remote: options.remote })
  }
  for (const [file, content] of Object.entries(options.files ?? {})) {
    write(join(root, file), typeof content === "string" ? content : JSON.stringify(content))
  }
  return root
}

export function writeJson(path: string, value: unknown): void {
  write(path, `${JSON.stringify(value)}\n`)
}
