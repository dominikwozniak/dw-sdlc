// The dispatcher's contract: what bash-guard.sh lets through and what it refuses, fed the real hook
// payload. A guard's own test calls the guard directly and cannot see whether the dispatcher ever
// spawns it — this file is where that is pinned.

import assert from "node:assert/strict"
import { accessSync, constants } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"

import {
  bashPayload,
  expectExit,
  hookPath,
  initRepo,
  pathWithFakeBash,
  REPO_ROOT,
  runHook,
  scratch,
  verdictOf,
  writeJson,
  type Verdict
} from "../harness.ts"

function run(command: string, cwd = REPO_ROOT): Verdict {
  return runHook("bash-guard", bashPayload(command, cwd))
}
function allowed(name: string, command: string): void {
  it(name, () => {
    expectExit(run(command), 0)
  })
}
function refused(name: string, command: string): void {
  it(name, () => {
    expectExit(run(command), 2)
  })
}

describe("executable and silent on ordinary work", () => {
  it("hook is executable", () => {
    accessSync(hookPath("bash-guard"), constants.X_OK)
  })
  allowed("git status", "git status")
  allowed("pnpm check", "pnpm check")
  allowed("multi-line command", "ls\ngit status")
})

describe("block-dangerous-commands is wired and always on", () => {
  refused("git push --force", "git push --force")
  refused("git reset --hard", "git reset --hard")
  refused("rtk-disabled force push", "RTK_DISABLED=1 git push --force")
  refused("second command in a chain", "pnpm test && git clean -fd")
  allowed("lease push to a feature branch", "git push --force-with-lease origin feat-x")
  allowed("heredoc body is a file, not a command", "cat > x <<EOF\ngit push --force\nEOF")
  refused("heredoc opener still counts", "git push --force <<EOF\nbody\nEOF")
  refused("an unquoted heredoc body's substitution runs", "cat > x <<EOF\n$(git push --force)\nEOF")
  refused("a comment ending in a backslash hides no line", "ls # note \\\ngit push --force")
  refused("a << inside double quotes hides nothing", 'echo "a << EOF"\ngit reset --hard')
  refused("a << behind a comment hides nothing", "# note << EOF\nrm -rf /")
  refused(
    "a quoted line carried over hides nothing",
    'git commit -m "fix: a thing\n\nCo-Authored-By: X <x@example.com>\n\nsee << EOF"\ngit reset --hard'
  )
})

describe("a line continuation joins its lines, as the shell does", () => {
  allowed(
    "a quoted argument on a continuation line is an argument",
    "printf '%s\\n' \\\n  'git push --force-with-lease origin master'"
  )
  refused("a push split over a continuation", "git push \\\n  --force")
  refused("a reset split over a continuation", "git reset \\\n  --hard")
  refused("an escaped backslash ends no line", "echo a\\\\\ngit push --force")
})

describe("credential-leak-guard and block-env-access are wired", () => {
  refused("credential store", "cat ~/.ssh/id_rsa")
  refused("environment hunt", "env | grep -i token")
  refused("env file git does not track here", "cat .env.local")
  allowed("env example by name", "cat .env.example")
  allowed("heredoc body naming an env file", "cat <<EOF\ncat .env.local\nEOF")
})

describe("block-non-pnpm and enforce-commit-hygiene fire on their triggers (this repository: pnpm)", () => {
  refused("npm install here", "npm install")
  refused("npx here", "npx tsc")
  allowed("pnpm here", "pnpm install")
  refused("git add -A", "git add -A")
  refused("live backtick in a commit message", 'git commit -m "fix: `pwd`"')
  refused("a heredoc commit message is checked", "git commit -m \"$(cat <<'EOF'\nnot a subject\nEOF\n)\"")
  allowed(
    "a heredoc commit message that fits",
    "git commit -m \"$(cat <<'EOF'\nfix: a thing\n\nCo-Authored-By: X <x@example.com>\nEOF\n)\""
  )
  allowed("heredoc body naming npm", "cat <<EOF\nnpm install\nEOF")
})

describe("block-store-writes fires on asc and on a store script", () => {
  refused("an asc write", "asc metadata apply --app 6742772020 --dir store/listing")
  allowed("an asc read", "asc metadata pull --app 6742772020 --dir store/listing")
  refused("a store command with --confirm", "pnpm store:listing --confirm")
  allowed("a store command without it", "pnpm store:listing --check")
  refused("--confirm on a continuation line", "node scripts/store-pricing.ts \\\n  --confirm")
})

describe("an ask waits for every guard, so a later refusal still wins", () => {
  const ask = initRepo(join(scratch("dispatch"), "ask"), { branch: "feat" })
  writeJson(join(ask, ".ai", "agentic.config.json"), { guardrails: { forcePush: "ask" } })
  it("a lease push asks", () => {
    assert.equal(verdictOf(run("git push --force-with-lease origin feat", ask)), "ask")
  })
  it("a credential read after it is refused", () => {
    expectExit(run("git push --force-with-lease origin feat && cat ~/.ssh/id_rsa", ask), 2)
  })
})

describe("a guard runs on the bash the dispatcher runs on", () => {
  it("a refusal holds with another bash first in PATH", () => {
    expectExit(runHook("bash-guard", bashPayload("rm -rf /", REPO_ROOT), { env: { PATH: pathWithFakeBash() } }), 2)
  })
})

describe("a long command is judged in seconds", () => {
  it("200 copies of a quote handed to a shell, every guard run, under 5 s", () => {
    const command = Array.from({ length: 200 }, () => "bash -c 'echo \"' ; ls x ; echo '\"'").join(" ; ")
    const start = performance.now()
    const verdict = run(command)
    const seconds = (performance.now() - start) / 1000
    expectExit(verdict, 0)
    assert.ok(seconds < 5, `${seconds.toFixed(1)} s`)
  })
})

describe("fails open on garbage", () => {
  it("empty payload", () => {
    expectExit(runHook("bash-guard", ""), 0)
  })
  it("malformed payload", () => {
    expectExit(runHook("bash-guard", "not json"), 0)
  })
  it("no command", () => {
    expectExit(runHook("bash-guard", { tool_name: "Bash", tool_input: {} }), 0)
  })
})
