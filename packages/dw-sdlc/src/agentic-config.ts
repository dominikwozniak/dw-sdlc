// Reads what a repository declares for an agent: the committed config, the machine's local layer over it,
// and what the repository implies; an invalid layer is dropped whole. The sdlc plugin's
// `hooks/config.jq` is the same merge for the guards; this file is the reference, and the tests run both.

import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"

import { validate } from "./json-schema.ts"

export const COMMITTED_FILE = ".ai/agentic.config.json"
export const LOCAL_FILE = ".ai/agentic.config.local.json"
/** The schema's path inside this package. */
export const SCHEMA_FILE = "config/agentic.config.schema.json"
export const SCHEMA_PATH = join(import.meta.dirname, "..", SCHEMA_FILE)

export const COMMIT_CONVENTIONS = ["ticket-key", "conventional"] as const
export type CommitConvention = (typeof COMMIT_CONVENTIONS)[number]
export type NodePackageManager = "pnpm" | "npm" | "yarn" | "bun"
export type ForcePush = "deny" | "ask" | "lease"
export type CommitOnProtected = "deny" | "allow"
export type EnvPolicy = "deny" | "git"
/** Which env files may be read: `deny` list, then `allow` list, then `policy` for the rest. */
export type EnvFiles = { policy: EnvPolicy; allow: string[]; deny: string[] }
/** Who merges a pull request the Ship script finds ready: the script under `auto`, the dev under `ask`. */
export type PrMerge = "ask" | "auto"
/**
 * How closely a Review reads an unreviewed head: the command `pr.reviewCommand` names under `full`,
 * one `sdlc-reviewer` subagent under `light`, no one under `off`.
 */
export type ReviewDepth = "full" | "light" | "off"
/** The Review depths, strictest first: what the dev's `--review` names. */
export const REVIEW_DEPTHS = ["full", "light", "off"] as const satisfies readonly ReviewDepth[]
/** `pr.review`: a Review depth, or `auto`, which routes one from the changes by built-in rules. */
export type PrReview = ReviewDepth | "auto"

/**
 * How the Ship script ends a pull request: who merges it, how closely it is reviewed, and the slash
 * command a `full` Review runs.
 */
export type PrConfig = { merge: PrMerge; review: PrReview; reviewCommand: string }

/** Claude Code's effort levels, lowest first: what `worker.effort` takes. */
export const WORKER_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const
export type WorkerEffort = (typeof WORKER_EFFORTS)[number]
/** How a Worker's Claude Code session starts: the words that start it, its model and its effort. */
export type WorkerConfig = { command: string; model: string; effort: WorkerEffort }

export type Guardrails = {
  forcePush: ForcePush
  commitOnProtected: CommitOnProtected
  envFiles: EnvFiles
  protectedBranches: string[]
}
/** `guardrails` as one layer writes it: every key optional, `envFiles` key by key. */
export type GuardrailsLayer = Partial<Omit<Guardrails, "envFiles">> & { envFiles?: Partial<EnvFiles> }

/** A repository's own script under `gate.checks.run`, reported as a Check under `name`. */
export type RunCheck = { name: string; command: string }
/**
 * `run`, and under each other key a Check the package ships, as the schema takes it: `true`, `false` or
 * its options. `src/checks/` reads the setting of each.
 */
export type GateChecks = { run: RunCheck[]; [check: string]: unknown }
/** `gate.drift`: whether a Step may write the tree; `src/drift.ts` reads it. */
export type DriftSetting = "fail" | "allow"
/** The Gate: its command, the steps run in order, whether they may write the tree, the Checks run after them. */
export type Gate = { command?: string; steps: string[]; drift: DriftSetting; checks: GateChecks }
/** `gate` as one layer writes it: every key optional, `checks` Check by Check. */
export type GateLayer = { command?: string; steps?: string[]; drift?: DriftSetting; checks?: Partial<GateChecks> }

/** One layer as written in a file: every key optional, unknown top-level keys tolerated. */
export type AgenticConfig = {
  $schema?: string
  version?: 1
  baseBranch?: string
  packageManagers?: { node?: NodePackageManager; ruby?: "bundler" }
  guardrails?: GuardrailsLayer
  commit?: { convention?: CommitConvention; pattern?: string; trailer?: string }
  gate?: GateLayer
  pr?: Partial<PrConfig>
  worker?: Partial<WorkerConfig>
  worktree?: { setup?: string[] }
}

/** What the guards see: every layer applied, every key present. */
export type ResolvedConfig = {
  version: 1
  baseBranch: string
  packageManagers: { node?: NodePackageManager; ruby?: "bundler" }
  guardrails: Guardrails
  commit: { convention: CommitConvention; pattern: string; trailer?: string }
  gate: Gate
  pr: PrConfig
  worker: WorkerConfig
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
  commitOnProtected: ["deny", "allow"],
  envFiles: ["deny", "git"],
  merge: ["ask", "auto"],
  review: ["full", "auto", "light", "off"]
} as const satisfies {
  forcePush: readonly ForcePush[]
  commitOnProtected: readonly CommitOnProtected[]
  envFiles: readonly EnvPolicy[]
  merge: readonly PrMerge[]
  review: readonly PrReview[]
}

/** What the guards run on while any layer is invalid. */
export const STRICTEST_GUARDRAILS: Guardrails = {
  forcePush: "deny",
  commitOnProtected: "deny",
  envFiles: { policy: "deny", allow: [], deny: [] },
  protectedBranches: ["master", "main", "production"]
}

