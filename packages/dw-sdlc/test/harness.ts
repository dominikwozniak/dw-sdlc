// What the package's tests share: throwaway repositories, kept apart from the machine's git config.

import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { after } from "node:test"

/** The checkout of dw-sdlc holding this package. */
export const REPO_ROOT = join(import.meta.dirname, "..", "..", "..")

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

/** `git init -q` at `dir`, with an origin remote when given. */
export function initRepo(dir: string, options: { remote?: string } = {}): string {
  mkdirSync(dir, { recursive: true })
  git(dir, "init", "-q")
  if (options.remote !== undefined) {
    git(dir, "remote", "add", "origin", options.remote)
  }
  return dir
}

export function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}
