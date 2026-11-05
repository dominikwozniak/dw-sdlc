// The built-in rules `pr.review: auto` routes a Review depth by, from the files the Review would read:
// lockfiles alone are off; a workflow file, more than 100 changed lines outside lockfiles, or a change
// the compare cannot size is full; the rest is light. No config key moves them.

import type { ReviewDepth } from "../agentic-config.ts"
import type { ChangedFile } from "./state.ts"

/** The lockfiles a package manager writes, by file name in any directory. */
const LOCKFILES = new Set([
  "pnpm-lock.yaml",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "Gemfile.lock",
  "Cargo.lock",
  "poetry.lock",
  "uv.lock",
  "Pipfile.lock",
  "composer.lock",
  "go.sum",
  "Podfile.lock",
  "pubspec.lock",
  "mix.lock",
  "flake.lock"
])
/** Where GitHub Actions reads its workflows: a change there runs with the repository's secrets. */
const WORKFLOWS = ".github/workflows/"
/** The most changed lines outside lockfiles a light Review reads. */
const LINE_LIMIT = 100

/** A routed depth, and under off why no one reads the changes, as the status the script posts says. */
export type Routed = { depth: Exclude<ReviewDepth, "off"> } | { depth: "off"; why: string }

function isLockfile(path: string): boolean {
  return LOCKFILES.has(path.slice(path.lastIndexOf("/") + 1))
}

function isWorkflow({ path, previous }: ChangedFile): boolean {
  return [path, previous].some((name) => name?.startsWith(WORKFLOWS) === true)
}

/**
 * The depth the rules route `changed` to. A change not read or not sized reads in full, as does a file
 * outside lockfiles the compare shows no patch for.
 */
export function route(changed: ChangedFile[] | "unsized" | null): Routed {
  if (changed === null || changed === "unsized") {
    return { depth: "full" }
  }
  const code = changed.filter((file) => !isLockfile(file.path))
  if (changed.length > 0 && code.length === 0) {
    return { depth: "off", why: "lockfiles only" }
  }
  const lines = code.map((file) => file.lines)
  if (changed.some(isWorkflow) || lines.includes(null)) {
    return { depth: "full" }
  }
  const total = lines.reduce<number>((sum, count) => sum + (count ?? 0), 0)
  return { depth: total > LINE_LIMIT ? "full" : "light" }
}
