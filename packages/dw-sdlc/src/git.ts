// Every git command the package runs, through `exec.ts`: from the directory it names, in this process's
// environment without the variables that tie git to one repository, so a git hook's GIT_DIR or
// GIT_INDEX_FILE never aims it at the hook's repository; and what went wrong, in git's words on one line.

import { CannotRun } from "./cannot-run.ts"
import { exec, firstLine } from "./exec.ts"

export type GitOptions = {
  /** Text on git's stdin. */
  input?: string
  /** The time limit, for what a repository's size or the network stretches: a fetch, a scan of history. */
  limitMs?: number
  /** Variables over the cleared environment, as a scratch GIT_INDEX_FILE. */
  env?: Record<string, string>
  /** stdout as git wrote it, for NUL-separated or patch output; trimmed otherwise. */
  raw?: boolean
  /** Every line git wrote on stderr, joined, where one line of a report must hold all it said. */
  whole?: boolean
}

/** What git answered: its stdout on exit 0; else `said`, what went wrong, and `error`, it after `git <first argument>:`. */
export type GitAnswer = { out: string } | { error: string; said: string }

const REMEDY = "check the repository with git status"

let repositoryVars: Set<string> | undefined

/** This process's environment without the variables that tie git to one repository, as git lists them. */
export function repositoryFreeEnv(): NodeJS.ProcessEnv {
  repositoryVars ??= new Set((exec("git", ["rev-parse", "--local-env-vars"]).stdout ?? "").split("\n").filter(Boolean))
  const vars = repositoryVars
  return Object.fromEntries(Object.entries(process.env).filter(([name]) => !vars.has(name)))
}

/** What git said went wrong: its first line on stderr, or with `whole` every line; else how it ended. */
function saidOf(result: ReturnType<typeof exec>, whole: boolean): string {
  if (result.error !== undefined) {
    return result.error.message
  }
  const words = whole
    ? result.stderr
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== "")
        .join(" ")
    : firstLine(result.stderr)
  return words === undefined || words === "" ? `exited ${result.status ?? "on a signal"}` : words
}

/** `git -C <dir> <args>`; past its limit it throws `TimedOut`, as `exec` does. */
export function git(dir: string, args: string[], options: GitOptions = {}): GitAnswer {
  const { input, limitMs } = options
  const result = exec("git", ["-C", dir, ...args], {
    env: { ...repositoryFreeEnv(), ...options.env },
    ...(input === undefined ? {} : { input }),
    ...(limitMs === undefined ? {} : { limitMs })
  })
  if (result.status === 0) {
    return { out: options.raw === true ? result.stdout : result.stdout.trim() }
  }
  const said = saidOf(result, options.whole === true)
  return { error: `git ${args[0] ?? ""}: ${said}`, said }
}

/** What `git -C <dir> <args>` prints, or undefined when it exits non-zero, as a question answered no. */
export function asked(dir: string, args: string[], options: GitOptions = {}): string | undefined {
  const answer = git(dir, args, options)
  return "out" in answer ? answer.out : undefined
}

/** What `git -C <dir> <args>` prints; a failure stops the command, naming git's problem. */
export function must(dir: string, args: string[]): string {
  const answer = git(dir, args)
  if ("error" in answer) {
    throw new CannotRun(answer.error, REMEDY)
  }
  return answer.out
}

/** The git dir of the checkout at `dir` and the common one its worktrees share, absolute; undefined outside one. */
export function gitDirs(dir: string): { gitDir: string; commonDir: string } | undefined {
  const answer = asked(dir, ["rev-parse", "--path-format=absolute", "--git-dir", "--git-common-dir"])
  const [gitDir, commonDir] = answer === undefined ? [] : answer.split("\n")
  return gitDir === undefined || commonDir === undefined ? undefined : { gitDir, commonDir }
}
