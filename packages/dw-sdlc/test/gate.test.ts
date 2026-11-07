// `dw-sdlc gate` spawned on a throwaway repository the way a user, a hook or CI runs it: the exit
// code, the lines on stdout and the `--json` document, which `gate.golden.json` holds.

import assert from "node:assert/strict"
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, utimesSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"

import {
  commit,
  FAILED_REMEDY,
  git,
  killGroup,
  lines,
  NUMBERED,
  NUMBERED_TAIL,
  repo,
  runBin,
  scratch,
  type Started,
  startBin,
  timed,
  until,
  write
} from "./harness.ts"

const CONFIG = ".ai/agentic.config.json"
const LOCAL = ".ai/agentic.config.local.json"
const GOLDEN = join(import.meta.dirname, "gate.golden.json")
const SCHEMA = join(import.meta.dirname, "..", "config", "agentic.config.schema.json")
const CHECK_SCRIPT = JSON.stringify({ scripts: { check: "dw-sdlc gate" } })
/** A layer the schema refuses: `gate.checks` names only the Checks the package ships. */
const UNKNOWN_CHECK = { version: 1, gate: { steps: ["touch step-ran"], checks: { "no-such-check": true } } }
const UNKNOWN_CHECK_LINE = `${CONFIG}: config: gate.checks: unknown key "no-such-check" — fix the file; the Gate runs once every layer is valid`

/** A repository whose committed config declares `gate`, beside `files`. */
function withGate(gate: unknown, files: Record<string, string | object> = {}): string {
  return repo({ files: { [CONFIG]: { version: 1, gate }, ...files } })
}

/**
 * A repository whose one Step counts its runs in `ran`, a file git ignores, so a run leaves the tree as
 * it was; `gate` over its Gate.
 */
function countingRepo(files: Record<string, string | object> = {}, gate: Record<string, unknown> = {}): string {
  return withGate({ steps: ["echo ran >> ran"], ...gate }, { ".gitignore": "ran\n", ...files })
}

/** A repository with `files` committed, whose Gate is `gate`; `ran` and `dist/` are ignored. */
function committedRepo(gate: unknown, files: Record<string, string> = {}): string {
  const root = withGate(gate, { ".gitignore": "ran\ndist/\n", ...files })
  git(root, "add", "-A")
  commit(root, "-m", "init")
  return root
}

/** How many times the Step of `countingRepo` ran. */
function runs(root: string): number {
  return existsSync(join(root, "ran")) ? lines(readFileSync(join(root, "ran"), "utf8")).length : 0
}

/**
 * Runs `dw-sdlc <args>` on `root` and sends `signal` once a command touched `started`: to the bin and
 * its commands together, as Ctrl-C does, or to the bin alone.
 */
async function interrupted(
  root: string,
  args: string[],
  signal: NodeJS.Signals,
  to: "group" | "bin" = "group"
): Promise<Awaited<Started["done"]>> {
  const gate = startBin(args, root)
  try {
    await until(() => existsSync(join(root, "started")))
    process.kill(to === "group" ? -gate.group : gate.group, signal)
    return await gate.done
  } finally {
    killGroup(gate.group)
  }
}

