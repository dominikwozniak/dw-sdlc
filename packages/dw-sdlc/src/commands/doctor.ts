// `dw-sdlc doctor`: one PASS / WARN / FAIL line per machine check the sdlc plugin relies on, for the
// repository holding --root and the user's home; it installs nothing. FAIL is a guard that does not guard
// (no jq, plugin absent or disabled, an invalid config), WARN a layer missing, loose or out of step, INFO one that does not apply.

import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { parseArgs } from "node:util"

import { findRepository, resolveConfig } from "../agentic-config.ts"
import {
  checkPackage,
  checkPlugin,
  checkSessions,
  parseJson,
  runningPluginRoot,
  sessionsEnabled,
  versionBefore
} from "../doctor-plugins.ts"
import { isObject } from "../json-text.ts"

export type Level = "PASS" | "WARN" | "FAIL" | "INFO"
export type Check = { name: string; level: Level; detail: string }

/** What the doctor asks the machine; the tests answer from canned data. */
export type Probe = {
  /** A command run directly, from `cwd` when given, with its exit status and stdout. */
  run(command: string, args: string[], cwd?: string): { status: number; stdout: string }
  /** A file's text, or undefined when it is absent. */
  read(path: string): string | undefined
  /** One line of `command -v <tool>` from a non-interactive login shell, the shell the agent gets. */
  shell(script: string): string
}

export type RepositoryConfig = {
  config: { commit: { convention: string } }
  problems: string[]
  /** The checkout each layer was read from, as `resolveConfig` reports it. */
  sources?: { committed: string | undefined; local: string | undefined }
}

export type Inputs = {
  root: string
  home: string
  /** Claude Code's config dir; `<home>/.claude` when absent. */
  claudeDir?: string
  probe: Probe
  /** Undefined when no repository holds `root`. */
  config: RepositoryConfig | undefined
}

/** Claude Code's config dir: `$CLAUDE_CONFIG_DIR` when set, the way Claude Code reads it, else `~/.claude`. */
export function claudeConfigDir(env: Record<string, string | undefined>, home: string): string {
  return env.CLAUDE_CONFIG_DIR ?? join(home, ".claude")
}

/** rtk find passes -exec through verbatim from this release; before it, `rtk find … -exec` exits 1. */
export const RTK_FIND_EXEC_FIXED = "0.46.0"
export const PNPM_MINIMUM_RELEASE_AGE = 10080

export const realProbe: Probe = {
  run(command, args, cwd) {
    const result = spawnSync(command, args, { cwd, encoding: "utf8" })
    return { status: result.status ?? 127, stdout: result.stdout ?? "" }
  },
  read(path) {
    return existsSync(path) ? readFileSync(path, "utf8") : undefined
  },
  shell(script) {
    const shell = process.env.SHELL ?? "/bin/sh"
    const result = spawnSync(shell, ["-l", "-c", script], { encoding: "utf8" })
    return (result.stdout ?? "").trim().split("\n")[0] ?? ""
  }
}

function checkJq(probe: Probe): Check {
  const { status, stdout } = probe.run("jq", ["--version"])
  if (status === 0) {
    return { name: "jq", level: "PASS", detail: stdout.trim() }
  }
  return { name: "jq", level: "FAIL", detail: "missing: every guard is silent without it. brew install jq" }
}

/** Every hook command string in a settings file, whatever the event and matcher. */
function hookCommands(settings: unknown): string[] {
  if (!isObject(settings) || !isObject(settings.hooks)) {
    return []
  }
  const commands: string[] = []
  for (const groups of Object.values(settings.hooks)) {
    if (!Array.isArray(groups)) {
      continue
    }
    for (const group of groups) {
      if (!isObject(group) || !Array.isArray(group.hooks)) {
        continue
      }
      for (const hook of group.hooks) {
        if (isObject(hook) && typeof hook.command === "string") {
          commands.push(hook.command)
        }
      }
    }
  }
  return commands
}

/** rtk's config.toml: Application Support on macOS, XDG or ~/.config elsewhere. */
export function rtkConfigPath(
  home: string,
  platform: string = process.platform,
  env: Record<string, string | undefined> = process.env
): string {
  if (platform === "darwin") {
    return join(home, "Library", "Application Support", "rtk", "config.toml")
  }
  return join(env.XDG_CONFIG_HOME ?? join(home, ".config"), "rtk", "config.toml")
}

