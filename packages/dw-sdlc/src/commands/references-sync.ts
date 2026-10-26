// `dw-sdlc references sync`, the Sync: brings every Reference the `references` key of
// .ai/agentic.config.json declares to its ref under references/<dir> — a missing one cloned, an
// existing one moved to a branch's head or to a tag.
// Each clone is shallow and blobless, detached at what was fetched, and sparse when its entry names
// only some paths or skips some. Only the committed config is read. A key the parser refuses syncs
// nothing; an entry that fails to resolve fails alone. One Sync runs in a checkout at a time: a
// second one waits on the lock under references/. When the Router or its table is missing or behind
// the key, one line names the setup to run. A repository that declares no References gets no output
// at all.

import { spawnSync } from "node:child_process"
import { existsSync, linkSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { extname, join } from "node:path"
import { setTimeout as sleep } from "node:timers/promises"
import { parseArgs } from "node:util"

import { readPins, resolveRef, type Pins } from "../pins.ts"
import { CONFIG, readReferences, type Reference } from "../references-key.ts"
import { renderBlock, withBlock } from "../router-block.ts"

const CLONES = "references"
const ROUTER = "references/AGENTS.md"
/** The setup, run through the package's bin, named in a line when the Router needs it: `cli.ts` in
 * the source, `cli.js` in what tsc emits. */
const SETUP = `node "${join(import.meta.dirname, "..", `cli${extname(import.meta.filename)}`)}" references setup`
const LOCK = ".sync.lock"
/** Seconds a Sync waits for another one in the same checkout: inside the session hook's 60 s. */
const WAIT_SECONDS = 30
const POLL_MS = 100

export const summary = "bring every declared Reference to its ref under references/"

const USAGE = `Usage: dw-sdlc references sync [dir...]
  or:  pnpm references:sync [dir...], in a checkout of dw-sdlc

Brings every Reference the references key of ${CONFIG} declares to its ref under ${CLONES}/<dir>, or
only the given dirs: a missing one cloned shallow, an existing one moved to its branch's head or its
tag, holding the top-level files and the paths its only names when it has one, without the paths
its skip names. Prints one line per Reference. Exit 1 when any Reference fails, 2 on a bad key,
config or argument, in which case nothing is synced. One Sync runs in a checkout at a time; a
second one waits for it up to ${WAIT_SECONDS} s, or REFERENCES_SYNC_WAIT seconds.`

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The code a failed system call throws with, as "ENOENT", or undefined. */
function codeOf(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined
}

function fail(message: string): never {
  console.error(`references:sync: ${message}`)
  process.exit(2)
}

/** REFERENCES_SYNC_WAIT when it names a number of seconds, else WAIT_SECONDS. */
function waitSeconds(): number {
  const given = process.env.REFERENCES_SYNC_WAIT?.trim()
  const seconds = given === undefined || given === "" ? Number.NaN : Number(given)
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : WAIT_SECONDS
}

/** Whether `pid` is a running process of this user; a Sync's lock names one, so any other pid is left over. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** The pid of the running Sync that holds the lock at `path`; undefined for no lock, or a left-over one. */
function holderOf(path: string): number | undefined {
  let content: string
  try {
    content = readFileSync(path, "utf8")
  } catch (error) {
    if (codeOf(error) === "ENOENT") {
      return undefined
    }
    throw error
  }
  const pid = Number(content.trim())
  return Number.isInteger(pid) && pid > 0 && alive(pid) ? pid : undefined
}

/** Removes the left-over lock at `path`; one a running Sync took since the last look goes back in place. */
function clear(path: string): void {
  const aside = `${path}.${process.pid}.left`
  try {
    renameSync(path, aside)
  } catch (error) {
    if (codeOf(error) === "ENOENT") {
      return
    }
    throw error
  }
  if (holderOf(aside) === undefined) {
    rmSync(aside, { force: true })
  } else {
    renameSync(aside, path)
  }
}

/** Removes the lock at `path` when this process holds it, and only then. */
function release(path: string): void {
  if (holderOf(path) === process.pid) {
    rmSync(path, { force: true })
  }
}

type Lock = { release: () => void } | { heldBy: number }

/**
 * Takes the lock under references/ for this process, waiting up to `seconds` on a running Sync that
 * holds it, and clearing one left over. Past the wait, the pid still holding it.
 */
async function lock(root: string, seconds: number): Promise<Lock> {
  const dir = join(root, CLONES)
  mkdirSync(dir, { recursive: true })
  const path = join(dir, LOCK)
  // Written whole under this process's own name, then linked into place: no one reads it half-written.
  const own = `${path}.${process.pid}`
  writeFileSync(own, `${process.pid}\n`)
  const deadline = Date.now() + seconds * 1000
  try {
    for (;;) {
      try {
        linkSync(own, path)
        return { release: () => release(path) }
      } catch (error) {
        if (codeOf(error) !== "EEXIST") {
          throw error
        }
      }
      const holder = holderOf(path)
      if (holder === undefined) {
        clear(path)
        continue
      }
      if (Date.now() >= deadline) {
        return { heldBy: holder }
      }
      await sleep(POLL_MS)
    }
  } finally {
    rmSync(own, { force: true })
  }
}

/** The variables that tie git to one repository, as git itself lists them. */
const REPOSITORY_VARS = new Set(
  (spawnSync("git", ["rev-parse", "--local-env-vars"], { encoding: "utf8" }).stdout ?? "").split("\n").filter(Boolean)
)

function git(args: string[], cwd?: string): { ok: boolean; out: string; err: string } {
  // Each call finds its repository from `cwd`: the GIT_DIR a git hook exports would aim it at the
  // hook's repository. A missing credential fails the fetch instead of waiting on a prompt nobody sees.
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !REPOSITORY_VARS.has(name)))
  const result = spawnSync("git", args, { cwd, encoding: "utf8", env: { ...env, GIT_TERMINAL_PROMPT: "0" } })
  // git's error on one line, so each Reference stays one line of the report.
  const err = (result.stderr ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ")
  return { ok: result.status === 0, out: (result.stdout ?? "").trim(), err }
}

