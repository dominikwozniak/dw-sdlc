// `dw-sdlc setup` sets a repository and this machine up for the sdlc plugin: the files its USAGE names,
// each written only when its content would change, so a run is safe to repeat. Existing content is
// merged, never replaced: other keys stay, and a file that is not a JSON object is refused.

import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, relative } from "node:path"
import { pathToFileURL } from "node:url"
import { parseArgs } from "node:util"

import {
  type AgenticConfig,
  COMMIT_CONVENTIONS,
  COMMITTED_FILE,
  type CommitConvention,
  type CommitOnProtected,
  DEFAULT_GUARDRAILS,
  type ForcePush,
  LOCAL_FILE,
  SCHEMA_FILE,
  STRICTNESS,
  inferConfig,
  repositoryRoot,
  resolveConfig,
  schemaId,
  validateDocument
} from "../agentic-config.ts"
import { isObject, type JsonObject, parseObject, render } from "../json-text.ts"
import { type Change, withGate, withPackage } from "../setup-gate.ts"
import { GLOBAL_DENY, LEASE_RULE, RETIRED_DENY, repositoryDeny } from "../setup-rules.ts"

/** `by hand` is an edit the setup names and leaves to the user. */
export type Outcome = "wrote" | "unchanged" | "refused" | "by hand"
export type Step = { file: string; outcome: Outcome; detail?: string }
export type SetupOptions = {
  root: string
  home: string
  /** Claude Code's config dir, `$CLAUDE_CONFIG_DIR`; `<home>/.claude` when absent. */
  claudeDir?: string | undefined
  force: boolean
  dryRun: boolean
  /** Pins `commit.convention` in the local layer; left out, a pin the layer already holds stays. */
  convention?: CommitConvention | undefined
  /** Pins `guardrails.forcePush` in the local layer; refused where it loosens the committed value. */
  forcePush?: ForcePush | undefined
  /** Pins `guardrails.commitOnProtected` in the local layer; refused where it loosens the committed value. */
  commitOnProtected?: CommitOnProtected | undefined
  /** The owner's yes to pinning dw-sdlc as a devDependency where package.json lacks it. */
  addPackage?: boolean
}

export const summary =
  "adopt the Gate where asked, and write this machine's local config layer, the git excludes and the permission rules"

const USAGE = `Usage: dw-sdlc setup [--root <dir>] [--home <dir>]
       [--convention <preset>] [--force-push deny|ask|lease] [--commit-on-protected deny|allow]
       [--add-package] [--force] [--dry-run]
  or:  pnpm guardrails:setup with the same flags, in a checkout of dw-sdlc

Writes .ai/agentic.config.local.json from inference, excludes it in .git/info/exclude, generates
permissions.deny into .claude/settings.local.json, and adds the lease-push exception and the
irreversible deny set to ~/.claude/settings.json, or $CLAUDE_CONFIG_DIR/settings.json without
--home. From a linked worktree the repository's files go to the main checkout. Every file is
written only when it would change; --convention ticket-key | conventional pins commit.convention in
the local config, and a run without it keeps the pin as it is; a guardrails block in the local config
is kept, and --force-push and --commit-on-protected pin those two keys in it, refused where they would
loosen what the committed config sets; --force overwrites a local config that differs in anything
else; --dry-run reports without writing.

Where the repository has a package.json, the Gate: dw-sdlc pinned there as a devDependency at the
version running the setup, only with --add-package, since a new dependency needs the owner's yes, and
refused without it; with the package there, the gate key in .ai/agentic.config.json when the config
has none, the file created when absent. Both go to the repository holding --root, a linked worktree
included. The agent map is never written. Settings that still enable guardrails@dw-sdlc or
references@dw-sdlc get a "by hand" line with the enabledPlugins edit, left to the user.`

function isConvention(value: string): value is CommitConvention {
  return COMMIT_CONVENTIONS.some((preset) => preset === value)
}

function isForcePush(value: string): value is ForcePush {
  return STRICTNESS.forcePush.some((item) => item === value)
}

function isCommitOnProtected(value: string): value is CommitOnProtected {
  return STRICTNESS.commitOnProtected.some((item) => item === value)
}