/** The `exclude_commands` list of an rtk config.toml, read with a regex: the file is small and ours. */
export function rtkExcludes(toml: string | undefined): string[] {
  const match = /^\s*exclude_commands\s*=\s*\[([^\]]*)\]/m.exec(toml ?? "")
  if (match === null) {
    return []
  }
  return [...(match[1] ?? "").matchAll(/"([^"]*)"/g)].map((entry) => entry[1] ?? "")
}

// The plugin's rtk-rewrite.sh is the one wiring of `rtk hook claude`; a second one in the user
// settings rewrites again, and in a linked worktree that copy is what the isolation check refuses.
function checkRtk(probe: Probe, home: string, claude: string): Check {
  const rtk = probe.shell("command -v rtk")
  if (rtk === "") {
    return { name: "rtk", level: "PASS", detail: "no rtk on this machine, the plugin's rewrite hook stays silent" }
  }
  const settingsPath = join(claude, "settings.json")
  const settings = parseJson(probe.read(settingsPath))
  const byHand = hookCommands(settings).find((command) => /\brtk\b/.test(command))
  const root = runningPluginRoot(probe, claude)
  if (root === undefined || probe.read(join(root, "hooks", "rtk-rewrite.sh")) === undefined) {
    const meanwhile = byHand === undefined ? "nothing rewrites" : `the hand-wired ${byHand} carries it until then`
    return {
      name: "rtk",
      level: "WARN",
      detail: `rtk at ${rtk} but the plugin running here has no hooks/rtk-rewrite.sh: claude plugin update; ${meanwhile}`
    }
  }
  if (byHand !== undefined) {
    return {
      name: "rtk",
      level: "FAIL",
      detail: `${settingsPath} wires rtk by hand (${byHand}), and the plugin's rtk-rewrite.sh already runs it: remove that hook, or every git command in a linked worktree is refused by the isolation check`
    }
  }
  // The filters that misbehave on the installed release have to sit in exclude_commands.
  const version = probe.run("rtk", ["--version"]).stdout.trim().split(/\s+/)[1] ?? "0"
  const excludes = rtkExcludes(probe.read(rtkConfigPath(home)))
  const missing: string[] = []
  if (versionBefore(version, RTK_FIND_EXEC_FIXED) && !excludes.includes("find")) {
    missing.push(`find (rtk ${version} refuses find -exec; fixed in ${RTK_FIND_EXEC_FIXED})`)
  }
  if (missing.length > 0) {
    return {
      name: "rtk",
      level: "WARN",
      detail: `rtk ${version} behind the plugin's rewrite hook, but [hooks] exclude_commands lacks ${missing.join("; ")}`
    }
  }
  return {
    name: "rtk",
    level: "PASS",
    detail: `rtk ${version} behind the plugin's rewrite hook; exclude_commands: ${excludes.join(", ") || "none"}`
  }
}

/**
 * herdr's `hc` in the agent's shell, which a Lead starts its Workers through. Its absence warns only where
 * `sdlc-sessions` is enabled: a machine with only the guards has no reason to install herdr.
 */
function checkHc(probe: Probe): Check {
  const hc = probe.shell("command -v hc")
  if (hc === "") {
    return {
      name: "hc",
      level: sessionsEnabled(probe) ? "WARN" : "INFO",
      detail: "no hc on PATH, so no /sdlc-delegate: install herdr to run Workers"
    }
  }
  return { name: "hc", level: "PASS", detail: `${hc}, so a Lead can start Workers` }
}

function checkSafeChain(probe: Probe): Check {
  const binary = probe.shell("command -v safe-chain")
  if (binary === "") {
    return {
      name: "safe chain",
      level: "WARN",
      detail: "absent: the agent shell reaches the registry without Aikido's blocklist. github.com/AikidoSec/safe-chain"
    }
  }
  const npm = probe.shell("command -v npm")
  // The --ci shims put a wrapper on PATH; the laptop install defines a shell function, which
  // `command -v` reports as the bare name.
  const through = npm === "npm" || npm.includes(".safe-chain")
  if (!through) {
    return {
      name: "safe chain",
      level: "WARN",
      detail: `installed (${binary}) but npm resolves to ${npm}, not through it; the shell function or the --ci shims are not on this shell's PATH`
    }
  }
  return { name: "safe chain", level: "PASS", detail: `${binary}, npm goes through it` }
}

/**
 * pnpm's global `minimumReleaseAge`, asked from the home directory: from a checkout, its own
 * pnpm-workspace.yaml would answer for the machine.
 */
