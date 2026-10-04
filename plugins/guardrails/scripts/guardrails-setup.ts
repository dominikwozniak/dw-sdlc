// Sets a repository and this machine up for the guardrails plugin. Four files, each written only when
// its content would change, so a repeat with nothing changed is silent and a run is safe to repeat:
//
//   .ai/agentic.config.local.json   the machine's layer, from inference: the Node package manager when
//                                   the committed config leaves it unset, and $schema at the
//                                   marketplace clone's schema. Refused when one exists with other
//                                   content than $schema, unless --force.
//   .git/info/exclude               keeps that file and .claude/settings.local.json out of git without
//                                   touching the repository's tracked .gitignore
//   .claude/settings.local.json     permissions.deny as the jq-less backstop for the hooks: the
//                                   destructive git set in plain and rtk form, and Read/Edit rules for
//                                   every env file the resolved guardrails.envFiles refuses: listed in
//                                   deny, or ignored by git and not listed in allow
//   ~/.claude/settings.json         autoMode.allow plus the lease-push exception ("$defaults" opens a
//                                   list this run creates), and permissions.deny with the irreversible set
//
// Existing content is merged, never replaced: lists grow by the entries they lack, other keys stay. A
// settings file that is not JSON is refused, not rewritten. In a linked worktree the local config goes
// to the worktree (that is the checkout that resolves it) and the other two to the main checkout, where
// Claude Code reads them. The only thing run in the repository is read-only git.

import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, relative } from "node:path"
import { pathToFileURL } from "node:url"
import { parseArgs } from "node:util"

import {
  type AgenticConfig,
  COMMITTED_FILE,
  DEFAULT_GUARDRAILS,
  type EnvFiles,
  LOCAL_FILE,
  SCHEMA_PATH,
  inferConfig,
  matchesEnvGlob,
  repositoryRoot,
  resolveConfig,
  schemaId,
  validateDocument
} from "./agentic-config.ts"

export type Outcome = "wrote" | "unchanged" | "refused"
export type Step = { file: string; outcome: Outcome; detail?: string }
export type SetupOptions = { root: string; home: string; force: boolean; dryRun: boolean }

const USAGE = `Usage: pnpm guardrails:setup [--root <dir>] [--home <dir>] [--force] [--dry-run]

Writes .ai/agentic.config.local.json from inference, excludes it in .git/info/exclude, generates
permissions.deny into .claude/settings.local.json, and adds the lease-push exception and the
irreversible deny set to ~/.claude/settings.json. Every file is written only when it would change;
--force overwrites a local config that differs; --dry-run reports without writing.`

/** The auto-mode exception that lets a lease push through the classifier's default force-push block. */
export const LEASE_RULE =
  "Force push with --force-with-lease or --force-if-includes to a branch that is not master, main or production: allowed. The guardrails plugin's hook refuses a bare --force, -f or +refspec and any force to a protected branch, so the lease form is the safe one and needs no prompt."

/** The irreversible set for the user file; rtk rewrites git only, so only git stash clear gets both forms. */
export const GLOBAL_DENY = [
  "Bash(rm -rf /)",
  "Bash(rm -rf /*)",
  "Bash(rm -rf ~)",
  "Bash(rm -rf ~/)",
  "Bash(rm -rf $HOME)",
  "Bash(rm -rf .)",
  "Bash(rm -rf ..)",
  "Bash(shred *)",
  "Bash(find * -delete)",
  "Bash(git stash clear)",
  "Bash(rtk git stash clear)"
]

// Exact or end-anchored spellings only. A prefix rule such as `git push --force *` would also match
// `git push --force-with-lease`, the one form the plugin lets through; the hooks cover the rest.
const GIT_DENY = [
  "git push --force",
  "git push -f",
  "git push * --force",
  "git push * -f",
  "git push --delete *",
  "git push * --delete *",
  "git reset --hard",
  "git reset --hard *",
  "git clean -fd",
  "git clean -fd *",
  "git clean -fdx",
  "git clean -xdf",
  "git clean -df",
  "git clean -f -d",
  "git clean --force",
  "git checkout .",
  "git checkout -- .",
  "git restore .",
  "git restore -- .",
  "git branch -f *",
  "git branch --force *",
  "git stash clear"
]

/** Where Claude Code registers the plugin: the marketplace name and the plugin's name inside it. */
const MARKETPLACE = "dw-sdlc"
const PLUGIN = "guardrails"
const PLUGIN_ROOT = join(import.meta.dirname, "..")

const ENV_NAME = /^\.env(\..+)?$|^\.envrc$/