/** Where Claude Code registers the plugin: the marketplace name and the plugin's name inside it. */
const MARKETPLACE = "dw-sdlc"
const PLUGIN = "sdlc"
/** The plugin's link to the dw-sdlc package, which carries the schema. */
const PACKAGE_LINK = "dw-sdlc"
/** The two plugins the sdlc plugin replaced, which the marketplace no longer lists (ADR 0010). */
const RETIRED_PLUGINS = ["guardrails", "references"].map((name) => `${name}@${MARKETPLACE}`)

/** A read-only git command, the one thing the setup runs in the repository. */
function git(root: string, args: string[]): string | undefined {
  const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" })
  return result.status === 0 ? result.stdout.trim() : undefined
}

/** The committed layer when it is valid; an absent or invalid one sets nothing, as the resolver drops it. */
function committedConfig(root: string): AgenticConfig {
  const path = join(root, COMMITTED_FILE)
  if (!existsSync(path)) {
    return {}
  }
  const result = validateDocument(COMMITTED_FILE, readFileSync(path, "utf8"))
  return "value" in result ? result.value : {}
}

/**
 * What the machine's layer points `$schema` at: the marketplace clone's schema as a `file://` URL, as an
 * editor cannot fetch the `$id` from a private repository and the clone, unlike the install cache, keeps
 * its path across plugin updates. Without a registered clone holding the schema, the `$id`.
 */
export function schemaReference(claudeDir: string): string {
  const registry = readJson(join(claudeDir, "plugins", "known_marketplaces.json"))
  const entry = isObject(registry) ? registry[MARKETPLACE] : undefined
  const clone = isObject(entry) && typeof entry.installLocation === "string" ? entry.installLocation : undefined
  if (clone === undefined) {
    return schemaId()
  }
  const manifest = readJson(join(clone, ".claude-plugin", "marketplace.json"))
  const plugins = isObject(manifest) && Array.isArray(manifest.plugins) ? manifest.plugins : []
  const plugin = plugins.find((item): item is JsonObject => isObject(item) && item.name === PLUGIN)
  if (plugin === undefined || typeof plugin.source !== "string") {
    return schemaId()
  }
  const schema = join(clone, plugin.source, PACKAGE_LINK, SCHEMA_FILE)
  return existsSync(schema) ? pathToFileURL(schema).href : schemaId()
}

/** The convention a local file pins, when it is one the setup writes: a run without `--convention` keeps it. */
function pinnedConvention(existing: unknown): CommitConvention | undefined {
  const commit = isObject(existing) ? existing.commit : undefined
  const value = isObject(commit) ? commit.convention : undefined
  return typeof value === "string" && isConvention(value) ? value : undefined
}

/**
 * The `guardrails` block a local file holds, carried through on every run, `--force` included: the
 * resolver lets the local layer only tighten, so carrying the block never loosens a guardrail.
 */
function keptGuardrails(existing: unknown): JsonObject | undefined {
  return isObject(existing) && isObject(existing.guardrails) ? existing.guardrails : undefined
}

/** The machine's layer as the setup writes it; `guardrails` is the file's own block, uninterpreted. */
type LocalLayer = Omit<AgenticConfig, "guardrails"> & { guardrails?: JsonObject }

/**
 * A layer without the keys the setup owns: `$schema`, which moves with the clone, a pinned
 * convention, which `--convention` may replace, and a `guardrails` object, which the setup carries
 * and the flags pin keys in. Everything left is someone's content.
 */
function unowned(layer: JsonObject): JsonObject {
  const { $schema: _schema, commit, guardrails, ...other } = layer
  const rest = guardrails === undefined || isObject(guardrails) ? other : { ...other, guardrails }
  if (!isObject(commit) || pinnedConvention(layer) === undefined) {
    return commit === undefined ? rest : { ...rest, commit }
  }
  const { convention: _pinned, ...otherCommit } = commit
  return Object.keys(otherCommit).length === 0 ? rest : { ...rest, commit: otherCommit }
}

/**
 * The guardrails block to write: the one the file holds, with the keys the flags pin. A pin less
 * strict than the committed config's value is a loosening the resolver would drop the whole layer
 * for, so it comes back as a refusal instead.
 */
