// The exact version a repository pins for a package, for a ref that names one: the root package.json's
// dependencies and devDependencies, a `catalog:` or `catalog:default` pin read through the default
// catalog in pnpm-workspace.yaml. A ref without `{name}` reads neither file, so a broken manifest
// fails only the References that name a package.

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

/** Versions by package name: what package.json pins, or what a catalog lists. */
export type Pins = Record<string, string>

const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[\w.]+)?$/
/** The two ways a pin names the default catalog: by its name, or by pnpm's shorthand. */
const DEFAULT_CATALOG = new Set(["catalog:", "catalog:default"])

/**
 * The default catalog in pnpm-workspace.yaml's text: each `name: version` line of its top-level
 * `catalog:` block, a comment after the key allowed. Without the block, it is empty.
 */
export function parseCatalog(yaml: string): Pins {
  const lines = yaml.split(/\r?\n/)
  const start = lines.findIndex((line) => /^catalog:\s*(?:#.*)?$/.test(line))
  const catalog: Pins = {}
  if (start === -1) {
    return catalog
  }
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === "" || line.trim().startsWith("#")) {
      continue
    }
    const entry = /^\s+(["']?)([^"'\s:]+)\1:\s*(["']?)([^"'\s#]+)\3\s*(?:#.*)?$/.exec(line)
    if (entry === null) {
      break
    }
    catalog[entry[2] ?? ""] = entry[4] ?? ""
  }
  return catalog
}

/**
 * The pins in a package.json's text, one naming the default catalog replaced by what `catalog` lists
 * for it; a missing or malformed section pins nothing.
 */
export function parsePins(json: string, catalog: Pins): Pins {
  const manifest: unknown = JSON.parse(json)
  const pins: Pins = {}
  if (typeof manifest !== "object" || manifest === null) {
    return pins
  }
  for (const key of ["dependencies", "devDependencies"]) {
    const section: unknown = Reflect.get(manifest, key)
    if (typeof section !== "object" || section === null) {
      continue
    }
    for (const [name, version] of Object.entries(section)) {
      if (typeof version === "string") {
        pins[name] = DEFAULT_CATALOG.has(version) ? (catalog[name] ?? version) : version
      }
    }
  }
  return pins
}

/** The pins of the repository at `root`; throws when its package.json is not JSON. */
export function readPins(root: string): Pins {
  const manifest = join(root, "package.json")
  if (!existsSync(manifest)) {
    return {}
  }
  const workspace = join(root, "pnpm-workspace.yaml")
  const catalog = existsSync(workspace) ? parseCatalog(readFileSync(workspace, "utf8")) : {}
  try {
    return parsePins(readFileSync(manifest, "utf8"), catalog)
  } catch (error) {
    throw new Error(`package.json: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
  }
}

/** `ref` with each `{name}` replaced by the exact version `pins` holds for package `name`. */
export function resolveRef(ref: string, pins: () => Pins): string {
  return ref.replaceAll(/\{([^{}]+)\}/g, (_, name: string) => {
    const version = pins()[name]
    if (version === undefined) {
      throw new Error(`ref ${ref} names ${name}, which package.json does not depend on`)
    }
    if (!EXACT_VERSION.test(version)) {
      throw new Error(`ref ${ref} needs an exact version of ${name}, and its pin is ${version}`)
    }
    return version
  })
}
