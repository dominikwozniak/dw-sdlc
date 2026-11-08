// `dw-sdlc sweep`: removes from this machine what finished work leaves behind and holds nothing to lose.
// It deletes each Landed local branch. docs/adr/0015 sets its bounds: the dev's word starts it, it runs from
// the main checkout, it never forces and it never writes to a remote.

import { spawnSync } from "node:child_process"
import { parseArgs } from "node:util"

import { findRepository, mainCheckout, resolveConfig } from "../agentic-config.ts"
import { repositoryFreeEnv } from "../git-env.ts"
import { isLanded } from "../landed.ts"
import { shellLine } from "../pr/decide.ts"
import { CannotRun } from "../pr/read.ts"
import { asked, git } from "../working-tree.ts"

export const summary = "removes each Landed local branch and names what it keeps"

const USAGE = `Usage: dw-sdlc sweep [--dry-run] [--json]

Run from the main checkout. Fetches origin, reads the base branch as the guards do (baseBranch of the
config, else the branch origin/HEAD names) and deletes every local branch that is Landed: its work is on
the base, as a squash merge leaves it. It keeps, and names with the reason:
  the default branch, the base branch, a protected branch and a branch any worktree has checked out;
  a branch whose work is on no commit of the base, with the forced delete as the command to run yourself.
It never forces, and it never changes anything on a remote: the fetch only writes remote-tracking refs.
A delete git refuses is kept with git's words, and the sweep goes on.

--dry-run removes nothing and answers the same items. One line an item, or one document with --json:
  { dryRun, base, removed: [item], kept: [item] }, an item { kind, name, reason, command? }, command the
  one the dev would run for a kept item.

Exit 0 nothing is kept, 1 something is, 2 when it cannot run: in a linked worktree, with no base to read,
or when the fetch fails.`

type Item = { kind: "branch"; name: string; reason: string }
type Kept = Item & { command: string | null }

type Sweep = { dryRun: boolean; base: string; removed: Item[]; kept: Kept[] }

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

/** The local branches, and each worktree's checked-out branch with the worktree's path. */
function branchesOf(root: string): string[] {
  return must(root, ["for-each-ref", "--format=%(refname:lstrip=2)", "refs/heads"])
    .split("\n")
    .filter((name) => name !== "")
}

function checkedOut(root: string): Map<string, string> {
  const held = new Map<string, string>()
  let path = ""
  for (const line of must(root, ["worktree", "list", "--porcelain"]).split("\n")) {
    if (line.startsWith("worktree ")) {
      path = line.slice("worktree ".length)
    } else if (line.startsWith("branch refs/heads/")) {
      held.set(line.slice("branch refs/heads/".length), path)
    }
  }
  return held
}

/** What keeps a branch whatever its work: the default branch, the base, a protected branch, a worktree's. */
type Footing = { head: string | undefined; base: string; protectedBranches: string[]; held: Map<string, string> }

/** Why `branch` stays whatever its work, or null when only its work decides. */
function stays(branch: string, { head, base, protectedBranches, held }: Footing): string | null {
  if (branch === head) {
    return "the default branch"
  }
  if (branch === base) {
    return "the base branch"
  }
  if (protectedBranches.includes(branch)) {
    return "a protected branch"
  }
  const path = held.get(branch)
  return path === undefined ? null : `checked out in the worktree at ${path}`
}

type Judged = Omit<Sweep, "dryRun">

/** Fetches origin, then sorts each local branch into what goes and what stays; nothing is removed yet. */
function judge(root: string): Judged {
  fetchOrigin(root)
  const head = originHead(root)
  const base = baseOf(root, head)
  const baseName = `origin/${base.name}`
  const footing: Footing = {
    head,
    base: base.name,
    protectedBranches: resolveConfig(root).config.guardrails.protectedBranches,
    held: checkedOut(root)
  }
  const removed: Item[] = []
  const kept: Kept[] = []
  for (const name of branchesOf(root)) {
    const reason = stays(name, footing)
    if (reason !== null) {
      kept.push({ kind: "branch", name, reason, command: null })
    } else if (isLanded(root, base.ref, name)) {
      removed.push({ kind: "branch", name, reason: `Landed on ${baseName}` })
    } else {
      const text = `its work is on no commit of ${baseName} since it forked`
      kept.push({ kind: "branch", name, reason: text, command: forcedDelete(name) })
    }
  }
  return { base: baseName, removed, kept }
}

/** Deletes each branch judged Landed; one that git refuses stays, with git's words. */
function apply({ base, removed, kept }: Judged, root: string): Judged {
  const gone: Item[] = []
  const refused: Kept[] = []
  for (const item of removed) {
    const result = git(root, ["branch", "-D", "--", item.name])
    if ("error" in result) {
      refused.push({ ...item, reason: result.error, command: forcedDelete(item.name) })
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
      return `kept ${kind} ${name} — ${reason}${command === null ? "" : `; to remove it yourself: ${command}`}`
    })
  ]
  return out.length === 0 ? "nothing to sweep: no local branch" : out.join("\n")
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
  const done = { dryRun, ...(dryRun ? judged : apply(judged, root)) }
  process.stdout.write(`${json ? JSON.stringify(done, null, 2) : linesOf(done)}\n`)
  return done.kept.length === 0 ? 0 : 1
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