function pinnedGuardrails(
  kept: JsonObject | undefined,
  committed: AgenticConfig,
  options: SetupOptions
): { guardrails: JsonObject | undefined } | { refusal: string } {
  const base = { ...DEFAULT_GUARDRAILS, ...committed.guardrails }
  const pins: Array<[string, string | undefined, readonly string[], string]> = [
    ["--force-push", options.forcePush, STRICTNESS.forcePush, base.forcePush],
    ["--commit-on-protected", options.commitOnProtected, STRICTNESS.commitOnProtected, base.commitOnProtected]
  ]
  for (const [flag, value, order, current] of pins) {
    if (value !== undefined && order.indexOf(value) > order.indexOf(current)) {
      return {
        refusal: `${flag} ${value} loosens '${current}' from ${COMMITTED_FILE}; the local layer may only tighten it`
      }
    }
  }
  const guardrails: JsonObject = { ...kept }
  if (options.forcePush !== undefined) {
    guardrails.forcePush = options.forcePush
  }
  if (options.commitOnProtected !== undefined) {
    guardrails.commitOnProtected = options.commitOnProtected
  }
  return { guardrails: Object.keys(guardrails).length === 0 ? kept : guardrails }
}

/** The same layer apart from what the setup owns. */
function sameContent(existing: unknown, config: LocalLayer): boolean {
  return isObject(existing) && render(unowned(existing)) === render(unowned(config))
}

/**
 * The machine's layer: what inference finds, minus every key the committed config already sets, which an
 * inferred key here would override, plus the `guardrails` block the file holds and the convention asked for.
 */
function localConfig(
  root: string,
  claudeDir: string,
  convention: CommitConvention | undefined,
  guardrails: JsonObject | undefined
): LocalLayer {
  const inferred = inferConfig(root)
  const committed = committedConfig(root)
  const config: LocalLayer = { $schema: schemaReference(claudeDir) }
  const managers = { ...inferred.packageManagers }
  if (committed.packageManagers?.node !== undefined) {
    delete managers.node
  }
  if (Object.keys(managers).length > 0) {
    config.packageManagers = managers
  }
  if (guardrails !== undefined) {
    config.guardrails = guardrails
  }
  // Only one asked for, by `--convention` or the file's pin: inference always gives `conventional`, and
  // pinning it here would override a convention the repository commits later.
  if (convention !== undefined) {
    config.commit = { convention }
  }
  return config
}

/** `existing` with the entries of `additions` it lacks appended: a list grows and never loses one. */
function union(existing: unknown, additions: string[]): string[] {
  const list = Array.isArray(existing) ? existing.filter((item): item is string => typeof item === "string") : []
  for (const rule of additions) {
    if (!list.includes(rule)) {
      list.push(rule)
    }
  }
  return list
}

function readJson(path: string): JsonObject | undefined | "invalid" {
  return existsSync(path) ? (parseObject(readFileSync(path, "utf8")) ?? "invalid") : undefined
}

class Writer {
  readonly steps: Step[] = []
  private readonly dryRun: boolean
  constructor(dryRun: boolean) {
    this.dryRun = dryRun
  }

  /** Writes when the text differs from what is on disk; records the outcome under `label`, with what the write does. */
  put(label: string, path: string, text: string, detail?: string): void {
    const current = existsSync(path) ? readFileSync(path, "utf8") : undefined
    if (current === text) {
      this.steps.push({ file: label, outcome: "unchanged" })
      return
    }
    if (!this.dryRun) {
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, text)
    }
    this.steps.push(
      detail === undefined ? { file: label, outcome: "wrote" } : { file: label, outcome: "wrote", detail }
    )
  }

  refuse(label: string, detail: string): void {
    this.steps.push({ file: label, outcome: "refused", detail })
  }

  /** The step's file as `change` leaves it: written, unchanged or refused. */
  apply(label: string, path: string, change: Change): void {
    if ("refusal" in change) {
      this.refuse(label, change.refusal)
    } else {
      this.put(label, path, change.text, change.detail)
    }
  }

  byHand(label: string, detail: string): void {
    this.steps.push({ file: label, outcome: "by hand", detail })
  }
}

