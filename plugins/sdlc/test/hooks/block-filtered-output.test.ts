// What block-filtered-output.sh refuses (exit 2) and lets through (exit 0), fed the real hook payload
// against throwaway repositories: one with a config that declares its check commands, one with none.

import assert from "node:assert/strict"
import { join } from "node:path"
import { describe, it } from "node:test"

import { bashPayload, expectExit, initRepo, runHook, scratch, writeJson } from "../harness.ts"

const TMP = scratch("filtered")
const CONFIGURED = initRepo(join(TMP, "configured"))
writeJson(join(CONFIGURED, ".ai", "agentic.config.json"), {
  gate: {
    command: "pnpm check",
    steps: ["pnpm lint:all", "make verify"],
    checks: { run: [{ name: "docs", command: "node scripts/docs-check.js" }] }
  }
})
const BARE = initRepo(join(TMP, "bare"))
const OPTED_OUT = initRepo(join(TMP, "opted-out"))
writeJson(join(OPTED_OUT, ".ai", "agentic.config.json"), {
  gate: { command: "pnpm check" },
  guardrails: { filteredOutput: "allow" }
})
const EXPLICIT_DENY = initRepo(join(TMP, "explicit-deny"))
writeJson(join(EXPLICIT_DENY, ".ai", "agentic.config.json"), { guardrails: { filteredOutput: "deny" } })

const FILTERS = ["head", "tail", "grep", "egrep", "fgrep", "rg", "sed", "awk", "less", "more"]

function run(command: string, cwd: string) {
  return runHook("block-filtered-output", bashPayload(command, cwd))
}
function blocked(name: string, command: string, cwd = CONFIGURED): void {
  it(name, () => {
    expectExit(run(command, cwd), 2)
  })
}
function allowed(name: string, command: string, cwd = CONFIGURED): void {
  it(name, () => {
    expectExit(run(command, cwd), 0)
  })
}

describe("a check command of the config piped into each filter is refused", () => {
  for (const filter of FILTERS) {
    blocked(`gate.command into ${filter}`, `pnpm check | ${filter} -n 5`)
    blocked(`a Step into ${filter}`, `pnpm lint:all 2>&1 | ${filter} x`)
    blocked(`another Step into ${filter}`, `make verify | ${filter} x`)
    blocked(`a gate.checks.run command into ${filter}`, `node scripts/docs-check.js | ${filter} x`)
  }
  blocked("a config command with arguments", "pnpm check --fix | tail -20")
})

describe("dw-sdlc gate and check are check commands", () => {
  for (const filter of FILTERS) {
    blocked(`pnpm exec dw-sdlc gate into ${filter}`, `pnpm exec dw-sdlc gate | ${filter} x`, BARE)
  }
  blocked("dw-sdlc check <name>", "dw-sdlc check primitives --json | head", BARE)
  blocked("the source entry point", "node packages/dw-sdlc/src/cli.ts gate | tail", BARE)
  allowed("dw-sdlc primitives is no check", "dw-sdlc primitives --paths a.ts | head", BARE)
})

describe("the built-in runners are check commands, with no config at all", () => {
  const runners = [
    "vitest run",
    "jest --ci",
    "tsc --noEmit",
    "oxlint .",
    "eslint src",
    "vp check",
    "rspec spec",
    "rubocop",
    "pytest -x",
    "cargo test",
    "go test ./..."
  ]
  for (const runner of runners) {
    blocked(`${runner} | tail`, `${runner} | tail -5`, BARE)
  }
  for (const filter of FILTERS) {
    blocked(`vitest into ${filter}`, `vitest run | ${filter} x`, BARE)
  }
  blocked("behind pnpm exec", "pnpm exec vitest run | head", BARE)
  blocked("behind pnpm dlx", "pnpm dlx tsc --noEmit | head", BARE)
  blocked("behind bundle exec", "bundle exec rspec | tail", BARE)
  blocked("behind a path", "./node_modules/.bin/eslint . | grep error", BARE)
  blocked("behind an assignment", "CI=1 vitest run | tail", BARE)
  blocked("behind rtk", "rtk vitest run | tail", BARE)
  blocked("after an &&", "cd app && vitest run | tail", BARE)
  blocked("in a subshell", "(vitest run | tail)", BARE)
  blocked("in a substitution", 'out=$(vitest run | tail -5); echo "$out"', BARE)
  blocked("in backticks", "out=`vitest run | tail -5`", BARE)
  blocked("behind sudo with an option", "sudo -u me vitest run | tail", BARE)
  blocked("behind timeout", "timeout 60 vitest run | tail", BARE)
  blocked("behind env with an option", "env -u X vitest run | tail", BARE)
  blocked("behind python -m", "python -m pytest | tail", BARE)
  blocked("behind uv run", "uv run pytest | tail", BARE)
  blocked("stderr piped too", "vitest run |& tail", BARE)
  blocked("the filter is not the next stage", "vitest run | cat | tail", BARE)
  blocked("with a redirect among the words", "vitest run 2>&1 | tail", BARE)
})

