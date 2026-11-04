// The version of this package, read from its own manifest: one directory above `src/` in the source
// and above `dist/` in what npm installs.

import { readFileSync } from "node:fs"
import { join } from "node:path"

import { parseObject } from "./json-text.ts"

/** This package's version; throws when its manifest names none. */
export function packageVersion(): string {
  const manifest = parseObject(readFileSync(join(import.meta.dirname, "..", "package.json"), "utf8"))
  if (typeof manifest?.version !== "string") {
    throw new Error("dw-sdlc's package.json names no version")
  }
  return manifest.version
}
