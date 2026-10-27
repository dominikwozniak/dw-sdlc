// What `dw-sdlc setup` changes to adopt the Gate, in files the repository commits: the `dw-sdlc`
// devDependency in package.json, pinned to the version that runs the setup, and the `gate` key of the
// committed config. Each answers with the file's next text, or why the file stays as it is.

import { readFileSync } from "node:fs"
import { join } from "node:path"

import type { NodePackageManager } from "./agentic-config.ts"
import { CHECK_NAMES } from "./checks/index.ts"
import { appendKey, isObject, type JsonObject, parseObject, render } from "./json-text.ts"

const PACKAGE = "dw-sdlc"

/** A file's text after the setup and what writing it does, or why the setup leaves the file alone. */
export type Change = { text: string; detail?: string } | { refusal: string }

/**
 * The Checks a new `gate` key turns on: each judges a tree as it is, the agent map aside, which the
 * setup never writes and the first Gate names. The rest read an input a repository adds first, a
 * catalogue, a records directory, docs a glob matches or a Ratchet's baseline, so they start `false`.
 */
const ON_BY_DEFAULT = new Set(["agents-map", "markdown-refs", "temporal-language", "comment-budget"])

/** Where a committed config the setup creates points `$schema`: the schema the pinned package installs. */
const SCHEMA = `../node_modules/${PACKAGE}/config/agentic.config.schema.json`

const NOT_AN_OBJECT = "is not a JSON object; fix it by hand first"

/** This package's version, the one a pin names, so the plugin and the repository run the same code. */
function packageVersion(): string {
  const manifest = parseObject(readFileSync(join(import.meta.dirname, "..", "package.json"), "utf8"))
  if (typeof manifest?.version !== "string") {
    throw new Error(`${PACKAGE}'s package.json names no version`)
  }
  return manifest.version
}

/** `a`, `a and b`, `a, b and c`. */
function list(items: string[]): string {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`
}

/** Whether either dependency list names the package, at any spec: a pin is the doctor's to judge. */
function dependsOn(manifest: JsonObject): boolean {
  return ["dependencies", "devDependencies"].some((key) => {
    const section = manifest[key]
    return isObject(section) && Object.hasOwn(section, PACKAGE)
  })
}

/**
 * package.json with the package pinned exactly as a devDependency, in name order, where neither list
 * names it. A new dependency needs the owner's yes, so without `add` the file is refused.
 */
export function withPackage(current: string, add: boolean, manager: NodePackageManager): Change {
  const manifest = parseObject(current)
  if (manifest === undefined) {
    return { refusal: NOT_AN_OBJECT }
  }
  if (dependsOn(manifest)) {
    return { text: current }
  }
  const version = packageVersion()
  if (!add) {
    return {
      refusal: `no ${PACKAGE} devDependency, and a new one needs your yes: --add-package pins ${PACKAGE} ${version}`
    }
  }
  const { devDependencies = {} } = manifest
  if (!isObject(devDependencies)) {
    return { refusal: "devDependencies is not an object; fix it by hand first" }
  }
  const entries = Object.entries(devDependencies)
  const at = entries.findIndex(([name]) => name > PACKAGE)
  entries.splice(at === -1 ? entries.length : at, 0, [PACKAGE, version])
  // A manifest is JSON.stringify's layout, as package managers write it, at the indent the file opens with.
  const indent = /^\{\r?\n([ \t]+)"/.exec(current)?.[1] ?? "  "
  const next = { ...manifest, devDependencies: Object.fromEntries(entries) }
  return {
    text: JSON.stringify(next, null, indent) + (current.endsWith("\n") ? "\n" : ""),
    detail: `pins ${PACKAGE} ${version} as a devDependency; ${manager} install brings it in`
  }
}

/** The committed config with the `gate` key when it has none, the file created when absent; a key it has stays. */
export function withGate(current: string | undefined): Change {
  const gate = { checks: Object.fromEntries(CHECK_NAMES.map((name) => [name, ON_BY_DEFAULT.has(name)])) }
  const detail = `the gate key, ${list(CHECK_NAMES.filter((name) => ON_BY_DEFAULT.has(name)))} on and the other Checks off`
  if (current === undefined) {
    return { text: render({ $schema: SCHEMA, version: 1, gate }), detail }
  }
  const config = parseObject(current)
  if (config === undefined) {
    return { refusal: NOT_AN_OBJECT }
  }
  return Object.hasOwn(config, "gate") ? { text: current } : { text: appendKey(current, "gate", gate), detail }
}