/** Runs one git step of a sync, `gitOptions` ahead of it; throws with git's error when it fails. */
function step(args: string[], cwd?: string, gitOptions: string[] = []): void {
  const result = git([...gitOptions, ...args], cwd)
  if (!result.ok) {
    throw new Error(`git ${args.join(" ")}: ${result.err}`)
  }
}

/** A GitHub repository fetches with the GitHub CLI's credentials, so a private one clones too. */
function credentials(repository: string): string[] {
  return repository.startsWith("https://github.com/")
    ? ["-c", "credential.helper=", "-c", "credential.helper=!gh auth git-credential"]
    : []
}

/**
 * The sparse-checkout patterns of a Reference, none for the whole tree. Without `only`, every path;
 * with it, the top-level files and its paths alone. The paths `skip` names are left out of both.
 */
function sparsePatterns({ only, skip }: Reference): string[] {
  if (only.length === 0 && skip.length === 0) {
    return []
  }
  const kept = only.length === 0 ? ["/*"] : ["/*", "!/*/", ...only.map((path) => `/${path}`)]
  return [...kept, ...skip.map((path) => `!/${path}`)]
}

/** Whether the tree fetched into `cwd` holds `path`, a directory when it ends in `/`. Reads trees only. */
function fetchedTreeHas(path: string, cwd: string): boolean {
  const listed = git(["ls-tree", "FETCH_HEAD", "--", path.replace(/\/+$/, "")], cwd)
  if (!listed.ok) {
    throw new Error(`git ls-tree FETCH_HEAD: ${listed.err}`)
  }
  // `<mode> <type> <object>\t<path>`, or nothing when the tree lacks the path.
  const type = listed.out.split(" ")[1]
  return path.endsWith("/") ? type === "tree" : type !== undefined
}

/** Clones or updates one Reference at `ref`, already resolved; the reason it failed, or undefined. */
function sync(root: string, reference: Reference, ref: string): string | undefined {
  const { dir, repository } = reference
  const patterns = sparsePatterns(reference)
  const target = join(root, CLONES, dir)
  // Each step that can fetch carries the credentials: a partial clone's sparse-checkout and checkout
  // fetch the blobs they need.
  const fetching = (args: string[]): void => {
    step(args, target, credentials(repository))
  }
  try {
    if (existsSync(target)) {
      const origin = git(["remote", "get-url", "origin"], target)
      if (!existsSync(join(target, ".git")) || !origin.ok || origin.out !== repository) {
        return `${CLONES}/${dir} exists and is not a clone of ${repository}; move it aside and run again`
      }
    } else {
      // An empty repository, so the one fetch below brings only the ref, a branch or a tag alike.
      step(["init", "--quiet", target])
      step(["remote", "add", "origin", repository], target)
    }
    fetching(["fetch", "--quiet", "--depth", "1", "--filter=blob:none", "origin", ref])
    // Before the sparse checkout moves anything, so a renamed folder leaves the clone as it was.
    const lacking = reference.only.filter((path) => !fetchedTreeHas(path, target))
    if (lacking.length > 0) {
      return `only names ${lacking.join(", ")}, which the tree at ${ref} lacks`
    }
    if (patterns.length > 0) {
      fetching(["sparse-checkout", "set", "--no-cone", ...patterns])
    } else {
      fetching(["sparse-checkout", "disable"])
    }
    // Detached at what was fetched: a local edit the update would overwrite fails the entry instead.
    fetching(["checkout", "--quiet", "--detach", "FETCH_HEAD"])
  } catch (error) {
    return messageOf(error)
  }
  return undefined
}

