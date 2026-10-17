// Reads what a repository declares for an agent: `.ai/agentic.config.json` (committed), then
// `.ai/agentic.config.local.json` (one machine) over it, then what the repository itself implies. The
// local file may tighten `guardrails` and never loosen it; any invalid layer is dropped whole and the
// guards fall back to the strictest defaults until it is fixed. `hooks/config.jq` is the same merge for
// the guards; this file and its tests are the reference, and the tests run both.

import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { parseArgs } from "node:util"

import { validate } from "./json-schema.ts"

export const COMMITTED_FILE = ".ai/agentic.config.json"
export const LOCAL_FILE = ".ai/agentic.config.local.json"
export const SCHEMA_PATH = join(import.meta.dirname, "..", "config", "agentic.config.schema.json")

const USAGE = `Usage: pnpm agentic:check [--root <dir>] [file]

Without a file: resolves the agentic config of the repository holding --root (default: the current
directory) — local over committed over inferred — and prints what the guards see. With a file:
validates that one document against the schema. Exit 1 on any problem.`

export const COMMIT_CONVENTIONS = ["ticket-key", "conventional"] as const
export type CommitConvention = (typeof COMMIT_CONVENTIONS)[number]
export type NodePackageManager = "pnpm" | "npm" | "yarn" | "bun"
export type ForcePush = "deny" | "ask" | "lease"
export type EnvPolicy = "deny" | "git"
/** Which env files may be read: `deny` list, then `allow` list, then `policy` for the rest. */
export type EnvFiles = { policy: EnvPolicy; allow: string[]; deny: string[] }

export type Guardrails = { forcePush: ForcePush; envFiles: EnvFiles; protectedBranches: string[] }
/** `guardrails` as one layer writes it: every key optional, `envFiles` key by key. */
export type GuardrailsLayer = Partial<Omit<Guardrails, "envFiles">> & { envFiles?: Partial<EnvFiles> }

/** One layer as written in a file: every key optional, unknown top-level keys tolerated. */
export type AgenticConfig = {
  $schema?: string
  version?: 1
  baseBranch?: string
  packageManagers?: { node?: NodePackageManager; ruby?: "bundler" }
  guardrails?: GuardrailsLayer
  commit?: { convention?: CommitConvention; pattern?: string; trailer?: string }
  validation?: { commands?: string[] }
  worktree?: { setup?: string[] }
}

/** What the guards see: every layer applied, every key present. */
export type ResolvedConfig = {
  version: 1
  baseBranch: string
  packageManagers: { node?: NodePackageManager; ruby?: "bundler" }
  guardrails: Guardrails
  commit: { convention: CommitConvention; pattern: string; trailer?: string }
  validation: { commands: string[] }
  worktree: { setup: string[] }
}

/** The layers merged, before `commit.pattern` falls back to the preset its convention names. */
type Merged = Omit<ResolvedConfig, "commit"> & {
  commit: { convention: CommitConvention; pattern?: string; trailer?: string }
}

export type Problem = { file: string; path: string; message: string }
export type LayerState = "absent" | "valid" | "invalid"
export type Resolution = {
  config: ResolvedConfig
  problems: Problem[]
  layers: { committed: LayerState; local: LayerState }
  /** The checkout each layer was read from: the root, or the main checkout for a worktree lacking it. */
  sources: { committed: string | undefined; local: string | undefined }
}

/** Strictest value first; the local override may only move towards the front. */
export const STRICTNESS = {
  forcePush: ["deny", "ask", "lease"],
  envFiles: ["deny", "git"]
} as const satisfies { forcePush: readonly ForcePush[]; envFiles: readonly EnvPolicy[] }

/** What the guards run on while any layer is invalid. */
export const STRICTEST_GUARDRAILS: Guardrails = {
  forcePush: "deny",
  envFiles: { policy: "deny", allow: [], deny: [] },
  protectedBranches: ["master", "main", "production"]
}

/** What a repository gets with nothing declared. */
export const DEFAULT_GUARDRAILS: Guardrails = {
  forcePush: "lease",
  envFiles: { policy: "git", allow: ["**/.env.example", "**/.env.sample", "**/.env.template"], deny: [] },
  protectedBranches: ["master", "main", "production"]
}

