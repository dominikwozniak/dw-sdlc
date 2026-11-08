// `dw-sdlc sweep`: removes each linked worktree whose whole set passes and each Landed local branch.
// docs/adr/0015 sets its bounds: it runs from the main checkout, never forces and never writes to a remote.

import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { parseArgs } from "node:util"

import { findRepository, mainCheckout, resolveConfig } from "../agentic-config.ts"
import { repositoryFreeEnv } from "../git-env.ts"
import { isCommitLanded, isLanded } from "../landed.ts"
import { shellLine } from "../pr/decide.ts"
import { CannotRun } from "../pr/read.ts"
import { asked, git } from "../working-tree.ts"

export const summary = "removes Landed branches and clean worktrees whose work has landed, names what it keeps"

const USAGE = `Usage: dw-sdlc sweep [--dry-run] [--json]

Run from the main checkout. Fetches origin, reads the base branch as the guards do (baseBranch of the
config, else the branch origin/HEAD names) and removes, never forcing:
  every linked worktree, wherever it lies, whose whole set passes: no modified or untracked file (ignored
  files aside), no paused rebase, merge, cherry-pick, revert or bisect, no lock, and its HEAD Landed, on a
  branch or detached; the branch it had checked out goes right after it;
  every other local branch that is Landed: its work is on the base, as a squash merge leaves it.
It keeps, and names with the reason and the command to run yourself:
  a worktree that fails the set: the files that hold it with the forced removal, the paused operation, the
  lock's reason, a HEAD that is not Landed;
  the default branch, the base branch, a protected branch and a branch a kept worktree has checked out;
  a branch whose work is on no commit of the base, with the forced delete.
It never changes anything on a remote: the fetch only writes remote-tracking refs. A removal git refuses is
kept with git's words, and the sweep goes on.

--dry-run removes nothing and answers the same items. One line an item, or one document with --json:
  { dryRun, base, removed: [item], kept: [item] }, an item { kind, name, reason, command? }, kind branch or
  worktree, name its path, command the one the dev would run for a kept item.

Exit 0 nothing is kept but the default, the base or a protected branch, 1 something else is, 2 when it
cannot run: in a linked worktree, with no base to read, or when the fetch fails.`

type Item = { kind: "branch" | "worktree"; name: string; reason: string }
type Kept = Item & { command: string | null; dev: boolean }
/** An item to remove; a worktree's `holds` is the branch it has checked out. */
type Planned = Item & { holds?: string }
type Shown = Item & { command?: string | null }

type Sweep = { dryRun: boolean; base: string; removed: Shown[]; kept: Shown[] }

/** `git <args>` at `root`, or a stop naming its problem. */
function must(root: string, args: string[]): string {
  const result = git(root, args)
  if ("error" in result) {
    throw new CannotRun(result.error, "check the repository with git status")
  }
  return result.out
}

function forcedDelete(branch: string): string {
  return shellLine(["git", "branch", "-D", branch])
}

function forcedRemoval(path: string): string {
  return shellLine(["git", "worktree", "remove", "--force", path])
}

function fetchOrigin(root: string): void {
  if (asked(root, ["remote", "get-url", "origin"]) === undefined) {
    return
  }
  const env = { ...repositoryFreeEnv(), GIT_TERMINAL_PROMPT: "0" }
  const result = spawnSync("git", ["-C", root, "fetch", "--quiet", "origin"], { encoding: "utf8", env, stdio: "pipe" })
  if (result.status !== 0) {
    const said = result.stderr.split("\n").find((line) => line.trim() !== "")
    throw new CannotRun(
      `git fetch origin failed: ${said?.trim() ?? `exited ${result.status}`}`,
      "check the network, then call again"
    )
  }
}

/** The branch refs/remotes/origin/HEAD names, if it names one of origin. */
function originHead(root: string): string | undefined {
  const prefix = "refs/remotes/origin/"
  const ref = asked(root, ["symbolic-ref", "-q", "refs/remotes/origin/HEAD"])
  return ref !== undefined && ref.startsWith(prefix) && ref.length > prefix.length
    ? ref.slice(prefix.length)
    : undefined
}

