// Whether a local branch is Landed: its work is on the base, as the guard's `guard_landed`
// (plugins/sdlc/hooks/lib-git.sh) judges it. The guard's bash stays as it is; docs/adr/0015 says why there are
// two, and the shared table of scenarios, plugins/sdlc/test/landed-scenarios.ts, holds them to one meaning.

import { spawnSync } from "node:child_process"

import { repositoryFreeEnv } from "./git-env.ts"

/** The base commits read, newest first: a branch that forked further back is kept rather than read for seconds. */
const SCAN = 5000

/** Only local objects: a partial clone's missing blob is no reason to ask its remote. */
function localEnv(): NodeJS.ProcessEnv {
  return { ...repositoryFreeEnv(), GIT_NO_LAZY_FETCH: "1" }
}

type Ran = { status: number; stdout: string }

function git(root: string, args: string[], input?: string): Ran {
  const result = spawnSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    env: localEnv(),
    input,
    maxBuffer: 64 * 1024 * 1024
  })
  return { status: result.status ?? 1, stdout: result.stdout ?? "" }
}

/** What `git <args>` prints, or undefined when it exits non-zero. */
function answer(root: string, args: string[], input?: string): string | undefined {
  const ran = git(root, args, input)
  return ran.status === 0 ? ran.stdout.trim() : undefined
}

/** The patch-id of the whole diff from `from` to `to`; undefined for an empty diff or one git could not finish. */
function patchIdOf(root: string, from: string, to: string): string | undefined {
  const diff = git(root, ["diff-tree", "-p", "--binary", "--no-renames", from, to])
  if (diff.status !== 0) {
    return undefined
  }
  const id = answer(root, ["patch-id", "--verbatim"], diff.stdout)?.split(" ")[0]
  return id === undefined || id === "" ? undefined : id
}

/** Whether a base commit in `range`, merges aside, has `patch` for the patch-id of its diff. */
function baseHoldsPatch(root: string, range: string, patch: string): boolean {
  // The diffs stream from git to git, never into this process: SCAN commits can print far past a buffer.
  const pipeline = [
    'git -C "$1" rev-list --no-merges --max-count="$2" "$3"',
    'git -C "$1" diff-tree --stdin -p --binary --no-renames 2>/dev/null',
    "git patch-id --verbatim"
  ].join(" | ")
  const result = spawnSync("sh", ["-c", pipeline, "sh", root, String(SCAN), range], {
    encoding: "utf8",
    env: localEnv(),
    maxBuffer: 64 * 1024 * 1024
  })
  if (result.status !== 0) {
    return false
  }
  return result.stdout.split("\n").some((line) => line.split(" ")[0] === patch)
}

/**
 * Whether the work of the local `branch` is on `baseRef`: the tip is on it, or a base commit since the fork
 * holds the tip's tree or the verbatim patch-id of its whole diff, as a squash merge leaves them.
 */
export function isLanded(root: string, baseRef: string, branch: string): boolean {
  const ref = `refs/heads/${branch}`
  if (answer(root, ["check-ref-format", ref]) === undefined) {
    return false
  }
  const tip = answer(root, ["rev-parse", "--verify", "-q", `${ref}^{commit}`])
  if (tip === undefined) {
    return false
  }
  if (git(root, ["merge-base", "--is-ancestor", tip, baseRef]).status === 0) {
    return true
  }
  const fork = answer(root, ["merge-base", tip, baseRef])
  const tree = answer(root, ["rev-parse", `${tip}^{tree}`])
  if (fork === undefined || tree === undefined || tree === answer(root, ["rev-parse", `${fork}^{tree}`])) {
    return false
  }
  const range = `${fork}..${baseRef}`
  const trees = answer(root, ["log", "--format=%T", `--max-count=${SCAN}`, range]) ?? ""
  if (trees.split("\n").includes(tree)) {
    return true
  }
  const patch = patchIdOf(root, fork, tip)
  return patch !== undefined && baseHoldsPatch(root, range, patch)
}
