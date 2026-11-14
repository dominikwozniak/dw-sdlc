// The doctor's lines on the plugins: `sdlc` installed and enabled, the package it links against the one the
// repository pins, and the optional `sdlc-sessions` with its own copy of the package.

import { join } from "node:path"

import type { Check, Probe } from "./commands/doctor.ts"
import { isObject } from "./json-text.ts"
import { EXACT_VERSION, parseCatalog, parsePins } from "./pins.ts"

/** The marketplace Claude Code registers this repository under, the plugin in it, and the package the plugin links to. */
const MARKETPLACE = "dw-sdlc"
const PLUGIN = "sdlc"
const PLUGIN_ID = `${PLUGIN}@${MARKETPLACE}`
/** The plugin of the session helpers: optional, and it links a copy of the package of its own. */
const SESSIONS = "sdlc-sessions"
const SESSIONS_ID = `${SESSIONS}@${MARKETPLACE}`
const PACKAGE = "dw-sdlc"

/** The JSON `text` holds, whatever its kind: `claude plugin list --json` prints an array. */
export function parseJson(text: string | undefined): unknown {
  if (text === undefined) {
    return undefined
  }
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** The checkout a directory marketplace runs the plugin from, or undefined for a snapshot. */
function liveCheckout(probe: Probe, claude: string): string | undefined {
  const known = parseJson(probe.read(join(claude, "plugins", "known_marketplaces.json")))
  const entry = isObject(known) && isObject(known[MARKETPLACE]) ? known[MARKETPLACE] : undefined
  const source = entry !== undefined && isObject(entry.source) ? entry.source : undefined
  return source?.source === "directory" && typeof source.path === "string" ? source.path : undefined
}

function pluginOrigin(probe: Probe, claude: string, installPath: string): string {
  const checkout = liveCheckout(probe, claude)
  if (checkout !== undefined) {
    return `runs live from ${checkout}/plugins/${PLUGIN}; a change there is in the next session`
  }
  return `installed at ${installPath}; a change reaches it through claude plugin update`
}

/** What `claude plugin list --json` prints, one object a plugin, or undefined when it does not answer. */
function listedPlugins(probe: Probe): Record<string, unknown>[] | undefined {
  const { status, stdout } = probe.run("claude", ["plugin", "list", "--json"])
  const list: unknown = status === 0 ? parseJson(stdout) : undefined
  return Array.isArray(list) ? list.filter(isObject) : undefined
}

/** The directory `plugin` runs from on this machine: the checkout of a directory marketplace, else the installed snapshot. */
export function runningPluginRoot(probe: Probe, claude: string, plugin: string = PLUGIN): string | undefined {
  const checkout = liveCheckout(probe, claude)
  if (checkout !== undefined) {
    return join(checkout, "plugins", plugin)
  }
  const entry = listedPlugins(probe)?.find((item) => item.id === `${plugin}@${MARKETPLACE}`)
  return entry !== undefined && typeof entry.installPath === "string" ? entry.installPath : undefined
}

export function checkPlugin(probe: Probe, claude: string): Check {
  const list = listedPlugins(probe)
  if (list === undefined) {
    return { name: "plugin", level: "FAIL", detail: "claude plugin list did not answer; is Claude Code installed?" }
  }
  const entry = list.find((item) => item.id === PLUGIN_ID)
  if (entry === undefined) {
    return {
      name: "plugin",
      level: "FAIL",
      detail: `${PLUGIN_ID} is not installed. claude plugin marketplace add dominikwozniak/dw-sdlc --sparse .claude-plugin plugins packages && claude plugin install ${PLUGIN_ID} --scope user`
    }
  }
  const version = typeof entry.version === "string" ? entry.version : "?"
  const installPath = typeof entry.installPath === "string" ? entry.installPath : "?"
  if (entry.enabled !== true) {
    return {
      name: "plugin",
      level: "FAIL",
      detail: `${version} installed but disabled, so no guard runs. claude plugin enable ${PLUGIN_ID}`
    }
  }
  return {
    name: "plugin",
    level: "PASS",
    detail: `${version} enabled; ${pluginOrigin(probe, claude, installPath)}`
  }
}

/** The `version` of the package.json in `dir`, or undefined when there is none. */
function manifestVersion(probe: Probe, dir: string): string | undefined {
  const manifest = parseJson(probe.read(join(dir, "package.json")))
  return isObject(manifest) && typeof manifest.version === "string" ? manifest.version : undefined
}

/** Whether the plugin's hooks and skills run the dw-sdlc the repository pins, the one its Gate runs. */
export function checkPackage(probe: Probe, claude: string, root: string | undefined): Check {
  const name = "package"
  const manifest = root === undefined ? undefined : probe.read(join(root, "package.json"))
  if (root === undefined || manifest === undefined) {
    return { name, level: "INFO", detail: `no package.json here to pin ${PACKAGE}` }
  }
  let spec: string | undefined
  try {
    spec = parsePins(manifest, parseCatalog(probe.read(join(root, "pnpm-workspace.yaml")) ?? ""))[PACKAGE]
  } catch {
    return { name, level: "INFO", detail: `${join(root, "package.json")} is not JSON` }
  }
  if (spec === undefined) {
    return { name, level: "INFO", detail: `the repository does not pin ${PACKAGE}` }
  }
  // `workspace:` or a range names no one version: the copy installed under node_modules is the one that runs.
  const pinned = EXACT_VERSION.test(spec) ? spec : manifestVersion(probe, join(root, "node_modules", PACKAGE))
  if (pinned === undefined) {
    return { name, level: "WARN", detail: `the repository pins ${PACKAGE} ${spec}, not installed: pnpm install` }
  }
  const plugin = runningPluginRoot(probe, claude)
  if (plugin === undefined) {
    return { name, level: "INFO", detail: `no ${PLUGIN_ID} runs here to compare with the pinned ${pinned}` }
  }
  const linked = manifestVersion(probe, join(plugin, PACKAGE))
  if (linked === undefined) {
    return {
      name,
      level: "WARN",
      detail: `the plugin at ${plugin} carries no ${PACKAGE}: an install from GitHub needs packages in its --sparse set`
    }
  }
  if (linked !== pinned) {
    const remedy = versionBefore(linked, pinned)
      ? `claude plugin update ${PLUGIN_ID}`
      : `pnpm add --save-dev --save-exact ${PACKAGE}@${linked}`
    return {
      name,
      level: "WARN",
      detail: `drift: the plugin runs ${PACKAGE} ${linked} and the repository pins ${pinned}, so its hooks and skills run other code than the Gate. ${remedy}`
    }
  }
  return { name, level: "PASS", detail: `${PACKAGE} ${linked} in the plugin and in the repository` }
}

/** Whether `sdlc-sessions` is installed and enabled here, so `/sdlc-delegate` is one the dev can start. */
export function sessionsEnabled(probe: Probe): boolean {
  return listedPlugins(probe)?.find((item) => item.id === SESSIONS_ID)?.enabled === true
}

/**
 * `sdlc-sessions`, which a machine may go without, so it never fails. Its copy of the package against
 * the sdlc plugin's copy: the `package` line holds that one to the repository's pin.
 */
export function checkSessions(probe: Probe, claude: string): Check {
  const name = "sessions"
  const list = listedPlugins(probe)
  const entry = list?.find((item) => item.id === SESSIONS_ID)
  if (entry === undefined) {
    const detail =
      list === undefined
        ? "claude plugin list did not answer"
        : `no ${SESSIONS_ID}, so no /sdlc-recap, /sdlc-kickoff or /sdlc-delegate. claude plugin install ${SESSIONS_ID} --scope user`
    return { name, level: "INFO", detail }
  }
  const version = typeof entry.version === "string" ? entry.version : "?"
  if (entry.enabled !== true) {
    return { name, level: "WARN", detail: `${version} installed but disabled. claude plugin enable ${SESSIONS_ID}` }
  }
  const root = runningPluginRoot(probe, claude, SESSIONS)
  const copy = root === undefined ? undefined : manifestVersion(probe, join(root, PACKAGE))
  if (copy === undefined) {
    return {
      name,
      level: "WARN",
      detail: `${version} carries no ${PACKAGE}: an install from GitHub needs packages in its --sparse set`
    }
  }
  const guards = runningPluginRoot(probe, claude)
  const other = guards === undefined ? undefined : manifestVersion(probe, join(guards, PACKAGE))
  if (other !== undefined && other !== copy) {
    const behind = versionBefore(copy, other) ? SESSIONS_ID : PLUGIN_ID
    return {
      name,
      level: "WARN",
      detail: `drift: ${SESSIONS} runs ${PACKAGE} ${copy} and ${PLUGIN} runs ${other}. claude plugin update ${behind}`
    }
  }
  return { name, level: "PASS", detail: `${version} enabled, on ${PACKAGE} ${copy}` }
}

export function versionBefore(version: string, threshold: string): boolean {
  const a = version.split(".").map((part) => Number.parseInt(part, 10))
  const b = threshold.split(".").map((part) => Number.parseInt(part, 10))
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    if (x !== y) {
      return x < y
    }
  }
  return false
}
