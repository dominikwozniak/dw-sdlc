// What the plugin's hook test shares: the package's References harness, reached through the plugin's
// `dw-sdlc` link, and the hook spawned the way Claude Code spawns it: `/bin/bash` with the JSON payload
// on stdin, the exit code and both streams.

import { join } from "node:path"

import { type Run, spawnIsolated } from "../dw-sdlc/test/references-harness.ts"

export {
  commit,
  git,
  initRepo,
  runReferences,
  scratch,
  write,
  writeJson,
  type Run
} from "../dw-sdlc/test/references-harness.ts"

const HOOKS_DIR = join(import.meta.dirname, "..", "hooks")
/** The hooks' shebang, bash 3.2 on macOS — never the first bash in PATH, which may be a newer one. */
const BASH = "/bin/bash"

/** Runs `hooks/<name>.sh` from `cwd` under the harness's isolated environment, `env` over it, with `payload` on stdin. */
export function runHook(name: string, payload: object, cwd: string, env: NodeJS.ProcessEnv = {}): Run {
  return spawnIsolated(BASH, [join(HOOKS_DIR, `${name}.sh`)], cwd, env, JSON.stringify(payload))
}