describe("dw-sdlc gate, the steps", () => {
  it("runs every step in order from the repository root and exits 0 when each is green", () => {
    const root = withGate({ steps: ["echo lint >> ran", "echo test >> ran"] }, { ".gitignore": "ran\n" })
    mkdirSync(join(root, "sub"))
    const run = runBin(["gate"], join(root, "sub"))
    assert.equal(run.status, 0, run.stderr)
    assert.equal(readFileSync(join(root, "ran"), "utf8"), "lint\ntest\n")
    assert.deepEqual(timed(run.stdout), [
      "gate: step echo lint >> ran — pass (N s)",
      "gate: step echo test >> ran — pass (N s)",
      "gate: green — 2 steps, 0 checks"
    ])
  })

  it("prints one line per Step and per Check and the verdict on a green run, and none of a Step's own output", () => {
    const root = withGate({
      steps: ["echo lint output", "echo test output >&2"],
      checks: { run: [{ name: "docs", command: "echo docs output" }], "comment-budget": true }
    })
    const run = runBin(["gate"], root)
    assert.equal(run.status, 0, run.stdout)
    assert.deepEqual(timed(run.stdout), [
      "gate: step echo lint output — pass (N s)",
      "gate: step echo test output >&2 — pass (N s)",
      "gate: check docs — pass",
      "gate: check comment-budget — pass",
      "gate: green — 2 steps, 2 checks"
    ])
    assert.equal(run.stderr, "")
  })

  it("stops at the first failing step, prints its last 50 lines of both streams in order, runs nothing after it and exits 1", () => {
    const root = withGate({
      steps: [NUMBERED, "touch second-step-ran"],
      checks: { run: [{ name: "docs", command: "touch check-ran" }] }
    })
    const run = runBin(["gate"], root)
    assert.equal(run.status, 1)
    assert.ok(!existsSync(join(root, "second-step-ran")), "the second step ran")
    assert.ok(!existsSync(join(root, "check-ran")), "a Check ran after a failed step")
    assert.deepEqual(timed(run.stdout), [
      `gate: step ${NUMBERED} — failed, exit 3 (N s); its last 50 lines:`,
      ...NUMBERED_TAIL.map((line) => `  ${line}`),
      `step: ${JSON.stringify(NUMBERED)} exited 3 — ${FAILED_REMEDY}`,
      "gate: failed — 1 failure"
    ])
    assert.equal(run.stderr, "")
  })

  it("exits 2 when the shell cannot find a step's command, with the shell's own words under its line", () => {
    const root = withGate({ steps: ["dw-sdlc-no-such-command", "touch second-step-ran"] })
    const run = runBin(["gate"], root)
    assert.equal(run.status, 2)
    assert.ok(!existsSync(join(root, "second-step-ran")), "the second step ran")
    const [head, said, ...rest] = timed(run.stdout)
    assert.equal(head, "gate: step dw-sdlc-no-such-command — cannot run, exit 127 (N s); its last 50 lines:")
    assert.match(said ?? "", /^ {2}\S.*dw-sdlc-no-such-command.*not found/)
    assert.deepEqual(rest, [
      'step: "dw-sdlc-no-such-command" was not found (exit 127) — install the command or fix gate.steps in the agentic config',
      "gate: cannot run — 1 failure"
    ])
  })
})