describe("the refusal names the command and the filter and says how to keep the output", () => {
  const verdict = run("pnpm check --fix 2>&1 | tail -20", CONFIGURED)
  it("names the command", () => {
    assert.match(verdict.stderr, /'pnpm check --fix' is piped into 'tail'/)
  })
  it("says the pipe hides the failure and the exit code", () => {
    assert.match(verdict.stderr, /hides the failure and the exit code/)
  })
  it("offers the unpiped run and the redirect", () => {
    assert.match(
      verdict.stderr,
      /Run 'pnpm check --fix' unpiped, or redirect it with 'pnpm check --fix > <file> 2>&1' and read the file/
    )
  })
  it("never mentions the persisted output", () => {
    assert.doesNotMatch(verdict.stderr, /persisted/i)
  })
})

describe("the refusal names the command as typed", () => {
  it("keeps a path", () => {
    assert.match(
      run("./node_modules/.bin/eslint . | grep e", BARE).stderr,
      /'\.\/node_modules\/\.bin\/eslint \.' is piped into 'grep'/
    )
  })
  it("keeps a launcher and drops a redirect", () => {
    assert.match(run("pnpm exec vitest run 2>&1 | tail", BARE).stderr, /'pnpm exec vitest run' is piped into 'tail'/)
  })
})

describe("the command as typed holds no redirect, a continuation line or a runner's option", () => {
  it("drops `>out` and `> out`", () => {
    assert.match(run("vitest run >out 2>&1 | tail", BARE).stderr, /'vitest run' is piped into 'tail'/)
    assert.match(run("vitest run > out 2>&1 | tail", BARE).stderr, /'vitest run' is piped into 'tail'/)
    assert.match(run("vitest run &> out | tail", BARE).stderr, /'vitest run' is piped into 'tail'/)
    assert.match(run("vitest run &>out | tail", BARE).stderr, /'vitest run' is piped into 'tail'/)
  })
  blocked("a pipe on a continuation line", "vitest run \\\n  | tail", BARE)
  blocked("npx with an option", "npx --no-install vitest | tail", BARE)
  blocked("cargo with a toolchain", "cargo +nightly test | tail", BARE)
})