function cloneGuardrails(source: Guardrails): Guardrails {
  return {
    forcePush: source.forcePush,
    envFiles: { policy: source.envFiles.policy, allow: [...source.envFiles.allow], deny: [...source.envFiles.deny] },
    protectedBranches: [...source.protectedBranches]
  }
}

/**
 * Whether an `envFiles` glob selects the file at `relativePath` (to the repository root, or the
 * basename outside one). `*` and `?` as in a shell pattern, `*` crossing `/`; a leading `**` and a
 * slash mean at any depth. The same rule `hooks/block-env-access.sh` applies with `[[ == ]]`.
 */
export function matchesEnvGlob(glob: string, relativePath: string): boolean {
  const anyDepth = glob.startsWith("**/")
  const pattern = anyDepth ? glob.slice(3) : glob
  const source = pattern
    .split("")
    .map((char) => {
      if (char === "*") {
        return ".*"
      }
      if (char === "?") {
        return "."
      }
      return char.replace(/[.+^${}()|[\]\\]/g, "\\$&")
    })
    .join("")
  return new RegExp(`^${anyDepth ? "(.*/)?" : ""}${source}$`).test(relativePath)
}

// The preset each convention names. `ticket-key` is a ticket key ahead of a short type list;
// `conventional` is Conventional Commits. Both are POSIX ERE, because `grep -E` runs them.
export const COMMIT_PATTERNS: Record<CommitConvention, string> = {
  "ticket-key": "^\\[[A-Z]+-[0-9]+\\] (feat|fix|refactor|docs|chore|test|perf|ci): .+",
  conventional: "^(build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test)(\\([^)]+\\))?!?: .+"
}

const NODE_LOCKFILES: [string, NodePackageManager][] = [
  ["pnpm-lock.yaml", "pnpm"],
  ["package-lock.json", "npm"],
  ["yarn.lock", "yarn"],
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"]
]

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function show(value: unknown): string {
  return JSON.stringify(value)
}

let schema: unknown

function loadSchema(): unknown {
  schema ??= JSON.parse(readFileSync(SCHEMA_PATH, "utf8"))
  return schema
}

/**
 * The schema's public `$id`: what a written config points its `$schema` at. Stable across plugin
 * installs, where `SCHEMA_PATH` moves with every version.
 */
export function schemaId(): string {
  const loaded = loadSchema()
  if (typeof loaded === "object" && loaded !== null && "$id" in loaded && typeof loaded.$id === "string") {
    return loaded.$id
  }
  throw new Error(`${SCHEMA_PATH} declares no string $id`)
}

/** Parses and validates one document; `file` names it in every problem. */
export function validateDocument(file: string, text: string): { value: AgenticConfig } | { problems: Problem[] } {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    return { problems: [{ file, path: "", message: `not JSON: ${messageOf(error)}` }] }
  }
  const problems = validate(loadSchema(), parsed).map(({ path, message }) => ({ file, path, message }))
  if (problems.length > 0) {
    return { problems }
  }
  // The schema is the runtime twin of `AgenticConfig`: a document it accepts has this shape.
  return { value: parsed as AgenticConfig }
}

type Layer = { state: LayerState; value?: AgenticConfig; problems: Problem[]; source?: string }

/** `file` from the first of `checkouts` that has it. */
function readLayer(checkouts: string[], file: string): Layer {
  const source = checkouts.find((checkout) => existsSync(join(checkout, file)))
  if (source === undefined) {
    return { state: "absent", problems: [] }
  }
  const result = validateDocument(file, readFileSync(join(source, file), "utf8"))
  if ("problems" in result) {
    return { state: "invalid", problems: result.problems, source }
  }
  return { state: "valid", value: result.value, problems: [], source }
}

/** The top level of the repository holding `dir`, or `dir` itself outside one. */
export function repositoryRoot(dir: string): string {
  const toplevel = spawnSync("git", ["-C", dir, "rev-parse", "--show-toplevel"], { encoding: "utf8" })
  return toplevel.status === 0 ? toplevel.stdout.trim() : dir
}

/**
 * The main checkout of the linked worktree at `root`, or undefined for a main checkout or outside a
 * repository: a linked worktree's git dir differs from the common one, which sits in the main checkout.
 */