/** The enabledPlugins edit settings that still enable a retired plugin need; none where they enable neither. */
function enabledPluginsEdit(settings: JsonObject): string | undefined {
  const enabled = isObject(settings.enabledPlugins) ? settings.enabledPlugins : {}
  const retired = RETIRED_PLUGINS.filter((id) => enabled[id] === true)
  if (retired.length === 0) {
    return undefined
  }
  const id = `${PLUGIN}@${MARKETPLACE}`
  const remove = `enabledPlugins: remove ${retired.map((name) => JSON.stringify(name)).join(" and ")}, which the marketplace no longer lists`
  return enabled[id] === true
    ? remove
    : `${remove}, and add "${id}": true after claude plugin install ${id} --scope user`
}

/**
 * Where the repository's files live: the main checkout for a linked worktree, since every worktree reads
 * the local config from there when it has none of its own, and Claude Code reads the local settings there.
 */
function mainCheckout(root: string): { checkout: string; gitDir: string } {
  const common = git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"])
  if (common === undefined) {
    return { checkout: root, gitDir: join(root, ".git") }
  }
  return { checkout: dirname(common), gitDir: common }
}

export function setup(options: SetupOptions): Step[] {
  const writer = new Writer(options.dryRun)
  const root = repositoryRoot(options.root)
  const { checkout, gitDir } = mainCheckout(root)
  const claudeDir = options.claudeDir ?? join(options.home, ".claude")

  // 1. The local config, from inference, the convention (the flag's, else the one the file pins) and
  // the guardrails block the file holds, with the keys the flags pin.
  const localPath = join(checkout, LOCAL_FILE)
  const localCurrent = existsSync(localPath) ? readFileSync(localPath, "utf8") : undefined
  const existing = localCurrent === undefined ? undefined : parseObject(localCurrent)
  const convention = options.convention ?? pinnedConvention(existing)
  const pinned = pinnedGuardrails(keptGuardrails(existing), committedConfig(checkout), options)
  if ("refusal" in pinned) {
    writer.refuse(LOCAL_FILE, pinned.refusal)
  } else {
    const local = localConfig(checkout, claudeDir, convention, pinned.guardrails)
    if (localCurrent !== undefined && !sameContent(existing, local) && !options.force) {
      writer.refuse(LOCAL_FILE, "exists with other content; pass --force to overwrite it")
    } else {
      writer.put(LOCAL_FILE, localPath, render(local))
    }
  }

  // 2. The exclude entries, appended to whatever the file holds: they keep both local files out of git
  // without touching the repository's tracked .gitignore.
  const excludePath = join(gitDir, "info", "exclude")
  const excludeText = existsSync(excludePath) ? readFileSync(excludePath, "utf8") : ""
  const lines = excludeText.split("\n")
  const missing = [LOCAL_FILE, ".claude/settings.local.json"].filter((entry) => !lines.includes(entry))
  const excludeLabel = relative(checkout, excludePath).startsWith("..") ? excludePath : relative(checkout, excludePath)
  if (missing.length === 0) {
    writer.steps.push({ file: excludeLabel, outcome: "unchanged" })
  } else {
    const separator = excludeText === "" || excludeText.endsWith("\n") ? "" : "\n"
    writer.put(excludeLabel, excludePath, excludeText + separator + missing.join("\n") + "\n")
  }

  // 3. The repository's deny rules, the backstop for the hooks where jq is missing, merged into the main
  // checkout's local settings.
  const localSettingsPath = join(checkout, ".claude", "settings.local.json")
  const localSettings = readJson(localSettingsPath)
  if (localSettings === "invalid") {
    writer.refuse(".claude/settings.local.json", "is not a JSON object; fix it by hand first")
  } else {
    const settings = localSettings ?? {}
    const permissions = isObject(settings.permissions) ? settings.permissions : {}
    const deny = union(permissions.deny, repositoryDeny(root)).filter((rule) => !RETIRED_DENY.includes(rule))
    settings.permissions = { ...permissions, deny }
    writer.put(".claude/settings.local.json", localSettingsPath, render(settings))
  }

  // 4. The user file, under $CLAUDE_CONFIG_DIR when it is set: the lease exception, "$defaults" kept, and
  // the irreversible non-git set.
  const userPath = join(claudeDir, "settings.json")
  const userLabel = options.claudeDir === undefined ? "~/.claude/settings.json" : userPath
  const userSettings = readJson(userPath)
  if (userSettings === "invalid") {
    writer.refuse(userLabel, "is not a JSON object; fix it by hand first")
  } else {
    const settings = userSettings ?? {}
    const autoMode = isObject(settings.autoMode) ? settings.autoMode : {}
    // A list the user wrote without "$defaults" replaced the built-ins on purpose; only a new list
    // gets the literal.
    const allow = Array.isArray(autoMode.allow) ? union(autoMode.allow, [LEASE_RULE]) : ["$defaults", LEASE_RULE]
    settings.autoMode = { ...autoMode, allow }
    const permissions = isObject(settings.permissions) ? settings.permissions : {}
    settings.permissions = { ...permissions, deny: union(permissions.deny, GLOBAL_DENY) }
    writer.put(userLabel, userPath, render(settings))
    const edit = enabledPluginsEdit(settings)
    if (edit !== undefined) {
      writer.byHand(userLabel, edit)
    }
  }

  // 5. The Gate, where the repository has a package.json: the pinned package, then the gate key once the
  // package is there. Both are committed, so they go to the repository holding --root, never the main
  // checkout, and stay on the branch the setup runs on.
  const manifestPath = join(root, "package.json")
  if (existsSync(manifestPath)) {
    const manager = resolveConfig(root).config.packageManagers.node ?? "pnpm"
    const pin = withPackage(readFileSync(manifestPath, "utf8"), options.addPackage === true, manager)
    writer.apply("package.json", manifestPath, pin)
    if (!("refusal" in pin)) {
      const configPath = join(root, COMMITTED_FILE)
      writer.apply(
        COMMITTED_FILE,
        configPath,
        withGate(existsSync(configPath) ? readFileSync(configPath, "utf8") : undefined)
      )
    }
  }

  return writer.steps
}

