// `dw-sdlc check <name>` spawned on a throwaway repository: the one Check it runs, the exit code, the
// lines on stdout and the `--json` document.

import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"

import { lines, repo, runBin, scratch } from "../harness.ts"

const CONFIG = ".ai/agentic.config.json"
/** A run Check of each kind beside a Step, so a test sees what else ran by the files left behind. */
const STEP_AND_RUNS = {
  steps: ["touch step-ran"],
  run: [
    { name: "own", command: "touch own-ran" },
    { name: "other", command: "touch other-ran" },
    { name: "stale", command: "echo stale output; exit 1" },
    { name: "missing", command: "dw-sdlc-no-such-command" }
  ]
}
/** A comment block one line over the default budget of `comment-budget`. */
const LONG_COMMENT = { "src/a.ts": "// one\n// two\n// three\n// four\nexport const a = 1\n" }
const OVER_BUDGET =
  "src/a.ts:1: comment-budget: a comment block of 4 prose lines, over the 3-line budget — cut it to what the code cannot say, or move the reasoning into a doc and point at it"

/** A repository whose committed config sets the Steps and run Checks above and `checks`, beside `files`. */
function withChecks(checks: Record<string, unknown>, files: Record<string, string> = {}): string {
  const gate = { steps: STEP_AND_RUNS.steps, checks: { run: STEP_AND_RUNS.run, ...checks } }
  return repo({ files: { [CONFIG]: { version: 1, gate }, ...files } })
}

function ran(root: string): string[] {
  return ["step-ran", "own-ran", "other-ran"].filter((file) => existsSync(join(root, file)))
}

describe("dw-sdlc check, a run Check", () => {
  it("runs the script of that name alone, no Step and no other Check, and exits 0 when it passes", () => {
    const root = withChecks({ "comment-budget": true }, LONG_COMMENT)
    const run = runBin(["check", "own"], root)
    assert.equal(run.status, 0, run.stdout)
    assert.deepEqual(ran(root), ["own-ran"])
    assert.deepEqual(lines(run.stdout), ["check own: green — 0 steps, 1 check"])
  })

  it("passes its output through and exits 1 with its failure line when it fails", () => {
    const root = withChecks({})
    const run = runBin(["check", "stale"], root)
    assert.equal(run.status, 1)
    assert.deepEqual(ran(root), [])
    assert.deepEqual(lines(run.stdout), [
      "stale output",
      'stale: "echo stale output; exit 1" exited 1 — fix what it printed above',
      "check stale: failed — 1 failure"
    ])
  })

  it("exits 2 when the shell cannot find its command", () => {
    const root = withChecks({})
    const run = runBin(["check", "missing"], root)
    assert.equal(run.status, 2)
    assert.deepEqual(ran(root), [])
    assert.deepEqual(lines(run.stdout), [
      'missing: "dw-sdlc-no-such-command" was not found (exit 127) — install the command or fix gate.checks.run in the agentic config',
      "check missing: cannot run — 1 failure"
    ])
  })
})

describe("dw-sdlc check, a Check the package ships", () => {
  it("runs it alone and exits 1 with its failure lines when it fails", () => {
    const root = withChecks({ "comment-budget": true }, LONG_COMMENT)
    const run = runBin(["check", "comment-budget"], root)
    assert.equal(run.status, 1)
    assert.deepEqual(ran(root), [])
    assert.deepEqual(lines(run.stdout), [OVER_BUDGET, "check comment-budget: failed — 1 failure"])
  })

  it("runs on the options the config gives it", () => {
    const root = withChecks({ "comment-budget": { maxProseLines: 4 } }, LONG_COMMENT)
    const run = runBin(["check", "comment-budget"], root)
    assert.equal(run.status, 0, run.stdout)
    assert.deepEqual(lines(run.stdout), ["check comment-budget: green — 0 steps, 1 check"])
  })

  it("runs on its defaults where the config sets it false or leaves it out", () => {
    for (const checks of [{ "comment-budget": false }, {}]) {
      const run = runBin(["check", "comment-budget"], withChecks(checks, LONG_COMMENT))
      assert.equal(run.status, 1, JSON.stringify(checks))
      assert.deepEqual(lines(run.stdout), [OVER_BUDGET, "check comment-budget: failed — 1 failure"])
    }
  })

  it("exits 2 when an input it reads is missing", () => {
    const run = runBin(["check", "file-size-ratchet"], withChecks({}, { "src/a.ts": "export const a = 1\n" }))
    assert.equal(run.status, 2)
    assert.deepEqual(lines(run.stdout), [
      ".ai/file-size-ratchet.baseline.json: file-size-ratchet: the baseline does not exist — record it with dw-sdlc gate --update-baseline",
      "check file-size-ratchet: cannot run — 1 failure"
    ])
  })
})