describe("dw-sdlc gate, Drift", () => {
  const REMEDY = "commit the change, or make the Step only read"
  const FORMAT = "printf 'formatted\\n' > notes.md"

  it("fails a Step that edits a tracked file by file and Step, still runs the next Step and exits 1", () => {
    const root = committedRepo({ steps: [FORMAT, "echo ran >> ran"] }, { "notes.md": "draft\n" })
    const run = runBin(["gate"], root)
    assert.equal(run.status, 1, run.stdout)
    assert.equal(runs(root), 1)
    assert.deepEqual(timed(run.stdout), [
      `gate: step ${FORMAT} — pass (N s)`,
      "gate: step echo ran >> ran — pass (N s)",
      `notes.md: drift: ${JSON.stringify(FORMAT)} changed it — ${REMEDY}`,
      "gate: failed — 1 failure"
    ])
  })

  it("reports a file a Step creates unignored and a file a Step deletes", () => {
    const root = committedRepo({ steps: ["touch new.md", "rm old.md"] }, { "old.md": "old\n" })
    const run = runBin(["gate"], root)
    assert.equal(run.status, 1, run.stdout)
    assert.deepEqual(lines(run.stdout).slice(-3), [
      `new.md: drift: "touch new.md" created it — ${REMEDY}`,
      `old.md: drift: "rm old.md" deleted it — ${REMEDY}`,
      "gate: failed — 2 failures"
    ])
  })

  it("passes a Step that writes only under an ignored path, on a tree edited before the run", () => {
    const root = committedRepo({ steps: ["mkdir -p dist && echo built > dist/out.js"] }, { "notes.md": "draft\n" })
    write(join(root, "notes.md"), "edited by the dev\n")
    write(join(root, "draft.md"), "a new file of the dev's\n")
    const run = runBin(["gate"], root)
    assert.equal(run.status, 0, run.stdout)
    assert.equal(lines(run.stdout).at(-1), "gate: green — 1 step, 0 checks")
  })

  it("reports the Drift of a Step that fails beside its failure", () => {
    const root = committedRepo({ steps: ["touch new.md; exit 1"] })
    const run = runBin(["gate"], root)
    assert.equal(run.status, 1, run.stdout)
    assert.deepEqual(lines(run.stdout).slice(-3), [
      `step: "touch new.md; exit 1" exited 1 — ${FAILED_REMEDY}`,
      `new.md: drift: "touch new.md; exit 1" created it — ${REMEDY}`,
      "gate: failed — 2 failures"
    ])
  })

  it('passes a Step that writes under gate.drift "allow"', () => {
    const run = runBin(["gate"], committedRepo({ drift: "allow", steps: ["touch new.md"] }))
    assert.equal(run.status, 0, run.stdout)
  })

  it("carries each Drift failure in the --json document like a Check's, the Step itself passing", () => {
    const run = runBin(["gate", "--json"], committedRepo({ steps: [FORMAT] }, { "notes.md": "draft\n" }))
    assert.equal(run.status, 1)
    const { status, steps, failures } = JSON.parse(run.stdout)
    assert.equal(status, "fail")
    assert.deepEqual(steps, [{ command: FORMAT, status: "pass", exitCode: 0, tail: null }])
    assert.deepEqual(failures, [
      { file: "notes.md", line: null, rule: "drift", message: `${JSON.stringify(FORMAT)} changed it`, remedy: REMEDY }
    ])
    assert.equal(run.stderr, "")
  })

  it("refuses --update-baseline after a Step drifted, as after any failure", () => {
    const ratchet = ".ai/file-size-ratchet.baseline.json"
    const baseline = `${JSON.stringify({ "src/fixed.ts": 600 })}\n`
    const files = { [ratchet]: baseline, "src/fixed.ts": "export const fixed = 1\n" }
    const root = committedRepo({ steps: ["touch new.md"], checks: { "file-size-ratchet": true } }, files)
    const run = runBin(["gate", "--update-baseline"], root)
    assert.equal(run.status, 1, run.stdout)
    assert.ok(
      lines(run.stdout).includes(`gate: baseline ${ratchet} not refreshed — a Step or another Check did not pass`),
      run.stdout
    )
    assert.equal(readFileSync(join(root, ratchet), "utf8"), baseline)
  })

  it("leaves no stamp for --cache after a run with Drift", () => {
    const root = committedRepo({ steps: ["echo ran >> ran", "touch new.md"] })
    assert.equal(runBin(["gate", "--cache"], root).status, 1)
    rmSync(join(root, "new.md"))
    assert.equal(runBin(["gate", "--cache"], root).status, 1)
    assert.equal(runs(root), 2)
  })

  it("names every file of a Step that writes more paths than fit in 1 MiB", () => {
    // 5000 paths of some 250 bytes each: more than spawnSync's default buffer holds.
    const many = "dir=out/$(printf 'd%.0s' $(seq 240)); mkdir -p $dir && cd $dir && seq 5000 | xargs touch"
    const run = runBin(["gate"], committedRepo({ steps: [many] }))
    assert.equal(run.status, 1, lines(run.stdout).slice(-2).join("\n"))
    assert.equal(lines(run.stdout).filter((line) => line.includes(": drift: ")).length, 5000)
    assert.equal(lines(run.stdout).at(-1), "gate: failed — 5000 failures")
  })

  it('exits 2 when it cannot record the tree, outside a git checkout, naming gate.drift "allow"', () => {
    const root = repo({ git: false, files: { [CONFIG]: { version: 1, gate: { steps: ["true"] } } } })
    const run = runBin(["gate"], root)
    assert.equal(run.status, 2, run.stdout)
    const [step, failure, ...rest] = timed(run.stdout)
    assert.equal(step, "gate: step true — pass (N s)")
    assert.match(failure ?? "", /^drift: cannot watch "true": git rev-parse: fatal: not a git repository/)
    assert.ok(failure?.endsWith(' — run the Gate in a git checkout, or set gate.drift to "allow"'), failure)
    assert.deepEqual(rest, ["gate: cannot run — 1 failure"])
  })
})