/** The base branch the guard reads: `baseBranch` of the config, under `auto` the branch origin/HEAD names. */
function baseOf(root: string, head: string | undefined): { name: string; ref: string } {
  const configured = resolveConfig(root).config.baseBranch
  const name = configured === "" || configured === "auto" ? head : configured
  if (name === undefined) {
    throw new CannotRun(
      "no base branch is known to check the branches against: origin/HEAD names no branch of origin",
      "run git remote set-head origin --auto, or set baseBranch in .ai/agentic.config.json"
    )
  }
  const ref = `refs/remotes/origin/${name}`
  if (
    asked(root, ["check-ref-format", ref]) === undefined ||
    asked(root, ["rev-parse", "--verify", "-q", `${ref}^{commit}`]) === undefined
  ) {
    throw new CannotRun(
      `the base branch origin/${name} is not here to check the branches against`,
      "run git fetch origin, or fix baseBranch in .ai/agentic.config.json"
    )
  }
  return { name, ref }
}

function branchesOf(root: string): string[] {
  return must(root, ["for-each-ref", "--format=%(refname:lstrip=2)", "refs/heads"])
    .split("\n")
    .filter((name) => name !== "")
}

type Tree = { path: string; head: string; branch: string | undefined; lock: string | undefined; prunable: boolean }

/** Every worktree of the repository, the main checkout first. */
function worktreesOf(root: string): Tree[] {
  const trees: Tree[] = []
  let tree: Tree | undefined
  for (const line of must(root, ["worktree", "list", "--porcelain"]).split("\n")) {
    if (line.startsWith("worktree ")) {
      tree = { path: line.slice("worktree ".length), head: "", branch: undefined, lock: undefined, prunable: false }
      trees.push(tree)
    } else if (tree !== undefined && line.startsWith("HEAD ")) {
      tree.head = line.slice("HEAD ".length)
    } else if (tree !== undefined && line.startsWith("branch refs/heads/")) {
      tree.branch = line.slice("branch refs/heads/".length)
    } else if (tree !== undefined && (line === "locked" || line.startsWith("locked "))) {
      tree.lock = line.slice("locked".length).trim()
    } else if (tree !== undefined && (line === "prunable" || line.startsWith("prunable "))) {
      tree.prunable = true
    }
  }
  return trees
}

/** The files `git status` lists in the worktree at `path`, ignored ones aside, or why it cannot be read. */
function dirtyFiles(path: string): string[] | { error: string } {
  const args = ["-C", path, "status", "--porcelain=v1", "-z", "--untracked-files=all"]
  const result = spawnSync("git", args, { encoding: "utf8", env: repositoryFreeEnv(), maxBuffer: 64 * 1024 * 1024 })
  if (result.status !== 0) {
    const said = result.stderr.split("\n").find((line) => line.trim() !== "")
    return { error: `git status: ${said?.trim() ?? `exited ${result.status ?? "on a signal"}`}` }
  }
  const files: string[] = []
  const entries = result.stdout.split("\0").filter((entry) => entry !== "")
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index] ?? ""
    files.push(entry.slice(3))
    if (entry.startsWith("R") || entry.startsWith("C")) {
      index++
    }
  }
  return files
}

const OPERATIONS = [
  ["rebase-merge", "rebase"],
  ["rebase-apply", "rebase or am"],
  ["MERGE_HEAD", "merge"],
  ["CHERRY_PICK_HEAD", "cherry-pick"],
  ["REVERT_HEAD", "revert"],
  ["BISECT_LOG", "bisect"]
] as const

/** The operation paused in the worktree at `path`: its git dir holds the state git resumes it from. */
function pausedOperation(path: string): string | undefined {
  const dir = asked(path, ["rev-parse", "--absolute-git-dir"])
  return dir === undefined ? undefined : OPERATIONS.find(([file]) => existsSync(join(dir, file)))?.[1]
}