describe("dw-sdlc check, what it cannot run", () => {
  it("exits 2 on a name no Check carries, naming the run Checks and the shipped ones", () => {
    const root = withChecks({})
    const run = runBin(["check", "nope"], root)
    assert.equal(run.status, 2)
    assert.deepEqual(ran(root), [])
    assert.deepEqual(lines(run.stdout), [
      'check: no Check is named "nope" — name one of own, other, stale, missing, primitives, agents-map, routed-docs, markdown-budget, markdown-refs, temporal-language, decision-records, file-size-ratchet, comment-budget',
      "check nope: cannot run — 1 failure"
    ])
  })

  it("exits 2 on an invalid config layer and runs nothing", () => {
    const root = repo({ files: { [CONFIG]: { version: 1, gate: { checks: { run: [], "no-such-check": true } } } } })
    const run = runBin(["check", "comment-budget"], root)
    assert.equal(run.status, 2)
    assert.deepEqual(lines(run.stdout), [
      `${CONFIG}: config: gate.checks: unknown key "no-such-check" — fix the file; the Gate runs once every layer is valid`,
      "check comment-budget: cannot run — 1 failure"
    ])
  })

  it("exits 2 with its usage on no name, a second name or --update-baseline", () => {
    const cwd = scratch("check")
    for (const [args, problem] of [
      [[], "dw-sdlc check: name the Check to run"],
      [["own", "other"], 'dw-sdlc check: one Check at a time, not "own" and "other"'],
      [["own", "--update-baseline"], "dw-sdlc check: Unknown option '--update-baseline'"]
    ] as const) {
      const run = runBin(["check", ...args], cwd)
      assert.equal(run.status, 2, args.join(" "))
      assert.ok(run.stderr.startsWith(problem), run.stderr)
      assert.match(run.stderr, /Usage: dw-sdlc check <name>/)
    }
  })
})

describe("dw-sdlc check --json", () => {
  it("prints the Gate's document with no Step and the one Check, the script's own output on stderr", () => {
    const root = withChecks({}, { "package.json": JSON.stringify({ scripts: { check: "dw-sdlc gate" } }) })
    const run = runBin(["check", "stale", "--json", "--root", root], scratch("elsewhere"))
    assert.equal(run.status, 1)
    assert.deepEqual(JSON.parse(run.stdout), {
      status: "fail",
      command: "pnpm check",
      steps: [],
      checks: [{ name: "stale", command: "echo stale output; exit 1", status: "fail", exitCode: 1 }],
      failures: [
        {
          file: null,
          line: null,
          rule: "stale",
          message: '"echo stale output; exit 1" exited 1',
          remedy: "fix what it printed above"
        }
      ]
    })
    assert.deepEqual(lines(run.stderr), ["stale output"])
  })

  it("runs a script and the shipped Check that share a name, as the Gate does, each its own entry", () => {
    const gate = { checks: { run: [{ name: "comment-budget", command: "true" }] } }
    const root = repo({ files: { [CONFIG]: { version: 1, gate }, ...LONG_COMMENT } })
    const run = runBin(["check", "comment-budget", "--json"], root)
    assert.equal(run.status, 1)
    assert.deepEqual(JSON.parse(run.stdout).checks, [
      { name: "comment-budget", command: "true", status: "pass", exitCode: 0 },
      { name: "comment-budget", command: null, status: "fail", exitCode: 1 }
    ])
  })
})

describe("dw-sdlc check under GitHub Actions", () => {
  it("prints each failure line and then the same as a workflow annotation on its file", () => {
    const root = withChecks({}, LONG_COMMENT)
    const run = runBin(["check", "comment-budget"], root, { GITHUB_ACTIONS: "true" })
    assert.equal(run.status, 1)
    assert.match(lines(run.stdout)[1] ?? "", /^::error file=src\/a\.ts,line=1,title=comment-budget::a comment block/)
  })
})