type JsonObject = Record<string, unknown>

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function git(root: string, args: string[]): string | undefined {
  const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" })
  return result.status === 0 ? result.stdout.trim() : undefined
}

function listedIn(globs: string[], file: string): boolean {
  return globs.some((glob) => matchesEnvGlob(glob, file))
}

function isEnvName(file: string): boolean {
  return ENV_NAME.test(file.slice(file.lastIndexOf("/") + 1))
}

function gitFiles(root: string, ...flags: string[]): string[] {
  const listed = git(root, ["-c", "core.quotePath=false", "ls-files", ...flags, "--exclude-standard"]) ?? ""
  return listed.split("\n").filter((file) => file !== "")
}

/**
 * The env files the guard refuses in this repository, relative to its root: the verdict
 * `hooks/block-env-access.sh` gives under `envFiles`, one predicate per file git knows — tracked,
 * untracked or ignored. The tracked, allowed ones stay readable.
 */
export function refusedEnvFiles(root: string, envFiles: EnvFiles): string[] {
  const tracked = new Set(gitFiles(root, "-c"))
  const known = new Set([...tracked, ...gitFiles(root, "-o"), ...gitFiles(root, "-o", "-i")])
  const refused = (file: string): boolean =>
    listedIn(envFiles.deny, file) ||
    (!listedIn(envFiles.allow, file) && (envFiles.policy === "deny" || !tracked.has(file)))
  return [...known].filter(isEnvName).filter(refused).toSorted()
}

/**
 * The permissions.deny a repository gets: the git set twice, then Read and Edit per refused env file.
 * A rule written here stays until someone removes it, so while a config layer is invalid the env
 * rules come from the defaults, not from the strictest set the guards run on meanwhile.
 */
export function repositoryDeny(root: string): string[] {
  const rules = GIT_DENY.flatMap((command) => [`Bash(${command})`, `Bash(rtk ${command})`])
  const resolved = resolveConfig(root)
  const envFiles = resolved.problems.length === 0 ? resolved.config.guardrails.envFiles : DEFAULT_GUARDRAILS.envFiles
  for (const file of refusedEnvFiles(root, envFiles)) {
    rules.push(`Read(./${file})`, `Edit(./${file})`)
  }
  return rules
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
 * What the machine's layer points `$schema` at: the schema in the marketplace's clone as a `file://`
 * URL, since the `$id` sits in a private repository an editor cannot fetch. The clone keeps its path
 * across plugin updates, where the install cache moves with every version. No registered clone
 * holding the schema falls back to the `$id`.
 */
export function schemaReference(home: string): string {
  const registry = readJson(join(home, ".claude", "plugins", "known_marketplaces.json"))
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
  const schema = join(clone, plugin.source, relative(PLUGIN_ROOT, SCHEMA_PATH))
  return existsSync(schema) ? pathToFileURL(schema).href : schemaId()
}

/** The same layer apart from `$schema`: the annotation moves with the clone and is no one's content. */
function sameContent(text: string, config: AgenticConfig): boolean {
  const parsed = readJsonText(text)
  if (!isObject(parsed)) {
    return false
  }
  const { $schema: _existing, ...rest } = parsed
  const { $schema: _written, ...wanted } = config
  return render(rest) === render(wanted)
}

/**
 * The machine's layer: what inference finds, minus every key the committed config already sets. The
 * local layer outranks the committed one, so an inferred key written here would override it. The
 * commit convention is never written: inference always gives the `conventional` default, and pinning it
 * here would override a convention the repository commits later.
 */
function localConfig(root: string, home: string): AgenticConfig {
  const inferred = inferConfig(root)
  const committed = committedConfig(root)
  const config: AgenticConfig = { $schema: schemaReference(home) }
  const managers = { ...inferred.packageManagers }
  if (committed.packageManagers?.node !== undefined) {
    delete managers.node
  }
  if (Object.keys(managers).length > 0) {
    config.packageManagers = managers
  }
  return config
}

function union(existing: unknown, additions: string[]): string[] {
  const list = Array.isArray(existing) ? existing.filter((item): item is string => typeof item === "string") : []
  for (const rule of additions) {
    if (!list.includes(rule)) {
      list.push(rule)
    }
  }
  return list
}

function readJsonText(text: string): unknown {
  try {
    const parsed: unknown = JSON.parse(text)
    return parsed
  } catch {
    return undefined
  }
}

function readJson(path: string): JsonObject | undefined | "invalid" {
  if (!existsSync(path)) {
    return undefined
  }
  const parsed = readJsonText(readFileSync(path, "utf8"))
  return isObject(parsed) ? parsed : "invalid"
}

function render(value: unknown): string {
  return JSON.stringify(value, null, 2) + "\n"
}

class Writer {
  readonly steps: Step[] = []
  private readonly dryRun: boolean
  constructor(dryRun: boolean) {
    this.dryRun = dryRun
  }

  /** Writes when the text differs from what is on disk; records the outcome under `label`. */
  put(label: string, path: string, text: string): void {
    const current = existsSync(path) ? readFileSync(path, "utf8") : undefined
    if (current === text) {
      this.steps.push({ file: label, outcome: "unchanged" })
      return
    }
    if (!this.dryRun) {
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, text)
    }
    this.steps.push({ file: label, outcome: "wrote" })
  }

  refuse(label: string, detail: string): void {
    this.steps.push({ file: label, outcome: "refused", detail })
  }
}