/** Why the worktree stays, with the dev's command when there is one, or null when its whole set passes. */
function whyTreeStays(root: string, baseRef: string, tree: Tree): Pick<Kept, "reason" | "command"> | null {
  const { path } = tree
  if (tree.prunable) {
    return { reason: "its folder is gone", command: shellLine(["git", "worktree", "prune"]) }
  }
  if (tree.lock !== undefined) {
    const reason = tree.lock === "" ? "locked, with no reason given" : `locked: ${tree.lock}`
    return { reason, command: shellLine(["git", "worktree", "unlock", path]) }
  }
  const operation = pausedOperation(path)
  if (operation !== undefined) {
    return { reason: `a ${operation} is paused in it`, command: null }
  }
  const files = dirtyFiles(path)
  if ("error" in files) {
    return { reason: files.error, command: null }
  }
  if (files.length > 0) {
    return { reason: `modified or untracked: ${files.join(", ")}`, command: forcedRemoval(path) }
  }
  if (!isCommitLanded(root, baseRef, tree.head)) {
    const at = tree.branch === undefined ? `its detached HEAD ${tree.head.slice(0, 9)}` : `its HEAD on ${tree.branch}`
    return { reason: `${at} is on no commit of ${baseRef.replace("refs/remotes/", "")} since it forked`, command: null }
  }
  return null
}

/** What keeps a branch whatever its work: the default branch, the base, a protected branch, a worktree's. */
type Footing = {
  head: string | undefined
  baseBranch: string
  protectedBranches: string[]
  held: Map<string, string>
}

/** A branch kept for what it is, never the dev's to decide. */
function standing(reason: string): Omit<Kept, "kind" | "name"> {
  return { reason, command: null, dev: false }
}

/** Why `branch` stays whatever its work, or null when only its work decides. */
function stays(
  branch: string,
  { head, baseBranch, protectedBranches, held }: Footing
): Omit<Kept, "kind" | "name"> | null {
  if (branch === head) {
    return standing("the default branch")
  }
  if (branch === baseBranch) {
    return standing("the base branch")
  }
  if (protectedBranches.includes(branch)) {
    return standing("a protected branch")
  }
  const path = held.get(branch)
  return path === undefined ? null : { reason: `checked out in the worktree at ${path}`, command: null, dev: true }
}

type Judged = { base: string; removed: Planned[]; kept: Kept[] }

/** Fetches origin, then sorts each linked worktree and local branch into what goes and what stays. */
function judge(root: string): Judged {
  fetchOrigin(root)
  const head = originHead(root)
  const base = baseOf(root, head)
  const baseName = `origin/${base.name}`
  const [checkout, ...linked] = worktreesOf(root)
  if (checkout === undefined) {
    throw new CannotRun("git lists no worktree", "check the repository with git worktree list")
  }
  const verdicts = linked.map((tree) => ({ tree, why: whyTreeStays(root, base.ref, tree) }))
  const staying = verdicts.filter(({ why }) => why !== null).map(({ tree }) => tree)
  const held = new Map<string, string>()
  for (const { path, branch } of [checkout, ...staying]) {
    if (branch !== undefined) {
      held.set(branch, path)
    }
  }
  const footing: Footing = {
    head,
    baseBranch: base.name,
    protectedBranches: resolveConfig(root).config.guardrails.protectedBranches,
    held
  }
  const removed: Planned[] = []
  const kept: Kept[] = []
  const judged = new Set<string>()
  const judgeBranch = (name: string): void => {
    if (judged.has(name)) {
      return
    }
    judged.add(name)
    const why = stays(name, footing)
    if (why !== null) {
      kept.push({ kind: "branch", name, ...why })
    } else if (isLanded(root, base.ref, name)) {
      removed.push({ kind: "branch", name, reason: `Landed on ${baseName}` })
    } else {
      const reason = `its work is on no commit of ${baseName} since it forked`
      kept.push({ kind: "branch", name, reason, command: forcedDelete(name), dev: true })
    }
  }
  for (const { tree, why } of verdicts) {
    if (why !== null) {
      kept.push({ kind: "worktree", name: tree.path, ...why, dev: true })
      continue
    }
    const reason = `clean, its HEAD is Landed on ${baseName}`
    removed.push(
      tree.branch === undefined
        ? { kind: "worktree", name: tree.path, reason }
        : { kind: "worktree", name: tree.path, reason, holds: tree.branch }
    )
    if (tree.branch !== undefined) {
      judgeBranch(tree.branch)
    }
  }
  branchesOf(root).forEach(judgeBranch)
  return { base: baseName, removed, kept }
}

