// `dw-sdlc gate` spawned on a throwaway repository the way a user, a hook or CI runs it: the exit
// code, the lines on stdout and the `--json` document, which `gate.golden.json` holds.

import assert from "node:assert/strict"
import { existsSync, mkdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"

import { repo, runBin, scratch } from "./harness.ts"

const CONFIG = ".ai/agentic.config.json"
const GOLDEN = join(import.meta.dirname, "gate.golden.json")
const CHECK_SCRIPT = JSON.stringify({ scripts: { check: "dw-sdlc gate" } })
/** A layer the schema refuses: `gate.checks` names only the Checks the package ships. */
const UNKNOWN_CHECK = { version: 1, gate: { steps: ["touch step-ran"], checks: { "no-such-check": true } } }
const UNKNOWN_CHECK_LINE = `${CONFIG}: config: gate.checks: unknown key "no-such-check" — fix the file; the Gate runs once every layer is valid`

/** A repository whose committed config declares `gate`, beside `files`. */
function withGate(gate: unknown, files: Record<string, string | object> = {}): string {
  return repo({ files: { [CONFIG]: { version: 1, gate }, ...files } })
}

function lines(text: string): string[] {
  return text.split("\n").filter((line) => line !== "")
}

describe("dw-sdlc gate, the steps", () => {
  it("runs every step in order from the repository root and exits 0 when each is green", () => {
    const root = withGate({ steps: ["echo lint >> ran", "echo test >> ran"] })
    mkdirSync(join(root, "sub"))
    const run = runBin(["gate"], join(root, "sub"))
    assert.equal(run.status, 0, run.stderr)
    assert.equal(readFileSync(join(root, "ran"), "utf8"), "lint\ntest\n")
    assert.deepEqual(lines(run.stdout), [
      "gate: step echo lint >> ran",
      "gate: step echo test >> ran",
      "gate: green — 2 steps, 0 checks"
    ])
  })

  it("stops at the first failing step with its output passed through, runs nothing after it and exits 1", () => {
    const root = withGate({
      steps: ["echo lint found 3 problems; exit 3", "touch second-step-ran"],
      checks: { run: [{ name: "docs", command: "touch check-ran" }] }
    })
    const run = runBin(["gate"], root)
    assert.equal(run.status, 1)
    assert.ok(!existsSync(join(root, "second-step-ran")), "the second step ran")
    assert.ok(!existsSync(join(root, "check-ran")), "a Check ran after a failed step")
    assert.deepEqual(lines(run.stdout), [
      "gate: step echo lint found 3 problems; exit 3",
      "lint found 3 problems",
      'step: "echo lint found 3 problems; exit 3" exited 3 — fix what it printed above',
      "gate: failed — 1 failure"
    ])
  })

  it("exits 2 when the shell cannot find a step's command", () => {
    const root = withGate({ steps: ["dw-sdlc-no-such-command", "touch second-step-ran"] })
    const run = runBin(["gate"], root)
    assert.equal(run.status, 2)
    assert.ok(!existsSync(join(root, "second-step-ran")), "the second step ran")
    assert.deepEqual(lines(run.stdout).slice(1), [
      'step: "dw-sdlc-no-such-command" was not found (exit 127) — install the command or fix gate.steps in the agentic config',
      "gate: cannot run — 1 failure"
    ])
  })
})

describe("dw-sdlc gate, the Checks", () => {
  it("runs every run Check even when one fails, names each failure by its Check and exits 1", () => {
    const root = withGate({
      steps: ["true"],
      checks: {
        run: [
          { name: "first", command: "echo first is stale; exit 1" },
          { name: "second", command: "touch second-ran" },
          { name: "third", command: "exit 4" }
        ]
      }
    })
    const run = runBin(["gate"], root)
    assert.equal(run.status, 1)
    assert.ok(existsSync(join(root, "second-ran")), "a failed Check stopped the next one")
    assert.deepEqual(lines(run.stdout).slice(-3), [
      'first: "echo first is stale; exit 1" exited 1 — fix what it printed above',
      'third: "exit 4" exited 4 — fix what it printed above',
      "gate: failed — 2 failures"
    ])
  })

  it("exits 2 when the shell cannot find a run Check's command, after running the rest", () => {
    const root = withGate({
      checks: {
        run: [
          { name: "missing", command: "dw-sdlc-no-such-command" },
          { name: "failing", command: "exit 1" }
        ]
      }
    })
    const run = runBin(["gate"], root)
    assert.equal(run.status, 2)
    assert.deepEqual(lines(run.stdout).slice(-3), [
      'missing: "dw-sdlc-no-such-command" was not found (exit 127) — install the command or fix gate.checks.run in the agentic config',
      'failing: "exit 1" exited 1 — fix what it printed above',
      "gate: cannot run — 2 failures"
    ])
  })
})

describe("dw-sdlc gate, the config", () => {
  it("exits 2 on an invalid config layer, names the problem and runs nothing", () => {
    const root = repo({ files: { [CONFIG]: UNKNOWN_CHECK } })
    const run = runBin(["gate"], root)
    assert.equal(run.status, 2)
    assert.ok(!existsSync(join(root, "step-ran")), "a step ran on an invalid config")
    assert.deepEqual(lines(run.stdout), [UNKNOWN_CHECK_LINE, "gate: cannot run — 1 failure"])
  })

  it("passes with nothing to run, on a config with a validation key it does not know", () => {
    const root = repo({ files: { [CONFIG]: { version: 1, validation: { commands: ["pnpm check"] } } } })
    const run = runBin(["gate"], root)
    assert.equal(run.status, 0, run.stdout)
    assert.deepEqual(lines(run.stdout), ["gate: green — 0 steps, 0 checks"])
  })

  it("--root runs the Gate of the repository holding that directory", () => {
    const root = withGate({ steps: ["touch step-ran"] })
    const run = runBin(["gate", "--root", root], scratch("elsewhere"))
    assert.equal(run.status, 0, run.stdout)
    assert.ok(existsSync(join(root, "step-ran")))
  })
})

describe("dw-sdlc gate --json", () => {
  it("prints one document on stdout, the one the golden file holds, and the commands' own output on stderr", () => {
    const root = withGate(
      {
        steps: ["echo step output", "true"],
        checks: {
          run: [
            { name: "fresh", command: "true" },
            { name: "stale", command: "echo stale output >&2; exit 1" }
          ]
        }
      },
      { "package.json": CHECK_SCRIPT, "pnpm-lock.yaml": "" }
    )
    const run = runBin(["gate", "--json"], root)
    assert.equal(run.status, 1)
    assert.deepEqual(JSON.parse(run.stdout), JSON.parse(readFileSync(GOLDEN, "utf8")))
    assert.deepEqual(lines(run.stderr), [
      "gate: step echo step output",
      "step output",
      "gate: step true",
      "gate: check fresh",
      "gate: check stale",
      "stale output"
    ])
  })

  it("carries the command a layer sets over the inferred one, and null when there is none", () => {
    const set = withGate({ command: "make verify" }, { "package.json": CHECK_SCRIPT })
    assert.equal(JSON.parse(runBin(["gate", "--json"], set).stdout).command, "make verify")
    const none = withGate({})
    assert.equal(JSON.parse(runBin(["gate", "--json"], none).stdout).command, null)
  })
})

describe("dw-sdlc gate under GitHub Actions", () => {
  const ACTIONS = { GITHUB_ACTIONS: "true" }

  it("prints each failure line and then the same as a workflow annotation on its file", () => {
    const run = runBin(["gate"], repo({ files: { [CONFIG]: UNKNOWN_CHECK } }), ACTIONS)
    assert.equal(run.status, 2)
    assert.deepEqual(lines(run.stdout), [
      UNKNOWN_CHECK_LINE,
      `::error file=${CONFIG},title=config::gate.checks: unknown key "no-such-check" — fix the file; the Gate runs once every layer is valid`,
      "gate: cannot run — 1 failure"
    ])
  })

  it("annotates each failure right after its line, without a file where it has none", () => {
    const root = withGate({
      checks: {
        run: [
          { name: "first", command: "exit 1" },
          { name: "second", command: "exit 2" }
        ]
      }
    })
    const run = runBin(["gate"], root, ACTIONS)
    assert.equal(run.status, 1)
    assert.deepEqual(lines(run.stdout).slice(-5), [
      'first: "exit 1" exited 1 — fix what it printed above',
      '::error title=first::"exit 1" exited 1 — fix what it printed above',
      'second: "exit 2" exited 2 — fix what it printed above',
      '::error title=second::"exit 2" exited 2 — fix what it printed above',
      "gate: failed — 2 failures"
    ])
  })

  it("keeps stdout one document under --json and prints the annotations on stderr", () => {
    const run = runBin(["gate", "--json"], withGate({ steps: ["exit 3"] }), ACTIONS)
    assert.equal(JSON.parse(run.stdout).status, "fail")
    assert.ok(lines(run.stderr).includes('::error title=step::"exit 3" exited 3 — fix what it printed above'))
  })

  it("prints no annotation outside GitHub Actions", () => {
    const run = runBin(["gate"], repo({ files: { [CONFIG]: UNKNOWN_CHECK } }))
    assert.ok(!run.stdout.includes("::error"), run.stdout)
  })
})

describe("the dw-sdlc bin", () => {
  it("lists its commands under --help and exits 0", () => {
    const run = runBin(["--help"], scratch("bin"))
    assert.equal(run.status, 0)
    assert.match(run.stdout, /^ {2}gate {4}run the Gate/m)
  })

  it("exits 2 with its usage on no command, an unknown command or an unknown flag", () => {
    const cwd = scratch("bin")
    for (const [args, problem] of [
      [[], "dw-sdlc: no command given"],
      [["nope"], 'dw-sdlc: unknown command "nope"'],
      [["gate", "--nope"], "dw-sdlc gate: Unknown option '--nope'"]
    ] as const) {
      const run = runBin([...args], cwd)
      assert.equal(run.status, 2, args.join(" "))
      assert.ok(run.stderr.startsWith(problem), run.stderr)
      assert.match(run.stderr, /Usage: dw-sdlc/)
    }
  })
})