/** Where the exclude file and the local settings live: the main checkout for a linked worktree. */
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

  // 1. The local config, from inference.
  const localPath = join(root, LOCAL_FILE)
  const local = localConfig(root, options.home)
  const localText = render(local)
  const localCurrent = existsSync(localPath) ? readFileSync(localPath, "utf8") : undefined
  if (localCurrent !== undefined && !sameContent(localCurrent, local) && !options.force) {
    writer.refuse(LOCAL_FILE, "exists with other content; pass --force to overwrite it")
  } else {
    writer.put(LOCAL_FILE, localPath, localText)
  }

  // 2. The exclude entries, appended to whatever the file holds.
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

  // 3. The repository's deny rules, merged into the main checkout's local settings.
  const localSettingsPath = join(checkout, ".claude", "settings.local.json")
  const localSettings = readJson(localSettingsPath)
  if (localSettings === "invalid") {
    writer.refuse(".claude/settings.local.json", "is not a JSON object; fix it by hand first")
  } else {
    const settings = localSettings ?? {}
    const permissions = isObject(settings.permissions) ? settings.permissions : {}
    settings.permissions = { ...permissions, deny: union(permissions.deny, repositoryDeny(root)) }
    writer.put(".claude/settings.local.json", localSettingsPath, render(settings))
  }

  // 4. The user file: the lease exception, "$defaults" kept, and the irreversible non-git set.
  const userPath = join(options.home, ".claude", "settings.json")
  const userSettings = readJson(userPath)
  if (userSettings === "invalid") {
    writer.refuse("~/.claude/settings.json", "is not a JSON object; fix it by hand first")
  } else {
    const settings = userSettings ?? {}
    const autoMode = isObject(settings.autoMode) ? settings.autoMode : {}
    // A list the user wrote without "$defaults" replaced the built-ins on purpose; only a new list
    // gets the literal.
    const allow = Array.isArray(autoMode.allow) ? union(autoMode.allow, [LEASE_RULE]) : ["$defaults", LEASE_RULE]
    settings.autoMode = { ...autoMode, allow }
    const permissions = isObject(settings.permissions) ? settings.permissions : {}
    settings.permissions = { ...permissions, deny: union(permissions.deny, GLOBAL_DENY) }
    writer.put("~/.claude/settings.json", userPath, render(settings))
  }

  return writer.steps
}

function fail(message: string, code: 1 | 2): never {
  console.error(`guardrails:setup: ${message}`)
  process.exit(code)
}

function main(argv: string[]): void {
  let values: { help?: boolean; root?: string; home?: string; force?: boolean; "dry-run"?: boolean }
  try {
    values = parseArgs({
      args: argv,
      options: {
        help: { type: "boolean", short: "h" },
        root: { type: "string" },
        home: { type: "string" },
        force: { type: "boolean" },
        "dry-run": { type: "boolean" }
      }
    }).values
  } catch (error) {
    fail(`${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`, 2)
  }
  if (values.help === true) {
    console.log(USAGE)
    return
  }
  const steps = setup({
    root: values.root ?? process.cwd(),
    home: values.home ?? homedir(),
    force: values.force === true,
    dryRun: values["dry-run"] === true
  })
  for (const step of steps) {
    const verb = step.outcome === "wrote" && values["dry-run"] === true ? "would write" : step.outcome
    console.log(`${verb.padEnd(11)} ${step.file}${step.detail === undefined ? "" : ` — ${step.detail}`}`)
  }
  if (steps.some((step) => step.outcome === "refused")) {
    process.exit(1)
  }
}

if (import.meta.main) {
  main(process.argv.slice(2))
}