/** Removes each item judged to go; one that git refuses stays, with git's words, and so does the branch it holds. */
function apply({ base, removed, kept }: Judged, root: string): Judged {
  const gone: Planned[] = []
  const refused: Kept[] = []
  const heldBy = new Map<string, string>()
  for (const item of removed) {
    if (item.kind === "worktree") {
      const result = git(root, ["worktree", "remove", "--", item.name])
      if ("error" in result) {
        refused.push({
          kind: "worktree",
          name: item.name,
          reason: result.error,
          command: forcedRemoval(item.name),
          dev: true
        })
        if (item.holds !== undefined) {
          heldBy.set(item.holds, item.name)
        }
      } else {
        gone.push(item)
      }
      continue
    }
    const path = heldBy.get(item.name)
    const result = path === undefined ? git(root, ["branch", "-D", "--", item.name]) : undefined
    if (path !== undefined) {
      refused.push({ ...item, reason: `checked out in the worktree at ${path}`, command: null, dev: true })
    } else if (result !== undefined && "error" in result) {
      refused.push({ ...item, reason: result.error, command: forcedDelete(item.name), dev: true })
    } else {
      gone.push(item)
    }
  }
  return { base, removed: gone, kept: [...kept, ...refused] }
}

function linesOf({ dryRun, removed, kept }: Sweep): string {
  const out = [
    ...removed.map(({ kind, name, reason }) => `${dryRun ? "would remove" : "removed"} ${kind} ${name} — ${reason}`),
    ...kept.map(({ kind, name, reason, command }) => {
      return `kept ${kind} ${name} — ${reason}${command == null ? "" : `; to remove it yourself: ${command}`}`
    })
  ]
  return out.length === 0 ? "nothing to sweep" : out.join("\n")
}

function parseCli(argv: string[]): { help: boolean; json: boolean; dryRun: boolean } | { error: string } {
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        help: { type: "boolean", short: "h" },
        json: { type: "boolean" },
        "dry-run": { type: "boolean" }
      }
    })
    if (positionals.length > 0 && values.help !== true) {
      return { error: `it takes no argument, not ${JSON.stringify(positionals[0])}` }
    }
    return { help: values.help === true, json: values.json === true, dryRun: values["dry-run"] === true }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

function sweep(json: boolean, dryRun: boolean): number {
  const root = findRepository(process.cwd())
  if (root === undefined) {
    throw new CannotRun(`no git repository holds ${process.cwd()}`, "run it from the main checkout")
  }
  const main = mainCheckout(root)
  if (main !== undefined) {
    throw new CannotRun(
      `${root} is a linked worktree`,
      `run it from the main checkout: ${shellLine(["cd", main])} && dw-sdlc sweep`
    )
  }
  const judged = judge(root)
  const { base, removed, kept } = dryRun ? judged : apply(judged, root)
  const done: Sweep = {
    dryRun,
    base,
    removed: removed.map(({ kind, name, reason }) => ({ kind, name, reason })),
    kept: kept.map(({ kind, name, reason, command }) => ({ kind, name, reason, command }))
  }
  process.stdout.write(`${json ? JSON.stringify(done, null, 2) : linesOf(done)}\n`)
  return kept.some(({ dev }) => dev) ? 1 : 0
}

export function run(argv: string[]): number {
  const cli = parseCli(argv)
  if ("error" in cli) {
    process.stderr.write(`dw-sdlc sweep: ${cli.error}\n\n${USAGE}\n`)
    return 2
  }
  if (cli.help) {
    process.stdout.write(`${USAGE}\n`)
    return 0
  }
  try {
    return sweep(cli.json, cli.dryRun)
  } catch (error) {
    if (error instanceof CannotRun) {
      process.stderr.write(`dw-sdlc sweep: ${error.message} — ${error.remedy}\n`)
      return 2
    }
    throw error
  }
}