describe("dw-sdlc gate, stopped by a signal", () => {
  /** A command that marks it started and then waits, so a test signals it while it runs. */
  const WAITING = "echo started; touch started; sleep 30"

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    it(`prints what a Step printed when ${signal} stops it, runs nothing after it and exits 1`, async () => {
      const root = withGate({
        steps: [WAITING, "touch second-ran"],
        checks: { run: [{ name: "docs", command: "touch check-ran" }], primitives: true }
      })
      const run = await interrupted(root, ["gate"], signal)
      assert.equal(run.status, 1, run.stdout)
      assert.ok(!existsSync(join(root, "second-ran")), "a Step ran after the stopped one")
      assert.ok(!existsSync(join(root, "check-ran")), "a Check ran after the stopped Step")
      assert.deepEqual(timed(run.stdout), [
        `gate: step ${WAITING} — failed, stopped by ${signal} (N s); its last 50 lines:`,
        "  started",
        `step: ${JSON.stringify(WAITING)} was stopped by ${signal} — ${FAILED_REMEDY}`,
        "gate: failed — 1 failure"
      ])
    })
  }

  it("reports the Step stopped when SIGTERM reaches the Gate alone", async () => {
    const root = withGate({ steps: [WAITING, "touch second-ran"] })
    const run = await interrupted(root, ["gate"], "SIGTERM", "bin")
    assert.equal(run.status, 1, run.stdout)
    assert.ok(!existsSync(join(root, "second-ran")), "a Step ran after the stopped one")
    assert.equal(timed(run.stdout)[0], `gate: step ${WAITING} — failed, stopped by SIGTERM (N s); its last 50 lines:`)
  })

  it("carries the stopped Step with its tail in the --json document, stderr empty", async () => {
    const run = await interrupted(withGate({ steps: [WAITING, "true"] }), ["gate", "--json"], "SIGINT")
    assert.equal(run.status, 1, run.stdout)
    const { steps, failures } = JSON.parse(run.stdout)
    assert.deepEqual(
      steps.map(({ command, status, tail }: { command: string; status: string; tail: string[] | null }) => ({
        command,
        status,
        tail
      })),
      [
        { command: WAITING, status: "fail", tail: ["started"] },
        { command: "true", status: "skipped", tail: null }
      ]
    )
    assert.equal(failures[0].message, `${JSON.stringify(WAITING)} was stopped by SIGINT`)
    assert.equal(run.stderr, "")
  })

  it("runs no Check after a run Check a signal stops", async () => {
    const run = [
      { name: "waiting", command: WAITING },
      { name: "next", command: "touch next-ran" }
    ]
    const root = withGate({ checks: { run } })
    const result = await interrupted(root, ["gate"], "SIGINT")
    assert.equal(result.status, 1, result.stdout)
    assert.ok(!existsSync(join(root, "next-ran")), "a Check ran after the stopped one")
    assert.deepEqual(lines(result.stdout), [
      "gate: check waiting — failed, stopped by SIGINT; its last 50 lines:",
      "  started",
      `waiting: ${JSON.stringify(WAITING)} was stopped by SIGINT — ${FAILED_REMEDY}`,
      "gate: failed — 1 failure"
    ])
  })

  it("runs no Check after a run Check SIGINT ended, with no signal to the Gate", () => {
    // Stands for a Ctrl-C whose exit the Gate sees before its own signal.
    const run = [
      { name: "ended", command: "kill -INT $$" },
      { name: "next", command: "touch next-ran" }
    ]
    const root = withGate({ checks: { run, "markdown-refs": true } })
    const result = runBin(["gate"], root)
    assert.equal(result.status, 1, result.stdout)
    assert.ok(!existsSync(join(root, "next-ran")), "a Check ran after the ended one")
    assert.deepEqual(lines(result.stdout), [
      "gate: check ended — failed, stopped by SIGINT; it printed nothing",
      `ended: "kill -INT $$" was stopped by SIGINT — ${FAILED_REMEDY}`,
      "gate: failed — 1 failure"
    ])
  })

  it("compares no tree after a Step SIGINT ended, with no signal to the Gate", () => {
    const step = "touch new.md; kill -INT $$"
    const run = runBin(["gate"], committedRepo({ steps: [step] }))
    assert.equal(run.status, 1, run.stdout)
    assert.deepEqual(timed(run.stdout), [
      `gate: step ${step} — failed, stopped by SIGINT (N s); it printed nothing`,
      `step: ${JSON.stringify(step)} was stopped by SIGINT — ${FAILED_REMEDY}`,
      "gate: failed — 1 failure"
    ])
  })

  it("never reads green, nor stamps the cache, when its last Step signals the Gate", () => {
    const root = withGate({ steps: ["kill -INT $PPID"], checks: { "markdown-refs": true } })
    const first = runBin(["gate", "--cache"], root)
    assert.notEqual(first.status, 0, first.stdout)
    const second = runBin(["gate", "--cache"], root)
    assert.ok(!second.stdout.includes("cached"), second.stdout)
  })

  it("stops at once on a second signal when the first does not stop the Step", async () => {
    const root = withGate({ steps: ["trap '' INT; touch started; sleep 30"] })
    const gate = startBin(["gate"], root)
    let ended = false
    void gate.done.then(() => {
      ended = true
    })
    try {
      await until(() => existsSync(join(root, "started")))
      process.kill(-gate.group, "SIGINT")
      await new Promise((resolve) => setTimeout(resolve, 200))
      assert.ok(!ended, "the Gate ended on the first signal, which the Step ignored")
      process.kill(-gate.group, "SIGINT")
      const run = await gate.done
      assert.equal(run.signal, "SIGINT", run.stdout)
    } finally {
      killGroup(gate.group)
    }
  })
})