function parseCli(argv: string[]): { help: boolean; dirs: string[] } {
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: { help: { type: "boolean", short: "h" } }
    })
    return { help: values.help === true, dirs: positionals }
  } catch (error) {
    fail(`${messageOf(error)}\n\n${USAGE}`)
  }
}

/**
 * One line when the Router or its table is missing or behind `references`, naming the setup to run,
 * or when its markers are not a pair, which the setup would refuse.
 */
function routerLine(root: string, references: Reference[]): string | undefined {
  const path = join(root, ROUTER)
  if (!existsSync(path)) {
    return `${ROUTER}  missing  run ${SETUP} from the project to write the Router`
  }
  const current = readFileSync(path, "utf8")
  const next = withBlock(current, renderBlock(references))
  if ("problem" in next) {
    return `${ROUTER}  broken  ${next.problem}`
  }
  if (next.text !== current) {
    return `${ROUTER}  behind the key  run ${SETUP} from the project to rewrite its table`
  }
  return undefined
}

/** `compute`'s value on the first call, from then on the same value. */
function once<T>(compute: () => T): () => T {
  let cached: { value: T } | undefined
  return () => {
    cached ??= { value: compute() }
    return cached.value
  }
}

/** Syncs each of `selected` at its resolved ref and prints its line; whether any failed. */
function syncAll(root: string, selected: Reference[]): boolean {
  const pins = once((): Pins => readPins(root))
  let failed = false
  for (const reference of selected) {
    let ref = reference.ref
    let problem: string | undefined
    try {
      ref = resolveRef(reference.ref, pins)
      problem = sync(root, reference, ref)
    } catch (error) {
      problem = messageOf(error)
    }
    if (problem === undefined) {
      const head = git(["rev-parse", "--short", "HEAD"], join(root, CLONES, reference.dir)).out
      console.log(`${CLONES}/${reference.dir}  ${head}  ${reference.repository} ${ref}`)
    } else {
      failed = true
      console.error(`${CLONES}/${reference.dir}  FAILED  ${problem}`)
    }
  }
  return failed
}

export async function run(argv: string[]): Promise<number> {
  const cli = parseCli(argv)
  if (cli.help) {
    console.log(USAGE)
    return 0
  }

  const toplevel = git(["rev-parse", "--show-toplevel"])
  const root = toplevel.ok ? toplevel.out : process.cwd()
  const reading = readReferences(root)
  if ("problem" in reading) {
    fail(`${reading.problem}; nothing synced`)
  }
  const references = reading.references ?? []

  const unknown = cli.dirs.filter((dir) => !references.some((reference) => reference.dir === dir))
  if (unknown.length > 0) {
    fail(`not in the references of ${CONFIG}: ${unknown.join(", ")}`)
  }
  if (reading.references === undefined) {
    return 0
  }
  const selected =
    cli.dirs.length === 0 ? references : references.filter((reference) => cli.dirs.includes(reference.dir))

  const seconds = waitSeconds()
  const attempt = await lock(root, seconds).catch((error: unknown) =>
    fail(`${CLONES}/${LOCK}: ${messageOf(error)}; nothing synced`)
  )
  let failed = false
  if ("heldBy" in attempt) {
    console.error(
      `references:sync: another Sync (pid ${attempt.heldBy}) still holds ${CLONES}/${LOCK} after ${seconds} s; the clones are what it leaves`
    )
  } else {
    try {
      failed = syncAll(root, selected)
    } finally {
      attempt.release()
    }
  }

  const router = routerLine(root, references)
  if (router !== undefined) {
    console.log(router)
  }

  const listed = new Set(references.map((reference) => reference.dir))
  const stray = existsSync(join(root, CLONES))
    ? readdirSync(join(root, CLONES), { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !listed.has(entry.name))
        .map((entry) => `${CLONES}/${entry.name}`)
    : []
  if (stray.length > 0) {
    console.log(`Not listed in ${CONFIG}, left alone: ${stray.join(", ")}`)
  }
  return failed ? 1 : 0
}