export function mainCheckout(root: string): string | undefined {
  const args = ["-C", root, "rev-parse", "--path-format=absolute", "--git-dir", "--git-common-dir"]
  const result = spawnSync("git", args, { encoding: "utf8" })
  if (result.status !== 0) {
    return undefined
  }
  const [gitDir, commonDir] = result.stdout.trim().split("\n")
  return gitDir === undefined || commonDir === undefined || gitDir === commonDir ? undefined : dirname(commonDir)
}

function inferPackageManagers(root: string): ResolvedConfig["packageManagers"] {
  const managers: ResolvedConfig["packageManagers"] = {}
  const lockfile = NODE_LOCKFILES.find(([file]) => existsSync(join(root, file)))
  if (lockfile !== undefined) {
    managers.node = lockfile[1]
  }
  return managers
}

/**
 * The bottom layer: the package manager the lockfile implies, plus the defaults every key falls back to.
 * `commit.pattern` is left to `resolveConfig`, which fills it from the convention when no layer sets one.
 */
export function inferConfig(root: string): Merged {
  return {
    version: 1,
    baseBranch: "auto",
    packageManagers: inferPackageManagers(root),
    guardrails: cloneGuardrails(DEFAULT_GUARDRAILS),
    commit: { convention: "conventional" },
    validation: { commands: [] },
    worktree: { setup: [] }
  }
}

function applyLayer(base: Merged, layer: AgenticConfig): Merged {
  return {
    version: 1,
    baseBranch: layer.baseBranch ?? base.baseBranch,
    packageManagers: { ...base.packageManagers, ...layer.packageManagers },
    guardrails: {
      ...base.guardrails,
      ...layer.guardrails,
      envFiles: { ...base.guardrails.envFiles, ...layer.guardrails?.envFiles }
    },
    commit: { ...base.commit, ...layer.commit },
    validation: { commands: layer.validation?.commands ?? base.validation.commands },
    worktree: { setup: layer.worktree?.setup ?? base.worktree.setup }
  }
}

function rank(key: keyof typeof STRICTNESS, value: string): number {
  const order: readonly string[] = STRICTNESS[key]
  return order.indexOf(value)
}

const LOOSENS = "the local file may tighten guardrails, never loosen them"

/**
 * Every guardrail the local layer sets less strictly than what it would override: a lower-ranked
 * `forcePush` or `envFiles.policy`, an added `envFiles.allow` entry, a dropped `envFiles.deny` entry,
 * a dropped protected branch.
 */
function loosenings(base: Guardrails, local: GuardrailsLayer | undefined): Problem[] {
  if (local === undefined) {
    return []
  }
  const problems: Problem[] = []
  if (local.forcePush !== undefined && rank("forcePush", local.forcePush) > rank("forcePush", base.forcePush)) {
    const message = `${show(local.forcePush)} loosens ${show(base.forcePush)}; ${LOOSENS}`
    problems.push({ file: LOCAL_FILE, path: "guardrails.forcePush", message })
  }
  const policy = local.envFiles?.policy
  if (policy !== undefined && rank("envFiles", policy) > rank("envFiles", base.envFiles.policy)) {
    const message = `${show(policy)} loosens ${show(base.envFiles.policy)}; ${LOOSENS}`
    problems.push({ file: LOCAL_FILE, path: "guardrails.envFiles.policy", message })
  }
  if (local.envFiles?.allow !== undefined) {
    const known = new Set(base.envFiles.allow)
    const added = local.envFiles.allow.filter((glob) => !known.has(glob))
    if (added.length > 0) {
      const message = `adds ${added.map(show).join(", ")}; the local file may drop allowed env files, never add them`
      problems.push({ file: LOCAL_FILE, path: "guardrails.envFiles.allow", message })
    }
  }
  if (local.envFiles?.deny !== undefined) {
    const kept = new Set(local.envFiles.deny)
    const dropped = base.envFiles.deny.filter((glob) => !kept.has(glob))
    if (dropped.length > 0) {
      const message = `drops ${dropped.map(show).join(", ")}; the local file may add denied env files, never drop them`
      problems.push({ file: LOCAL_FILE, path: "guardrails.envFiles.deny", message })
    }
  }
  if (local.protectedBranches !== undefined) {
    const kept = new Set(local.protectedBranches)
    const dropped = base.protectedBranches.filter((branch) => !kept.has(branch))
    if (dropped.length > 0) {
      const message = `drops ${dropped.map(show).join(", ")}; the local file may add protected branches, never remove them`
      problems.push({ file: LOCAL_FILE, path: "guardrails.protectedBranches", message })
    }
  }
  return problems
}