describe("dw-sdlc gate --verbose", () => {
  it("passes each command's output through as it runs, under a line naming it, and keeps no tail", () => {
    const root = withGate({
      steps: ["echo lint output", "echo lint found 3 problems >&2; exit 3"],
      checks: { "comment-budget": true }
    })
    const run = runBin(["gate", "--verbose"], root)
    assert.equal(run.status, 1)
    assert.deepEqual(lines(run.stdout), [
      "gate: step echo lint output",
      "lint output",
      "gate: step echo lint found 3 problems >&2; exit 3",
      `step: "echo lint found 3 problems >&2; exit 3" exited 3 — ${FAILED_REMEDY}`,
      "gate: failed — 1 failure"
    ])
    assert.deepEqual(lines(run.stderr), ["lint found 3 problems"])
  })

  it("names each Check before it runs", () => {
    const root = withGate({ checks: { run: [{ name: "docs", command: "echo docs output" }], "comment-budget": true } })
    const run = runBin(["gate", "--verbose"], root)
    assert.equal(run.status, 0, run.stdout)
    assert.deepEqual(lines(run.stdout), [
      "gate: check docs",
      "docs output",
      "gate: check comment-budget",
      "gate: green — 0 steps, 2 checks"
    ])
  })

  it("sends the commands' output and its own lines to stderr under --json, each tail null", () => {
    const root = withGate({ steps: ["echo step output; exit 1"] })
    const run = runBin(["gate", "--verbose", "--json"], root)
    assert.equal(run.status, 1)
    assert.deepEqual(JSON.parse(run.stdout).steps, [
      { command: "echo step output; exit 1", status: "fail", exitCode: 1, tail: null }
    ])
    assert.deepEqual(lines(run.stderr), ["gate: step echo step output; exit 1", "step output"])
  })
})

