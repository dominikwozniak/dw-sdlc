// The Gate's cache: a checkout's fingerprint, its working tree's content and the Gate that judges it,
// against the stamp of its last green run, kept in the checkout's own git dir so each worktree has its
// own. The real index is never touched.

import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { Gate } from "./agentic-config.ts"
import { repositoryFreeEnv } from "./git-env.ts"

const STAMP_FILE = "dw-sdlc-gate.green"
const MANIFEST = join(import.meta.dirname, "..", "package.json")

/** A checkout's fingerprint and the file its last green run is stamped in. */
export type Fingerprint = { key: string; stampFile: string }

/** `git <args>` in the repository at `root`, on `index` when given. */
function git(root: string, args: string[], index?: string): { out: string } | { error: string } {
  const env = repositoryFreeEnv()
  const result = spawnSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    env: index === undefined ? env : { ...env, GIT_INDEX_FILE: index }
  })
  if (result.status === 0) {
    return { out: result.stdout.trim() }
  }
  const reason = result.error?.message ?? result.stderr.split("\n").find((line) => line.trim() !== "")
  return { error: `git ${args[0] ?? ""}: ${reason?.trim() ?? `exited ${result.status ?? "on a signal"}`}` }
}

/**
 * The tree `git write-tree` hashes from a copy of the index after `git add -A` on it: the copy keeps the
 * stat cache, so only what changed is read again; identical content survives a commit, an amend or a
 * rebase, and a new untracked file changes it while an ignored one does not.
 */
function treeOf(root: string, gitDir: string): { out: string } | { error: string } {
  const scratch = mkdtempSync(join(tmpdir(), "dw-sdlc-gate-"))
  const index = join(scratch, "index")
  const real = join(gitDir, "index")
  try {
    if (existsSync(real)) {
      // git trusts a cached stat only when the index is newer than the file, so the copy takes the mtime
      // the real one had before it was read: a newer one would hide an edit made in that same second.
      const { atime, mtime } = statSync(real)
      copyFileSync(real, index)
      utimesSync(index, atime, mtime)
    }
    const added = git(root, ["add", "-A"], index)
    return "error" in added ? added : git(root, ["write-tree"], index)
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

/** The version of this package, whose Checks the Gate runs, or undefined when its manifest names none. */
function packageVersion(): string | undefined {
  const manifest: unknown = JSON.parse(readFileSync(MANIFEST, "utf8"))
  if (typeof manifest === "object" && manifest !== null && "version" in manifest) {
    return typeof manifest.version === "string" ? manifest.version : undefined
  }
  return undefined
}

/** The fingerprint of the checkout at `root` judged by `gate`, or why it has none. */
export function fingerprint(root: string, gate: Gate): Fingerprint | { error: string } {
  try {
    const gitDir = git(root, ["rev-parse", "--absolute-git-dir"])
    if ("error" in gitDir) {
      return gitDir
    }
    const tree = treeOf(root, gitDir.out)
    if ("error" in tree) {
      return tree
    }
    const judge = createHash("sha256").update(JSON.stringify({ version: packageVersion(), gate }))
    return { key: `${tree.out} ${judge.digest("hex")}`, stampFile: join(gitDir.out, STAMP_FILE) }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

/** Whether the last green run of this checkout was stamped with this fingerprint. */
export function isGreen({ key, stampFile }: Fingerprint): boolean {
  try {
    return readFileSync(stampFile, "utf8").trim() === key
  } catch {
    return false
  }
}

/** Stamps a green run. */
export function stampGreen({ key, stampFile }: Fingerprint): void {
  try {
    writeFileSync(stampFile, `${key}\n`)
  } catch {
    // A stamp that cannot be written only means the next run does not skip.
  }
}
