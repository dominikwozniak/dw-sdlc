// The Sync: brings every Reference the `references` key of .ai/agentic.config.json declares to its ref
// under references/<dir> — a missing one cloned, an existing one moved to a branch's head or to a tag.
// Each clone is shallow and blobless, detached at what was fetched, and sparse when its entry skips
// paths. Only the committed config is read. A key the parser refuses syncs nothing; an entry that
// fails to resolve fails alone. A repository that declares no References gets no output at all.

import { spawnSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { parseArgs } from "node:util"

import { readPins, resolveRef, type Pins } from "./pins.ts"
import { parseReferences, type Reference } from "./references-key.ts"

const CONFIG = ".ai/agentic.config.json"
const DIR = "references"

const USAGE = `Usage: node <plugin root>/scripts/references-sync.ts [dir...]
  or:  pnpm references:sync [dir...], in a checkout of dw-sdlc

Brings every Reference the references key of ${CONFIG} declares to its ref under ${DIR}/<dir>, or
only the given dirs: a missing one cloned shallow, an existing one moved to its branch's head or its
tag, without the paths its skip names. Prints one line per Reference. Exit 1 when any Reference
fails, 2 on a bad key, config or argument, in which case nothing is synced.`

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function fail(message: string): never {
  console.error(`references:sync: ${message}`)
  process.exit(2)
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

/** Runs one git step of a sync, `config` ahead of it; throws with git's error when it fails. */
function step(args: string[], cwd?: string, config: string[] = []): void {
  const result = git([...config, ...args], cwd)
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

/** Clones or updates one Reference at `ref`, already resolved; the reason it failed, or undefined. */
function sync(root: string, reference: Reference, ref: string): string | undefined {
  const { dir, repository, skip } = reference
  const target = join(root, DIR, dir)
  // Each step that can fetch carries the credentials: a partial clone's sparse-checkout and checkout
  // fetch the blobs they need.
  const fetching = (args: string[]): void => {
    step(args, target, credentials(repository))
  }
  try {
    if (existsSync(target)) {
      const origin = git(["remote", "get-url", "origin"], target)
      if (!existsSync(join(target, ".git")) || !origin.ok || origin.out !== repository) {
        return `${DIR}/${dir} exists and is not a clone of ${repository}; move it aside and run again`
      }
    } else {
      // An empty repository, so the one fetch below brings only the ref, a branch or a tag alike.
      step(["init", "--quiet", target])
      step(["remote", "add", "origin", repository], target)
    }
    if (skip.length > 0) {
      fetching(["sparse-checkout", "set", "--no-cone", "/*", ...skip.map((path) => `!/${path}`)])
    } else {
      fetching(["sparse-checkout", "disable"])
    }
    fetching(["fetch", "--quiet", "--depth", "1", "--filter=blob:none", "origin", ref])
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

/** The key the committed config declares, or undefined when the file or the key is absent. */
function readKey(root: string): unknown {
  const path = join(root, CONFIG)
  if (!existsSync(path)) {
    return undefined
  }
  let config: unknown
  try {
    config = JSON.parse(readFileSync(path, "utf8"))
  } catch (error) {
    fail(`${CONFIG}: not JSON: ${messageOf(error)}; nothing synced`)
  }
  if (typeof config !== "object" || config === null || Array.isArray(config)) {
    fail(`${CONFIG}: not a JSON object; nothing synced`)
  }
  return Reflect.get(config, "references")
}

/** `compute`'s value on the first call, from then on the same value. */
function once<T>(compute: () => T): () => T {
  let cached: { value: T } | undefined
  return () => {
    cached ??= { value: compute() }
    return cached.value
  }
}

function main(argv: string[]): void {
  const cli = parseCli(argv)
  if (cli.help) {
    console.log(USAGE)
    return
  }

  const toplevel = git(["rev-parse", "--show-toplevel"])
  const root = toplevel.ok ? toplevel.out : process.cwd()
  const key = readKey(root)
  let references: Reference[] = []
  if (key !== undefined) {
    const parsed = parseReferences(key)
    if ("problem" in parsed) {
      fail(`${CONFIG}: ${parsed.problem.path}: ${parsed.problem.message}; nothing synced`)
    }
    references = parsed.references
  }

  const unknown = cli.dirs.filter((dir) => !references.some((reference) => reference.dir === dir))
  if (unknown.length > 0) {
    fail(`not in the references of ${CONFIG}: ${unknown.join(", ")}`)
  }
  if (key === undefined) {
    return
  }
  const selected =
    cli.dirs.length === 0 ? references : references.filter((reference) => cli.dirs.includes(reference.dir))

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
      const head = git(["rev-parse", "--short", "HEAD"], join(root, DIR, reference.dir)).out
      console.log(`${DIR}/${reference.dir}  ${head}  ${reference.repository} ${ref}`)
    } else {
      failed = true
      console.error(`${DIR}/${reference.dir}  FAILED  ${problem}`)
    }
  }

  const listed = new Set(references.map((reference) => reference.dir))
  const stray = existsSync(join(root, DIR))
    ? readdirSync(join(root, DIR), { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !listed.has(entry.name))
        .map((entry) => `${DIR}/${entry.name}`)
    : []
  if (stray.length > 0) {
    console.log(`Not listed in ${CONFIG}, left alone: ${stray.join(", ")}`)
  }
  if (failed) {
    process.exit(1)
  }
}

if (import.meta.main) {
  main(process.argv.slice(2))
}