describe("dw-sdlc gate, the Checks", () => {
  it("runs every run Check even when one fails, prints what each failing one printed and exits 1", () => {
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
    assert.deepEqual(timed(run.stdout), [
      "gate: step true — pass (N s)",
      "gate: check first — failed, exit 1; its last 50 lines:",
      "  first is stale",
      "gate: check second — pass",
      "gate: check third — failed, exit 4; it printed nothing",
      `first: "echo first is stale; exit 1" exited 1 — ${FAILED_REMEDY}`,
      `third: "exit 4" exited 4 — ${FAILED_REMEDY}`,
      "gate: failed — 2 failures"
    ])
  })

  it("prints the last 50 lines of a failing run script, both streams in order, under its own line", () => {
    const root = withGate({ checks: { run: [{ name: "numbered", command: NUMBERED }] } })
    const run = runBin(["gate"], root)
    assert.equal(run.status, 1)
    assert.deepEqual(lines(run.stdout), [
      "gate: check numbered — failed, exit 3; its last 50 lines:",
      ...NUMBERED_TAIL.map((line) => `  ${line}`),
      `numbered: ${JSON.stringify(NUMBERED)} exited 3 — ${FAILED_REMEDY}`,
      "gate: failed — 1 failure"
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
    assert.equal(lines(run.stdout)[0], "gate: check missing — cannot run, exit 127; its last 50 lines:")
    assert.deepEqual(lines(run.stdout).slice(-3), [
      'missing: "dw-sdlc-no-such-command" was not found (exit 127) — install the command or fix gate.checks.run in the agentic config',
      `failing: "exit 1" exited 1 — ${FAILED_REMEDY}`,
      "gate: cannot run — 2 failures"
    ])
  })
})

describe("dw-sdlc gate, the Checks the package ships", () => {
  /** The Check names `gate.checks` takes beside `run`, in the schema's order. */
  const SHIPPED = Object.keys(
    JSON.parse(readFileSync(SCHEMA, "utf8")).properties.gate.properties.checks.properties
  ).filter((name) => name !== "run")

  it("runs every Check the schema names after the run Checks, in the schema's order, none stopping the next", () => {
    const shipped = Object.fromEntries(SHIPPED.map((name) => [name, true]))
    const root = withGate({ checks: { run: [{ name: "own", command: "exit 1" }], ...shipped } })
    const run = runBin(["gate", "--json"], root)
    const { checks } = JSON.parse(run.stdout)
    assert.deepEqual(
      checks.map(({ name, command }: { name: string; command: string | null }) => ({ name, command })),
      [{ name: "own", command: "exit 1" }, ...SHIPPED.map((name) => ({ name, command: null }))]
    )
    for (const { name, status, exitCode, tail } of checks.slice(1)) {
      assert.notEqual(status, "skipped", name)
      assert.equal(exitCode, { pass: 0, fail: 1, error: 2 }[status as string], name)
      assert.equal(tail, null, name)
    }
  })

  it("prints one line per Check it ran: pass, failed or cannot run", () => {
    const root = withGate(
      { checks: { primitives: true, "markdown-refs": true, "comment-budget": true } },
      { "src/a.ts": "// one\n// two\n// three\n// four\nexport const a = 1\n" }
    )
    const run = runBin(["gate"], root)
    assert.equal(run.status, 2)
    assert.deepEqual(lines(run.stdout).slice(0, 3), [
      "gate: check primitives — cannot run",
      "gate: check markdown-refs — pass",
      "gate: check comment-budget — failed"
    ])
  })

  it("skips them after a failed step", () => {
    const root = withGate({ steps: ["exit 1"], checks: { primitives: true } })
    const run = runBin(["gate", "--json"], root)
    assert.equal(run.status, 1)
    assert.deepEqual(JSON.parse(run.stdout).checks, [
      { name: "primitives", command: null, status: "skipped", exitCode: null, tail: null }
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
    const root = withGate({ steps: ["touch step-ran"] }, { ".gitignore": "step-ran\n" })
    const run = runBin(["gate", "--root", root], scratch("elsewhere"))
    assert.equal(run.status, 0, run.stdout)
    assert.ok(existsSync(join(root, "step-ran")))
  })
})

describe("dw-sdlc gate --json", () => {
  it("prints one document on stdout alone, the one the golden file holds, and nothing on stderr", () => {
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
    assert.equal(run.stderr, "")
  })

  it("carries a failed Step's last 50 lines as its tail, and null on the Step it skipped", () => {
    const run = runBin(["gate", "--json"], withGate({ steps: [NUMBERED, "true"] }))
    assert.equal(run.status, 1)
    assert.deepEqual(JSON.parse(run.stdout).steps, [
      { command: NUMBERED, status: "fail", exitCode: 3, tail: NUMBERED_TAIL },
      { command: "true", status: "skipped", exitCode: null, tail: null }
    ])
    assert.equal(run.stderr, "")
  })

  it("keeps a line a lone carriage return rewrote as a terminal shows it, the last text written over it", () => {
    const run = runBin(["gate", "--json"], withGate({ steps: ["printf 'step 1\\rstep 2\\nlast\\n'; exit 1"] }))
    assert.deepEqual(JSON.parse(run.stdout).steps[0].tail, ["step 2", "last"])
  })

  it("keeps no file of a Step's output on disk, not even while the Step runs", () => {
    const tmp = scratch("tmp")
    const run = runBin(["gate", "--json"], withGate({ steps: ['ls -A "$TMPDIR"; exit 1'] }), { TMPDIR: tmp })
    assert.deepEqual(JSON.parse(run.stdout).steps[0].tail, [])
    assert.deepEqual(readdirSync(tmp), [])
  })

  it("carries the command a layer sets over the inferred one, and null when there is none", () => {
    const set = withGate({ command: "make verify" }, { "package.json": CHECK_SCRIPT })
    assert.equal(JSON.parse(runBin(["gate", "--json"], set).stdout).command, "make verify")
    const none = withGate({})
    assert.equal(JSON.parse(runBin(["gate", "--json"], none).stdout).command, null)
  })
})

describe("dw-sdlc gate --cache", () => {
  const CACHED_LINE = "gate: green — cached, the tree matches the last green run"
  const GREEN_LINE = "gate: green — 1 step, 0 checks"
  const STEP_LINE = "gate: step echo ran >> ran — pass (N s)"

  it("skips a run whose tree matches the last green one, says so and exits 0", () => {
    const root = countingRepo()
    assert.equal(runBin(["gate", "--cache"], root).status, 0)
    const run = runBin(["gate", "--cache"], root)
    assert.equal(run.status, 0, run.stdout)
    assert.deepEqual(lines(run.stdout), [CACHED_LINE])
    assert.equal(runs(root), 1)
  })

  it("runs the Gate again on a changed tracked file and on a new untracked one, never on an ignored one", () => {
    const root = countingRepo({ "notes.md": "one\n" })
    git(root, "add", "-A")
    commit(root, "-m", "notes")
    runBin(["gate", "--cache"], root)
    write(join(root, "notes.md"), "two\n")
    assert.deepEqual(timed(runBin(["gate", "--cache"], root).stdout), [STEP_LINE, GREEN_LINE])
    write(join(root, "new.md"), "new\n")
    assert.deepEqual(timed(runBin(["gate", "--cache"], root).stdout), [STEP_LINE, GREEN_LINE])
    write(join(root, "ran"), "an ignored file changed\n")
    assert.deepEqual(lines(runBin(["gate", "--cache"], root).stdout), [CACHED_LINE])
  })

  it("runs the Gate again on an edit the stat cache cannot see, made in the second the index was written", () => {
    const root = countingRepo({ "notes.md": "one\n" })
    const notes = join(root, "notes.md")
    const then = new Date(Date.now() - 60_000)
    git(root, "config", "core.trustctime", "false")
    utimesSync(notes, then, then)
    git(root, "add", "-A")
    utimesSync(join(root, ".git", "index"), then, then)
    runBin(["gate", "--cache"], root)
    write(notes, "two\n")
    utimesSync(notes, then, then)
    assert.deepEqual(timed(runBin(["gate", "--cache"], root).stdout), [STEP_LINE, GREEN_LINE])
  })

  it("skips after a commit of the same content and leaves the index as it found it", () => {
    const root = countingRepo({ "notes.md": "one\n" })
    runBin(["gate", "--cache"], root)
    git(root, "add", "-A")
    commit(root, "-m", "notes")
    assert.deepEqual(lines(runBin(["gate", "--cache"], root).stdout), [CACHED_LINE])
    write(join(root, "new.md"), "new\n")
    runBin(["gate", "--cache"], root)
    assert.equal(git(root, "status", "--porcelain"), "?? new.md\n")
  })

  it("runs the Gate again after a failed run", () => {
    const root = withGate({ steps: ["echo ran >> ran; exit 1"] }, { ".gitignore": "ran\n" })
    assert.equal(runBin(["gate", "--cache"], root).status, 1)
    assert.equal(runBin(["gate", "--cache"], root).status, 1)
    assert.equal(runs(root), 2)
  })

  it("runs the Gate again after a run that rewrote a tracked file, then skips", () => {
    const steps = ["echo ran >> ran", "printf 'formatted\\n' > notes.md"]
    const root = withGate({ steps }, { ".gitignore": "ran\n", "notes.md": "draft\n" })
    git(root, "add", "-A")
    commit(root, "-m", "notes")
    runBin(["gate", "--cache"], root)
    runBin(["gate", "--cache"], root)
    assert.deepEqual(lines(runBin(["gate", "--cache"], root).stdout), [CACHED_LINE])
    assert.equal(runs(root), 2)
  })

  it("runs the Gate again when the local layer changes it, outside the tree", () => {
    const root = countingRepo()
    write(join(root, ".git", "info", "exclude"), `${LOCAL}\n`)
    runBin(["gate", "--cache"], root)
    write(join(root, LOCAL), JSON.stringify({ version: 1, gate: { steps: ["echo local >> ran"] } }))
    assert.deepEqual(timed(runBin(["gate", "--cache"], root).stdout), [
      "gate: step echo local >> ran — pass (N s)",
      GREEN_LINE
    ])
  })

  it("runs the whole Gate when it cannot fingerprint the tree, saying why", () => {
    const gate = { steps: ["echo ran >> ran"], drift: "allow" }
    const root = repo({ git: false, files: { [CONFIG]: { version: 1, gate } } })
    runBin(["gate", "--cache"], root)
    const run = runBin(["gate", "--cache"], root)
    assert.equal(run.status, 0, run.stdout)
    const [note, ...rest] = timed(run.stdout)
    assert.match(note ?? "", /^gate: cannot fingerprint the tree, so the whole Gate runs — git rev-parse: fatal: /)
    assert.deepEqual(rest, [STEP_LINE, GREEN_LINE])
    assert.equal(runs(root), 2)
  })

  it("runs the whole Gate when it cannot copy the index, saying why", { skip: process.getuid?.() === 0 }, () => {
    const root = countingRepo({}, { drift: "allow" })
    const index = join(root, ".git", "index")
    git(root, "add", "-A")
    chmodSync(index, 0o000)
    runBin(["gate", "--cache"], root)
    const run = runBin(["gate", "--cache"], root)
    chmodSync(index, 0o644)
    const [note, ...rest] = timed(run.stdout)
    assert.match(note ?? "", /^gate: cannot fingerprint the tree, so the whole Gate runs — EACCES: /)
    assert.deepEqual(rest, [STEP_LINE, GREEN_LINE])
    assert.equal(runs(root), 2)
  })

  it("keeps a stamp per worktree of one clone", () => {
    const main = countingRepo()
    git(main, "add", "-A")
    commit(main, "-m", "gate")
    const linked = join(scratch("worktree"), "linked")
    git(main, "worktree", "add", "-q", linked)
    runBin(["gate", "--cache"], main)
    assert.deepEqual(timed(runBin(["gate", "--cache"], linked).stdout), [STEP_LINE, GREEN_LINE])
    assert.deepEqual(lines(runBin(["gate", "--cache"], linked).stdout), [CACHED_LINE])
    assert.deepEqual(lines(runBin(["gate", "--cache"], main).stdout), [CACHED_LINE])
  })

  it("prints a skipped run under --json as a green document marked cached, with nothing run", () => {
    const root = countingRepo()
    runBin(["gate", "--cache"], root)
    const run = runBin(["gate", "--cache", "--json"], root)
    assert.equal(run.status, 0)
    assert.deepEqual(JSON.parse(run.stdout), {
      status: "pass",
      command: null,
      cached: true,
      steps: [],
      checks: [],
      failures: []
    })
    assert.equal(run.stderr, "")
  })

  it("stays off without the flag: every run runs and none is stamped", () => {
    const root = countingRepo()
    runBin(["gate"], root)
    runBin(["gate"], root)
    runBin(["gate", "--cache"], root)
    assert.equal(runs(root), 3)
  })

  it("exits 2 with its usage on --cache with --update-baseline", () => {
    const run = runBin(["gate", "--cache", "--update-baseline"], countingRepo())
    assert.equal(run.status, 2)
    assert.ok(run.stderr.startsWith("dw-sdlc gate: --cache and --update-baseline do not combine"), run.stderr)
    assert.match(run.stderr, /Usage: dw-sdlc gate/)
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
      `first: "exit 1" exited 1 — ${FAILED_REMEDY}`,
      `::error title=first::"exit 1" exited 1 — ${FAILED_REMEDY}`,
      `second: "exit 2" exited 2 — ${FAILED_REMEDY}`,
      `::error title=second::"exit 2" exited 2 — ${FAILED_REMEDY}`,
      "gate: failed — 2 failures"
    ])
  })

  it("keeps stdout one document under --json and prints the annotations on stderr", () => {
    const run = runBin(["gate", "--json"], withGate({ steps: ["exit 3"] }), ACTIONS)
    assert.equal(JSON.parse(run.stdout).status, "fail")
    assert.deepEqual(lines(run.stderr), [`::error title=step::"exit 3" exited 3 — ${FAILED_REMEDY}`])
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
    assert.match(run.stdout, /^ {2}gate +run the Gate/m)
    for (const name of ["check", "setup", "doctor", "config", "references sync", "references setup"]) {
      assert.match(run.stdout, new RegExp(`^ {2}${name} {2,}\\S`, "m"), name)
    }
  })

  it("exits 2 with its usage on no command, an unknown command or an unknown flag", () => {
    const cwd = scratch("bin")
    for (const [args, problem] of [
      [[], "dw-sdlc: no command given"],
      [["nope"], 'dw-sdlc: unknown command "nope"'],
      [["references"], 'dw-sdlc: unknown command "references"'],
      [["gate", "--nope"], "dw-sdlc gate: Unknown option '--nope'"]
    ] as const) {
      const run = runBin([...args], cwd)
      assert.equal(run.status, 2, args.join(" "))
      assert.ok(run.stderr.startsWith(problem), run.stderr)
      assert.match(run.stderr, /Usage: dw-sdlc/)
    }
  })
})
