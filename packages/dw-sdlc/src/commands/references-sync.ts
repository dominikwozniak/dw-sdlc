// `dw-sdlc references sync`, the Sync: every Reference `.ai/references.json` declares brought to its ref
// under references/<dir>, each clone shallow, blobless, detached and sparse where its entry says. An
// entry that fails fails alone, and a repository that declares no References gets no output at all.

import { existsSync, linkSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { extname, join } from "node:path"
import { setTimeout as sleep } from "node:timers/promises"

import { CannotRun, messageOf, readArgs } from "../cannot-run.ts"
import { SLOW_LIMIT_MS } from "../exec.ts"
import { asked, git, repositoryRoot } from "../git.ts"
import { readPins, resolveRef, type Pins } from "../pins.ts"
import { REFERENCES_FILE, readReferences, type Reference } from "../references-key.ts"
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

Brings every Reference ${REFERENCES_FILE} declares to its ref under ${CLONES}/<dir>, or
only the given dirs: a missing one cloned shallow, an existing one moved to its branch's head or its
tag, holding the top-level files and the paths its only names when it has one, without the paths
its skip names. Prints one line per Reference. Exit 1 when any Reference fails, 2 on a bad key,
config or argument, in which case nothing is synced. One Sync runs in a checkout at a time; a
second one waits for it up to ${WAIT_SECONDS} s, or REFERENCES_SYNC_WAIT seconds.`

/** The code a failed system call throws with, as "ENOENT", or undefined. */
function codeOf(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined
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

/** Every git call of a Sync: one that fetches may take long, and its error stays one line of the report. */
const SYNC = { limitMs: SLOW_LIMIT_MS, whole: true }

/** Runs one git step of a sync from `dir`, `gitOptions` ahead of it; throws with git's error when it fails. */
function step(args: string[], dir: string, gitOptions: string[] = []): void {
  const result = git(dir, [...gitOptions, ...args], SYNC)
  if ("error" in result) {
    throw new Error(`git ${args.join(" ")}: ${result.said}`)
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

/** Whether the tree fetched into `dir` holds `path`, a directory when it ends in `/`. Reads trees only. */
function fetchedTreeHas(path: string, dir: string): boolean {
  const listed = git(dir, ["ls-tree", "FETCH_HEAD", "--", path.replace(/\/+$/, "")], SYNC)
  if ("error" in listed) {
    throw new Error(`git ls-tree FETCH_HEAD: ${listed.said}`)
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
      const origin = asked(target, ["remote", "get-url", "origin"], SYNC)
      if (!existsSync(join(target, ".git")) || origin !== repository) {
        return `${CLONES}/${dir} exists and is not a clone of ${repository}; move it aside and run again`
      }
    } else {
      // An empty repository, so the one fetch below brings only the ref, a branch or a tag alike.
      step(["init", "--quiet", target], root)
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
  const { values, positionals } = readArgs(
    { args: argv, allowPositionals: true, options: { help: { type: "boolean", short: "h" } } },
    USAGE
  )
  return { help: values.help === true, dirs: positionals }
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
      const head = asked(join(root, CLONES, reference.dir), ["rev-parse", "--short", "HEAD"], SYNC) ?? ""
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

  const root = repositoryRoot(process.cwd())
  const reading = readReferences(root)
  if ("problem" in reading) {
    throw new CannotRun(`${reading.problem}; nothing synced`)
  }
  const references = reading.references ?? []

  const unknown = cli.dirs.filter((dir) => !references.some((reference) => reference.dir === dir))
  if (unknown.length > 0) {
    throw new CannotRun(`not in ${REFERENCES_FILE}: ${unknown.join(", ")}`)
  }
  if (reading.references === undefined) {
    return 0
  }
  const selected =
    cli.dirs.length === 0 ? references : references.filter((reference) => cli.dirs.includes(reference.dir))

  const seconds = waitSeconds()
  const attempt = await lock(root, seconds).catch((error: unknown) => {
    throw new CannotRun(`${CLONES}/${LOCK}: ${messageOf(error)}; nothing synced`)
  })
  let failed = false
  if ("heldBy" in attempt) {
    console.error(
      `dw-sdlc references sync: another Sync (pid ${attempt.heldBy}) still holds ${CLONES}/${LOCK} after ${seconds} s; the clones are what it leaves`
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
    console.log(`Not listed in ${REFERENCES_FILE}, left alone: ${stray.join(", ")}`)
  }
  return failed ? 1 : 0
}
