// What the plugin's tests share: throwaway repositories kept apart from the machine's git config and
// from the git variables of the process running the tests, and the plugin's scripts and hooks spawned
// the way their callers spawn them: plain `node` for a script, `/bin/bash` with the JSON payload on
// stdin for a hook, the exit code and both streams.

import { spawn, spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { after } from "node:test"

const SCRIPTS_DIR = join(import.meta.dirname, "..", "scripts")
const HOOKS_DIR = join(import.meta.dirname, "..", "hooks")
/** The hooks' shebang, bash 3.2 on macOS — never the first bash in PATH, which may be a newer one. */
const BASH = "/bin/bash"

export type Run = { status: number; stdout: string; stderr: string }

/** The variables that tie git to one repository, as git itself lists them. */
const REPOSITORY_VARS = new Set(
  spawnSync("git", ["rev-parse", "--local-env-vars"], { encoding: "utf8" }).stdout.split("\n").filter(Boolean)
)

/**
 * This environment without them, and without the machine's git config. A git hook exports GIT_DIR:
 * inherited, it would aim every scratch commit at the repository the hook runs for.
 */
function scratchEnv(): NodeJS.ProcessEnv {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !REPOSITORY_VARS.has(name)))
  return { ...env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" }
}

function run(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, input?: string): Run {
  const result = spawnSync(command, args, { cwd, env: { ...scratchEnv(), ...env }, input, encoding: "utf8" })
  if (result.error !== undefined) {
    throw result.error
  }
  return { status: result.status ?? -1, stdout: result.stdout, stderr: result.stderr }
}

/** Runs `scripts/<name>.ts` from `cwd` under `scratchEnv()`, `env` over it. */
export function runScript(name: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = {}): Run {
  return run(process.execPath, [join(SCRIPTS_DIR, `${name}.ts`), ...args], cwd, env)
}

/** `runScript` started without waiting for it, so that two scripts run at once. */
export function startScript(name: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = {}): Promise<Run> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(SCRIPTS_DIR, `${name}.ts`), ...args], {
      cwd,
      env: { ...scratchEnv(), ...env }
    })
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

/** Runs `hooks/<name>.sh` from `cwd` under `scratchEnv()`, `env` over it, with `payload` on stdin. */
export function runHook(name: string, payload: object, cwd: string, env: NodeJS.ProcessEnv = {}): Run {
  return run(BASH, [join(HOOKS_DIR, `${name}.sh`)], cwd, env, JSON.stringify(payload))
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
