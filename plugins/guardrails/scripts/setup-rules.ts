// The permission rules the setup writes: the lease exception and the irreversible set for the user
// file, and a repository's deny backstop for a machine without jq.

import { spawnSync } from "node:child_process"

import { DEFAULT_GUARDRAILS, type EnvFiles, matchesEnvGlob, resolveConfig } from "./agentic-config.ts"

/** The auto-mode exception that lets a lease push through the classifier's default force-push block. */
export const LEASE_RULE =
  "Force push with --force-with-lease or --force-if-includes to a branch that is not master, main or production: allowed. The guardrails plugin's hook refuses a bare --force, -f or +refspec and any force to a protected branch, so the lease form is the safe one and needs no prompt."

/** The irreversible set for the user file; `git stash clear` also in the rtk form a permission rule sees once rtk rewrites it. */
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
  "git stash clear",
  "git stash drop",
  "git stash drop *",
  "git worktree remove --force *",
  "git worktree remove -f *"
]

// The gh commands the guards refuse. rtk rewrites `gh` as it does `git`, so they take both forms too.
const GH_DENY = ["gh repo delete", "gh repo delete *"]

/**
 * The rules the setup removes from a repository's deny list. The guard lets a forced delete of a
 * landed branch through, and a deny rule would refuse it whatever the guard decides.
 */
export const RETIRED_DENY = ["Bash(git branch -D *)", "Bash(rtk git branch -D *)"]

const ENV_NAME = /^\.env(\..+)?$|^\.envrc$/

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
 * The permissions.deny a repository gets: the git and gh sets twice, then Read and Edit per refused
 * env file. A rule written here stays until someone removes it, so while a config layer is invalid
 * the env rules come from the defaults, not from the strictest set the guards run on meanwhile.
 */
export function repositoryDeny(root: string): string[] {
  const rules = [...GIT_DENY, ...GH_DENY].flatMap((command) => [`Bash(${command})`, `Bash(rtk ${command})`])
  const resolved = resolveConfig(root)
  const envFiles = resolved.problems.length === 0 ? resolved.config.guardrails.envFiles : DEFAULT_GUARDRAILS.envFiles
  for (const file of refusedEnvFiles(root, envFiles)) {
    rules.push(`Read(./${file})`, `Edit(./${file})`)
  }
  return rules
}