function fail(message: string, code: 1 | 2): never {
  console.error(`guardrails:setup: ${message}`)
  process.exit(code)
}

export function run(argv: string[]): number {
  let values: {
    help?: boolean
    root?: string
    home?: string
    convention?: string
    "force-push"?: string
    "commit-on-protected"?: string
    "add-package"?: boolean
    force?: boolean
    "dry-run"?: boolean
  }
  try {
    values = parseArgs({
      args: argv,
      options: {
        help: { type: "boolean", short: "h" },
        root: { type: "string" },
        home: { type: "string" },
        convention: { type: "string" },
        "force-push": { type: "string" },
        "commit-on-protected": { type: "string" },
        "add-package": { type: "boolean" },
        force: { type: "boolean" },
        "dry-run": { type: "boolean" }
      }
    }).values
  } catch (error) {
    fail(`${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`, 2)
  }
  if (values.help === true) {
    console.log(USAGE)
    return 0
  }
  if (values.convention !== undefined && !isConvention(values.convention)) {
    fail(`--convention must be ${COMMIT_CONVENTIONS.join(" or ")}, not '${values.convention}'\n\n${USAGE}`, 2)
  }
  const forcePush = values["force-push"]
  if (forcePush !== undefined && !isForcePush(forcePush)) {
    fail(`--force-push must be ${STRICTNESS.forcePush.join(", ")}, not '${forcePush}'\n\n${USAGE}`, 2)
  }
  const commitOnProtected = values["commit-on-protected"]
  if (commitOnProtected !== undefined && !isCommitOnProtected(commitOnProtected)) {
    fail(
      `--commit-on-protected must be ${STRICTNESS.commitOnProtected.join(" or ")}, not '${commitOnProtected}'\n\n${USAGE}`,
      2
    )
  }
  const steps = setup({
    root: values.root ?? process.cwd(),
    home: values.home ?? homedir(),
    claudeDir: values.home === undefined ? process.env.CLAUDE_CONFIG_DIR : undefined,
    force: values.force === true,
    dryRun: values["dry-run"] === true,
    convention: values.convention,
    forcePush,
    commitOnProtected,
    addPackage: values["add-package"] === true
  })
  for (const step of steps) {
    const verb = step.outcome === "wrote" && values["dry-run"] === true ? "would write" : step.outcome
    console.log(`${verb.padEnd(11)} ${step.file}${step.detail === undefined ? "" : ` — ${step.detail}`}`)
  }
  return steps.some((step) => step.outcome === "refused") ? 1 : 0
}