function checkPnpmReleaseAge(probe: Probe, home: string): Check {
  if (probe.shell("command -v pnpm") === "") {
    return { name: "pnpm release age", level: "INFO", detail: "no pnpm in the shell" }
  }
  const { stdout } = probe.run("pnpm", ["config", "get", "minimumReleaseAge"], home)
  const minutes = Number.parseInt(stdout.trim(), 10)
  if (Number.isNaN(minutes) || minutes < PNPM_MINIMUM_RELEASE_AGE) {
    const state = Number.isNaN(minutes) ? "unset" : `${minutes} minutes`
    return {
      name: "pnpm release age",
      level: "WARN",
      detail: `${state} globally: below the ${PNPM_MINIMUM_RELEASE_AGE}-minute baseline. pnpm config set --global minimumReleaseAge ${PNPM_MINIMUM_RELEASE_AGE}`
    }
  }
  return { name: "pnpm release age", level: "PASS", detail: `${minutes} minutes globally` }
}

function checkCommitSigning(probe: Probe): Check {
  const { status, stdout } = probe.run("git", ["config", "--global", "commit.gpgsign"])
  if (status === 0 && stdout.trim() === "true") {
    return { name: "commit signing", level: "PASS", detail: "commit.gpgsign true" }
  }
  return {
    name: "commit signing",
    level: "WARN",
    detail: "commit.gpgsign is off, so commits go out unsigned. git config --global commit.gpgsign true"
  }
}

function checkConfig(config: RepositoryConfig | undefined, root: string): Check {
  if (config === undefined) {
    return { name: "config", level: "INFO", detail: `no repository found at ${root}; run from one or pass --root` }
  }
  if (config.problems.length > 0) {
    return {
      name: "config",
      level: "FAIL",
      detail: `the guards run on the strictest defaults: ${config.problems.join("; ")}`
    }
  }
  // A worktree that lacks a layer reads the main checkout's; say so, since the file is not here.
  const borrowed = Object.entries(config.sources ?? {})
    .filter((entry): entry is [string, string] => entry[1] !== undefined && entry[1] !== root)
    .map(([layer, source]) => `; ${layer} layer from ${source}`)
  return {
    name: "config",
    level: "PASS",
    detail: `commit ${config.config.commit.convention}${borrowed.join("")}`
  }
}

export function diagnose(inputs: Inputs): Check[] {
  const { probe, home } = inputs
  const claude = inputs.claudeDir ?? join(home, ".claude")
  return [
    checkJq(probe),
    checkPlugin(probe, claude),
    checkPackage(probe, claude, inputs.config === undefined ? undefined : inputs.root),
    checkSessions(probe, claude),
    checkHc(probe),
    checkRtk(probe, home, claude),
    checkSafeChain(probe),
    checkPnpmReleaseAge(probe, home),
    checkCommitSigning(probe),
    checkConfig(inputs.config, inputs.root)
  ]
}

export function render(checks: Check[]): string {
  return checks.map((check) => `${check.level.padEnd(5)} ${check.name.padEnd(17)} ${check.detail}`).join("\n")
}

export const summary = "one PASS / WARN / FAIL line per machine check the sdlc plugin relies on"

const USAGE = `Usage: dw-sdlc doctor [--root <dir>] [--home <dir>]
  or:  pnpm guardrails:doctor [--root <dir>] [--home <dir>], in a checkout of dw-sdlc

One PASS / WARN / FAIL line per machine check the sdlc plugin relies on; read-only. Exit 1 when any
check fails. Claude Code's settings are read from $CLAUDE_CONFIG_DIR, or ~/.claude without it; a
--home reads <home>/.claude.`

function repositoryConfig(root: string): RepositoryConfig {
  const resolution = resolveConfig(root)
  return {
    config: resolution.config,
    problems: resolution.problems.map(({ file, path, message }) =>
      path === "" ? `${file}: ${message}` : `${file}: ${path}: ${message}`
    ),
    sources: resolution.sources
  }
}

export function run(argv: string[]): number {
  let values: { help?: boolean; root?: string; home?: string }
  try {
    values = parseArgs({
      args: argv,
      options: { help: { type: "boolean", short: "h" }, root: { type: "string" }, home: { type: "string" } }
    }).values
  } catch (error) {
    console.error(`guardrails:doctor: ${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`)
    return 2
  }
  if (values.help === true) {
    console.log(USAGE)
    return 0
  }
  const dir = values.root ?? process.cwd()
  const root = findRepository(dir)
  const checks = diagnose({
    root: root ?? dir,
    home: values.home ?? homedir(),
    claudeDir: values.home === undefined ? claudeConfigDir(process.env, homedir()) : join(values.home, ".claude"),
    probe: realProbe,
    config: root === undefined ? undefined : repositoryConfig(root)
  })
  console.log(render(checks))
  return checks.some((check) => check.level === "FAIL") ? 1 : 0
}
