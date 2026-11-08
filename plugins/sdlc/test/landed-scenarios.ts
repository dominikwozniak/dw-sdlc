// The Landed branch scenarios, one table: how a branch is built on a clone of a bare origin whose main
// takes merges as GitHub makes them, and whether it is Landed. The guard's tests and the package's tests
// both read it; it holds node builtins only, so neither needs the other's harness.

import { spawnSync } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

export type LandedScenario = {
  /** What the row stands for, in words. */
  name: string
  /** The branch the row builds. */
  branch: string
  /** Whether the branch is Landed as the local objects show it, before any fetch. */
  landed: boolean
  /** Whether it is Landed once origin is fetched, when that differs from `landed`: the Sweep fetches first. */
  landedAfterFetch?: boolean
  /** Builds the branch from the tip of main and leaves the checkout on main. */
  build: (repo: string) => void
  /** Whether the branch is pushed to origin with main. */
  pushed?: true
  /** Runs once main and the pushed branches are on origin: what happens there after the last fetch. */
  afterPush?: (repo: string, origin: string) => void
}

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" })
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} in ${cwd}: ${result.stderr}`)
  }
  return result.stdout
}

/** A commit under a fixed identity and never signed, whatever the machine's git config says. */
function commit(cwd: string, ...args: string[]): void {
  git(cwd, "-c", "user.email=t@example.com", "-c", "user.name=t", "-c", "commit.gpgsign=false", "commit", "-q", ...args)
}

function change(repo: string, file: string, text: string): void {
  mkdirSync(dirname(join(repo, file)), { recursive: true })
  writeFileSync(join(repo, file), text)
  git(repo, "add", file)
  commit(repo, "-m", `edit ${file}`)
}

function drop(repo: string, file: string): void {
  git(repo, "rm", "-q", file)
  commit(repo, "-m", `drop ${file}`)
}

// A three-way squash wants an identity, as a commit does; a CI runner has none.
function squash(repo: string, branch: string): void {
  git(repo, "-c", "user.email=t@example.com", "-c", "user.name=t", "merge", "-q", "--squash", branch)
  commit(repo, "-m", `squash ${branch}`)
}

export const LANDED_SCENARIOS: readonly LandedScenario[] = [
  {
    name: "tip on the base",
    branch: "merged",
    landed: true,
    build: (repo) => {
      git(repo, "branch", "merged")
    }
  },
  {
    // `netzero` adds a file and drops it while main adds and drops another, so their trees meet.
    name: "net-zero branch",
    branch: "netzero",
    landed: false,
    build: (repo) => {
      git(repo, "switch", "-q", "-c", "netzero")
      change(repo, "v.txt", "v\n")
      drop(repo, "v.txt")
      git(repo, "switch", "-q", "main")
      change(repo, "x.txt", "x\n")
      drop(repo, "x.txt")
    }
  },
  {
    name: "squashed, up to date with main",
    branch: "fresh",
    landed: true,
    build: (repo) => {
      git(repo, "switch", "-q", "-c", "fresh")
      change(repo, "fresh.txt", "1\n")
      change(repo, "fresh.txt", "1\n2\n")
      git(repo, "switch", "-q", "main")
      squash(repo, "fresh")
    }
  },
  {
    name: "squashed, then main edited its lines",
    branch: "moved",
    landed: true,
    build: (repo) => {
      git(repo, "switch", "-q", "-c", "moved")
      change(repo, "moved.txt", "1\n")
      git(repo, "switch", "-q", "main")
      squash(repo, "moved")
      change(repo, "moved.txt", "9\n")
    }
  },
  {
    name: "squashed once main had moved on",
    branch: "behind",
    landed: true,
    build: (repo) => {
      git(repo, "switch", "-q", "-c", "behind")
      change(repo, "behind.txt", "1\n")
      git(repo, "switch", "-q", "main")
      change(repo, "other.txt", "1\n")
      squash(repo, "behind")
    }
  },
  {
    name: "one more commit after its squash",
    branch: "extra",
    landed: false,
    build: (repo) => {
      git(repo, "switch", "-q", "-c", "extra")
      change(repo, "extra.txt", "1\n")
      git(repo, "switch", "-q", "main")
      squash(repo, "extra")
      git(repo, "switch", "-q", "extra")
      change(repo, "extra.txt", "1\n2\n")
      git(repo, "switch", "-q", "main")
    }
  },
  {
    name: "never merged",
    branch: "never",
    landed: false,
    pushed: true,
    build: (repo) => {
      git(repo, "switch", "-q", "-c", "never", "main")
      change(repo, "never.txt", "1\n")
      git(repo, "switch", "-q", "main")
    }
  },
  {
    name: "fast-forwarded",
    branch: "ff",
    landed: true,
    build: (repo) => {
      git(repo, "switch", "-q", "-c", "ff", "main")
      change(repo, "ff.txt", "1\n")
      git(repo, "switch", "-q", "main")
      git(repo, "merge", "-q", "--ff-only", "ff")
    }
  },
  {
    // `spaced` holds a line main took with other whitespace.
    name: "merged with other whitespace",
    branch: "spaced",
    landed: false,
    build: (repo) => {
      git(repo, "switch", "-q", "-c", "spaced")
      change(repo, "spaced.txt", "a  b\n")
      git(repo, "switch", "-q", "main")
      change(repo, "spaced.txt", "a b\n")
    }
  },
  {
    // Squashed in another clone after this one last fetched: Landed once origin is fetched.
    name: "squashed after the last fetch",
    branch: "late",
    landed: false,
    landedAfterFetch: true,
    pushed: true,
    build: (repo) => {
      git(repo, "switch", "-q", "-c", "late", "main")
      change(repo, "late.txt", "1\n")
      git(repo, "switch", "-q", "main")
    },
    afterPush: (repo, origin) => {
      const elsewhere = `${repo}-elsewhere`
      git(dirname(repo), "clone", "-q", origin, elsewhere)
      squash(elsewhere, "origin/late")
      git(elsewhere, "push", "-q", "origin", "main")
    }
  }
]

/**
 * A clone of the bare `origin` at `dir`, on main, with each scenario's branch built in table order and main
 * and the pushed branches on origin. `origin/main` stays where the clone left main, as at its last fetch.
 */
export function buildLandedRepo(
  dir: string,
  origin: string,
  scenarios: readonly LandedScenario[] = LANDED_SCENARIOS
): string {
  git(dirname(origin), "init", "-q", "--bare", "-b", "main", origin)
  git(origin, "config", "uploadpack.allowFilter", "true")
  mkdirSync(dir, { recursive: true })
  git(dir, "init", "-q", "-b", "main")
  git(dir, "remote", "add", "origin", origin)
  change(dir, "a.txt", "a\n")
  for (const scenario of scenarios) {
    scenario.build(dir)
  }
  const pushed = scenarios.filter((scenario) => scenario.pushed === true).map((scenario) => scenario.branch)
  git(dir, "push", "-q", "origin", "main", ...pushed)
  git(dir, "remote", "set-head", "origin", "main")
  for (const scenario of scenarios) {
    scenario.afterPush?.(dir, origin)
  }
  return dir
}
