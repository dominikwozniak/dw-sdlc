// The harness keeps the machine out of the fixtures: a developer's git config and shell environment
// must not decide whether a guard's test passes.

import assert from "node:assert/strict"
import { join } from "node:path"
import { describe, it } from "node:test"

import {
  commit,
  expectExit,
  git,
  initRepo,
  pathWithFakeBash,
  runBash,
  runHookAsync,
  scratch,
  write
} from "./harness.ts"

/** Runs `body` with `vars` set in this process's environment, then puts the old values back. */
function withEnv<T>(vars: Record<string, string>, body: () => T): T {
  const saved = Object.fromEntries(Object.keys(vars).map((key) => [key, process.env[key]]))
  Object.assign(process.env, vars)
  try {
    return body()
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  }
}

describe("harness", () => {
  it("a fixture commit never signs, whatever the machine's git config says", () => {
    const repo = initRepo(scratch("harness-sign"))
    write(join(repo, "a.txt"), "a\n")
    git(repo, "add", "a.txt")
    withEnv(
      {
        GIT_CONFIG_COUNT: "2",
        GIT_CONFIG_KEY_0: "commit.gpgsign",
        GIT_CONFIG_VALUE_0: "true",
        GIT_CONFIG_KEY_1: "user.signingkey",
        GIT_CONFIG_VALUE_1: "/nonexistent/signing-key"
      },
      () => {
        commit(repo, "-m", "init")
      }
    )
    assert.equal(git(repo, "rev-list", "--count", "HEAD").trim(), "1")
  })

  it("the large-file guard's kill switch in the developer's shell does not reach a hook", () => {
    withEnv({ CLAUDE_MAX_WRITE_BYTES: "0" }, () => {
      const verdict = runBash(["-c", 'printf %s "${CLAUDE_MAX_WRITE_BYTES-unset}"'], "")
      assert.equal(verdict.stdout, "unset")
    })
  })

  it("a hook runs on /bin/bash, its shebang, whatever bash comes first in PATH", () => {
    const verdict = withEnv({ PATH: pathWithFakeBash() }, () => runBash(["-c", 'printf %s "$BASH"'], ""))
    assert.equal(verdict.stdout, "/bin/bash")
  })

  it("a hook run concurrently runs on /bin/bash too", async () => {
    // runHookAsync spawns before it returns, so the PATH is still in place for the spawn.
    const pending = withEnv({ PATH: pathWithFakeBash() }, () => runHookAsync("bash-guard", ""))
    expectExit(await pending, 0)
  })
})