describe("a pnpm or cargo option before the verb does not hide a check command", () => {
  blocked("pnpm --filter", "pnpm --filter app exec vitest | tail", BARE)
  blocked("pnpm -F", "pnpm -F app exec tsc | grep x", BARE)
  blocked("pnpm -C", "pnpm -C packages/app exec oxlint | head", BARE)
  blocked("pnpm --dir", "pnpm --dir packages/app exec vitest run | head", BARE)
  blocked("pnpm --filter=value", "pnpm --filter=app exec vitest | tail", BARE)
  blocked("pnpm -r", "pnpm -r exec vitest | tail", BARE)
  blocked("pnpm --recursive", "pnpm --recursive exec vitest | tail", BARE)
  blocked("pnpm -w", "pnpm -w exec vitest | tail", BARE)
  blocked("pnpm --filter, then run", "pnpm --filter app run vitest | tail", BARE)
  blocked("pnpm --filter, then the tool", "pnpm --filter app vitest | tail", BARE)
  blocked("two pnpm options", "pnpm -r --filter app exec vitest | tail", BARE)
  blocked("pnpm option with a redirect among the words", "pnpm --filter app exec vitest 2>&1 | tail", BARE)
  blocked("cargo --locked", "cargo --locked test | head", BARE)
  blocked("cargo --offline", "cargo --offline test | grep x", BARE)
  blocked("cargo --frozen", "cargo --frozen test | tail", BARE)
  blocked("cargo --color auto", "cargo --color never test | tail", BARE)
  blocked("cargo -Z flag", "cargo -Z unstable-options test | tail", BARE)
  blocked("cargo toolchain, then an option", "cargo +nightly --locked test | tail", BARE)
  it("names the command as typed", () => {
    assert.match(
      run("pnpm --filter app exec vitest | tail", BARE).stderr,
      /'pnpm --filter app exec vitest' is piped into 'tail'/
    )
  })
  allowed("pnpm --filter, redirected", "pnpm --filter app exec vitest > out.log 2>&1", BARE)
  allowed("pnpm --filter, unpiped", "pnpm --filter app exec vitest", BARE)
  allowed("pnpm --filter, tee", "pnpm --filter app exec vitest | tee out.log", BARE)
  allowed("cargo --locked, unpiped", "cargo --locked test", BARE)
  allowed("cargo --locked, redirected", "cargo --locked test > out.log 2>&1", BARE)
  allowed("pnpm --filter on no check command", "pnpm --filter app exec ls | head", BARE)
  allowed("pnpm --filter with a filter as the value", "pnpm --filter tail exec ls | head", BARE)
  allowed("pnpm -r on a script outside the list", "pnpm -r test | tail", BARE)
  allowed("cargo --locked build", "cargo --locked build | head", BARE)
  allowed("cargo with only an option", "cargo --version | head", BARE)
  allowed("a config command is matched as written", "pnpm -r check | tail")
})

describe("a filter behind a tee still hides the exit code", () => {
  blocked("tee, then tail", "vitest run | tee out.log | tail", BARE)
})

describe("what keeps the whole output passes", () => {
  allowed("| tee", "pnpm check | tee out.log")
  allowed("a redirect", "pnpm check > out.log 2>&1")
  allowed("a redirect of the built-in", "vitest run > out.log 2>&1", BARE)
  allowed("an unpiped check command", "pnpm check")
  allowed("an unpiped built-in", "vitest run", BARE)
  allowed("a redirect, then reading the file", "vitest run > out.log 2>&1; tail -50 out.log", BARE)
  allowed("a tee into a file, then the file", "vitest run 2>&1 | tee out.log", BARE)
})

describe("a command that is no check command passes through a filter", () => {
  allowed("git log | head", "git log --oneline | head", BARE)
  allowed("git log | head with a config", "git log --oneline | head")
  allowed("ls | grep", "ls | grep foo", BARE)
  allowed("cat | sed", "cat package.json | sed -n 1,5p", BARE)
  allowed("a check command named as an operand", "grep vitest package.json | head", BARE)
  allowed("a filter before the check", "echo x | grep x | vitest run", BARE)
  allowed("pnpm test without a config naming it", "pnpm test | tail", BARE)
  allowed("a quoted pipe is text", 'echo "vitest run | tail"', BARE)
  allowed("a commit message naming the pipe", 'git commit -m "fix: stop piping vitest | head"', BARE)
  allowed("a check command in a different pipeline", "vitest run; ls | head", BARE)
  allowed("no pipe at all", "echo hi")
})

describe("guardrails.filteredOutput", () => {
  for (const filter of FILTERS) {
    allowed(`allow passes a config command into ${filter}`, `pnpm check | ${filter} x`, OPTED_OUT)
    allowed(`allow passes a built-in into ${filter}`, `vitest run | ${filter} x`, OPTED_OUT)
  }
  allowed("allow passes dw-sdlc gate", "pnpm exec dw-sdlc gate | tail", OPTED_OUT)
  blocked("deny refuses", "vitest run | tail", EXPLICIT_DENY)
})
