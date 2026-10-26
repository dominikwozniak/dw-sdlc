// What the plugin's tests share: spawning a guard the way Claude Code does — the JSON payload on
// stdin, the verdict in the exit code and stdout — and throwaway repositories to aim it at, kept
// apart from the machine's git config and shell environment. jq is a hard requirement: the guards
// no-op without it, so a machine without it fails these tests loudly instead of passing them empty.

import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { after } from "node:test"

export const HOOKS_DIR = join(import.meta.dirname, "..", "hooks")
export const REPO_ROOT = join(import.meta.dirname, "..", "..", "..")
/** The hooks' shebang, bash 3.2 on macOS — never the first bash in PATH, which may be a newer one. */
const BASH = "/bin/bash"

if (spawnSync("jq", ["--version"]).status !== 0) {
  throw new Error("jq is missing; the guards no-op without it and their tests cannot run")
}

export type Verdict = { status: number; stdout: string; stderr: string }
export type RunOptions = { cwd?: string | undefined; env?: NodeJS.ProcessEnv | undefined; args?: string[] | undefined }

export function hookPath(name: string): string {
  return join(HOOKS_DIR, `${name}.sh`)
}

/**
 * `/bin/bash <args>` with `input` on stdin — a string verbatim, anything else as JSON — under LC_ALL=C
 * and without the large-file guard's kill switch, which a developer's shell may export.
 */
export function runBash(args: string[], input: unknown, options: RunOptions = {}): Verdict {
  const env: NodeJS.ProcessEnv = { ...process.env, LC_ALL: "C" }
  delete env.CLAUDE_MAX_WRITE_BYTES
  const result = spawnSync(BASH, args, {
    input: typeof input === "string" ? input : JSON.stringify(input),
    cwd: options.cwd,
    env: { ...env, ...options.env },
    encoding: "utf8"
  })
  if (result.error !== undefined) {
    throw result.error
  }
  return { status: result.status ?? -1, stdout: result.stdout, stderr: result.stderr }
}

/** Runs `hooks/<name>.sh` with `input` on stdin. */
export function runHook(name: string, input: unknown, options: RunOptions = {}): Verdict {
  return runBash([hookPath(name), ...(options.args ?? [])], input, options)
}

/** runHook without blocking, for a suite that runs its cases concurrently. */
export function runHookAsync(name: string, input: unknown): Promise<Verdict> {
  const env: NodeJS.ProcessEnv = { ...process.env, LC_ALL: "C" }
  delete env.CLAUDE_MAX_WRITE_BYTES
  return new Promise((resolve, reject) => {
    const child = spawn(BASH, [hookPath(name)], { env })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8")
    })
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8")
    })
    child.on("error", reject)
    child.on("close", (status) => {
      resolve({ status: status ?? -1, stdout, stderr })
    })
    child.stdin.end(typeof input === "string" ? input : JSON.stringify(input))
  })
}

export function bashPayload(command: string, cwd?: string): object {
  return {
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    ...(cwd === undefined ? {} : { cwd }),
    tool_input: { command }
  }
}

export function filePayload(tool: string, filePath: string, cwd?: string): object {
  return {
    hook_event_name: "PreToolUse",
    tool_name: tool,
    ...(cwd === undefined ? {} : { cwd }),
    tool_input: { file_path: filePath }
  }
}

/** The exit code a guard answered with; the message carries both streams for the failing case. */
export function expectExit(verdict: Verdict, want: number): void {
  const detail = `want exit ${want}, got ${verdict.status}\nstdout: ${verdict.stdout}\nstderr: ${verdict.stderr}`
  assert.equal(verdict.status, want, detail)
}

/** deny (exit 2), ask (the JSON verdict), pass (exit 0 and silent), or what else came back. */
export function verdictOf({ status, stdout }: Verdict): string {
  if (status === 2) {
    return "deny"
  }
  if (status !== 0) {
    return `rc=${status}`
  }
  if (stdout.includes('"permissionDecision":"ask"')) {
    return "ask"
  }
  if (stdout === "") {
    return "pass"
  }
  return `unexpected:${stdout}`
}

const made: string[] = []
after(() => {
  for (const dir of made) {
    rmSync(dir, { recursive: true, force: true })
  }
})

/** A fresh directory by its real path — git reports real paths and macOS keeps $TMPDIR behind a symlink. */
export function scratch(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), `guardrails-${prefix}-`)))
  made.push(dir)
  return dir
}

export function git(cwd: string, ...args: string[]): string {
  const result = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" })
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

export function writeJson(path: string, value: unknown): void {
  write(path, `${JSON.stringify(value)}\n`)
}

/** The machine's PATH behind a `bash` that exits 97, so a spawn that looks bash up in PATH shows. */
export function pathWithFakeBash(): string {
  const bin = scratch("fake-bash")
  write(join(bin, "bash"), "#!/bin/sh\nexit 97\n")
  chmodSync(join(bin, "bash"), 0o755)
  return `${bin}:${process.env.PATH ?? ""}`
}