/** `commit.pattern` from the convention's preset when no layer set one; a set pattern wins. */
function finalize(merged: Merged): ResolvedConfig {
  const pattern = merged.commit.pattern ?? COMMIT_PATTERNS[merged.commit.convention]
  return { ...merged, commit: { ...merged.commit, pattern } }
}

/**
 * Local over committed over inferred, for the repository at `root`. A linked worktree reads a layer it
 * lacks from its main checkout, where a repository that keeps `.ai/` out of git has the only copy.
 */
export function resolveConfig(root: string): Resolution {
  const shared = mainCheckout(root)
  const checkouts = shared === undefined ? [root] : [root, shared]
  const committed = readLayer(checkouts, COMMITTED_FILE)
  const local = readLayer(checkouts, LOCAL_FILE)
  const problems = [...committed.problems, ...local.problems]
  let localState = local.state

  let config = inferConfig(root)
  if (committed.value !== undefined) {
    config = applyLayer(config, committed.value)
  }
  if (local.value !== undefined) {
    const loosened = loosenings(config.guardrails, local.value.guardrails)
    if (loosened.length > 0) {
      problems.push(...loosened)
      localState = "invalid"
    } else {
      config = applyLayer(config, local.value)
    }
  }
  if (problems.length > 0) {
    config = { ...config, guardrails: cloneGuardrails(STRICTEST_GUARDRAILS) }
  }
  return {
    config: finalize(config),
    problems,
    layers: { committed: committed.state, local: localState },
    sources: { committed: committed.source, local: local.source }
  }
}

function fail(message: string, code: 1 | 2): never {
  console.error(`agentic:check: ${message}`)
  process.exit(code)
}

function parseCli(argv: string[]): { help: boolean; root: string | undefined; file: string | undefined } {
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: { help: { type: "boolean", short: "h" }, root: { type: "string" } }
    })
    if (positionals.length > 1) {
      throw new Error("at most one file")
    }
    return { help: values.help === true, root: values.root, file: positionals[0] }
  } catch (error) {
    fail(`${messageOf(error)}\n\n${USAGE}`, 2)
  }
}

function report(problems: Problem[]): void {
  for (const { file, path, message } of problems) {
    console.error(path === "" ? `${file}: ${message}` : `${file}: ${path}: ${message}`)
  }
}

function main(argv: string[]): void {
  const cli = parseCli(argv)
  if (cli.help) {
    console.log(USAGE)
    return
  }

  if (cli.file !== undefined) {
    let text: string
    try {
      text = readFileSync(cli.file, "utf8")
    } catch (error) {
      fail(messageOf(error), 1)
    }
    const result = validateDocument(cli.file, text)
    if ("problems" in result) {
      report(result.problems)
      process.exit(1)
    }
    console.log(`${cli.file}: valid`)
    return
  }

  let root = cli.root
  if (root === undefined) {
    const toplevel = spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" })
    if (toplevel.status !== 0) {
      fail("not inside a git repository; pass --root <dir>", 1)
    }
    root = toplevel.stdout.trim()
  } else {
    root = repositoryRoot(root)
  }

  const { config, problems, layers, sources } = resolveConfig(root)
  const from = (source: string | undefined): string =>
    source === undefined || source === root ? "" : `, from ${source}`
  console.log(`committed  ${COMMITTED_FILE}  ${layers.committed}${from(sources.committed)}`)
  console.log(`local      ${LOCAL_FILE}  ${layers.local}${from(sources.local)}`)
  console.log(JSON.stringify(config, null, 2))
  if (problems.length > 0) {
    report(problems)
    fail(`${problems.length} problem(s) above; the guards run on the strictest defaults until the file is fixed`, 1)
  }
}

if (import.meta.main) {
  main(process.argv.slice(2))
}