/** What the Ship script runs on while any layer is invalid, and with nothing declared: it merges nothing itself. */
export const STRICTEST_PR_MERGE: PrMerge = "ask"
/** The Review depth while any layer is invalid: the agent reads every head in full. */
export const STRICTEST_PR_REVIEW: PrReview = "full"
const STRICTEST_PR = { merge: STRICTEST_PR_MERGE, review: STRICTEST_PR_REVIEW } as const satisfies Partial<PrConfig>
/** The command a `full` Review runs with nothing declared; it has no strictness order. */
export const DEFAULT_REVIEW_COMMAND = "/code-review"
/** What a repository gets with nothing declared: the merge the dev's, the depth routed from the changes. */
const DEFAULT_PR: PrConfig = { merge: STRICTEST_PR_MERGE, review: "auto", reviewCommand: DEFAULT_REVIEW_COMMAND }

/** What a Worker starts with when no layer says otherwise; no key has a strictness order. */
export const DEFAULT_WORKER: WorkerConfig = { command: "claude", model: "sonnet", effort: "high" }

/** What a repository gets with nothing declared. */
export const DEFAULT_GUARDRAILS: Guardrails = {
  forcePush: "lease",
  commitOnProtected: "allow",
  envFiles: { policy: "git", allow: ["**/.env.example", "**/.env.sample", "**/.env.template"], deny: [] },
  protectedBranches: ["master", "main", "production"]
}

function cloneGuardrails(source: Guardrails): Guardrails {
  return {
    forcePush: source.forcePush,
    commitOnProtected: source.commitOnProtected,
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
  "ticket-key": "^\\[[A-Z]+-[0-9]+\\] (feat|fix|refactor|docs|chore|test|perf|ci|revert): .+",
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

/** The top level of the repository holding `dir`, or undefined outside one. */
export function findRepository(dir: string): string | undefined {
  const toplevel = spawnSync("git", ["-C", dir, "rev-parse", "--show-toplevel"], { encoding: "utf8" })
  return toplevel.status === 0 ? toplevel.stdout.trim() : undefined
}

/** The top level of the repository holding `dir`, or `dir` itself outside one. */
export function repositoryRoot(dir: string): string {
  return findRepository(dir) ?? dir
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

/** Whether `package.json` at `root` declares a `check` script; a missing or unreadable manifest has none. */
function hasCheckScript(root: string): boolean {
  let manifest: unknown
  try {
    manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
  } catch {
    return false
  }
  if (typeof manifest !== "object" || manifest === null || !("scripts" in manifest)) {
    return false
  }
  const { scripts } = manifest
  return typeof scripts === "object" && scripts !== null && "check" in scripts && typeof scripts.check === "string"
}

/**
 * The Gate with nothing declared: `pnpm check` where the manifest has a `check` script, else no command;
 * no Step, no Check, and the watch for Drift on.
 */
function inferGate(root: string): Gate {
  const gate: Gate = { steps: [], drift: "fail", checks: { run: [] } }
  if (hasCheckScript(root)) {
    gate.command = "pnpm check"
  }
  return gate
}

/**
 * The bottom layer: the package manager the lockfile implies, the Gate command the manifest's `check`
 * script implies, plus the defaults every key falls back to. `commit.pattern` is left to
 * `resolveConfig`, which fills it from the convention when no layer sets one.
 */
export function inferConfig(root: string): Merged {
  return {
    version: 1,
    baseBranch: "auto",
    packageManagers: inferPackageManagers(root),
    guardrails: cloneGuardrails(DEFAULT_GUARDRAILS),
    commit: { convention: "conventional" },
    gate: inferGate(root),
    pr: { ...DEFAULT_PR },
    worker: { ...DEFAULT_WORKER },
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
    gate: { ...base.gate, ...layer.gate, checks: { ...base.gate.checks, ...layer.gate?.checks } },
    pr: { ...base.pr, ...layer.pr },
    worker: { ...base.worker, ...layer.worker },
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
 * `forcePush`, `commitOnProtected` or `envFiles.policy`, an added `envFiles.allow` entry, a dropped
 * `envFiles.deny` entry, a dropped protected branch.
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
  if (
    local.commitOnProtected !== undefined &&
    rank("commitOnProtected", local.commitOnProtected) > rank("commitOnProtected", base.commitOnProtected)
  ) {
    const message = `${show(local.commitOnProtected)} loosens ${show(base.commitOnProtected)}; ${LOOSENS}`
    problems.push({ file: LOCAL_FILE, path: "guardrails.commitOnProtected", message })
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

/** Each local `pr` key less strict than the one it would override: `merge` auto over ask, `review` off over light over auto over full. */
function prLoosenings(base: PrConfig, local: Partial<PrConfig> | undefined): Problem[] {
  const keys = ["merge", "review"] as const
  return keys.flatMap((key) => {
    const value = local?.[key]
    if (value === undefined || rank(key, value) <= rank(key, base[key])) {
      return []
    }
    const message = `${show(value)} loosens ${show(base[key])}; the local file may tighten pr.${key}, never loosen it`
    return [{ file: LOCAL_FILE, path: `pr.${key}`, message }]
  })
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
    const loosened = [
      ...loosenings(config.guardrails, local.value.guardrails),
      ...prLoosenings(config.pr, local.value.pr)
    ]
    if (loosened.length > 0) {
      problems.push(...loosened)
      localState = "invalid"
    } else {
      config = applyLayer(config, local.value)
    }
  }
  if (problems.length > 0) {
    // `reviewCommand` and `worker` have no strictest value: they keep what the valid layers name.
    config = { ...config, guardrails: cloneGuardrails(STRICTEST_GUARDRAILS), pr: { ...config.pr, ...STRICTEST_PR } }
  }
  return {
    config: finalize(config),
    problems,
    layers: { committed: committed.state, local: localState },
    sources: { committed: committed.source, local: local.source }
  }
}
