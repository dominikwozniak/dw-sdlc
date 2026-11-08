// The environment a git command runs under to find its repository from its own directory, as a git
// hook's GIT_DIR or GIT_INDEX_FILE would otherwise aim it at the hook's repository.

import { exec } from "./exec.ts"

let repositoryVars: Set<string> | undefined

/** This process's environment without the variables that tie git to one repository, as git lists them. */
export function repositoryFreeEnv(): NodeJS.ProcessEnv {
  repositoryVars ??= new Set((exec("git", ["rev-parse", "--local-env-vars"]).stdout ?? "").split("\n").filter(Boolean))
  const vars = repositoryVars
  return Object.fromEntries(Object.entries(process.env).filter(([name]) => !vars.has(name)))
}
