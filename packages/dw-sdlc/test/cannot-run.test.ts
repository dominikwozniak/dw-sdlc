// What stops a command before its verdict, as the bin answers it: exit 2, the line
// `dw-sdlc <command>: <problem> — <remedy>`, and the command's usage under a command line it cannot read.

import assert from "node:assert/strict"
import { join } from "node:path"
import { describe, it } from "node:test"

import { CannotRun, readArgs, usageError } from "../src/cannot-run.ts"
import { lines, repo, runBin, runInProcess, scratch, write } from "./harness.ts"

const OPTIONS = { help: { type: "boolean", short: "h" } } as const

describe("CannotRun", () => {
  it("keeps the remedy it names, and takes one where it names none", () => {
    const named = new CannotRun("hc ls failed", "check hc --version")
    assert.equal(named.orRemedy("check hc, then call again"), named)
    const bare = new CannotRun("hc ls failed", undefined, { file: "x.json" }).orRemedy("check hc, then call again")
    assert.deepEqual(
      [bare.message, bare.remedy, bare.detail],
      ["hc ls failed", "check hc, then call again", { file: "x.json" }]
    )
  })

  it("reads a command line, and stops at one it cannot read with the usage after an empty line", () => {
    assert.equal(readArgs({ args: ["-h"], options: OPTIONS }, "Usage: x").values.help, true)
    assert.throws(
      () => readArgs({ args: ["--nope"], options: OPTIONS }, "Usage: x"),
      (error: unknown) => {
        assert.ok(error instanceof CannotRun)
        assert.match(error.message, /'--nope'/)
        assert.deepEqual([error.remedy, error.detail], [undefined, { after: "\nUsage: x" }])
        return true
      }
    )
    assert.deepEqual(usageError("name one", "Usage: x").detail, { after: "\nUsage: x" })
  })
})

describe("dw-sdlc when a command cannot run, in this process", () => {
  it("prints the problem and its remedy under the command's name, exit 2", () => {
    const outside = repo({ git: false })
    for (const [args, line] of [
      [["sweep"], `dw-sdlc sweep: no git repository holds ${outside} — run it from the main checkout`],
      [["recap"], `dw-sdlc recap: no git repository holds ${outside} — run it from a checkout`],
      [
        ["worker", "ls"],
        "dw-sdlc worker ls: outside herdr: $HC_TERMINAL_ID is not set — run it in a terminal herdr started, where the Lead has an address"
      ]
    ] as const) {
      const run = runInProcess([...args], outside)
      assert.deepEqual([run.status, run.stdout, lines(run.stderr)], [2, "", [line]], args.join(" "))
    }
  })

  it("prints the usage under a command line it cannot read, where the command once left the process", () => {
    const root = repo()
    for (const [args, problem, usage] of [
      [["config", "a.json", "b.json"], "dw-sdlc config: at most one file", "Usage: dw-sdlc config"],
      [
        ["setup", "--convention", "jira"],
        "dw-sdlc setup: --convention must be ticket-key or conventional, not 'jira'",
        "Usage: dw-sdlc setup"
      ],
      [
        ["references", "setup", "--force"],
        "dw-sdlc references setup: Unknown option '--force'",
        "Usage: dw-sdlc references setup"
      ]
    ] as const) {
      const run = runInProcess([...args], root)
      assert.equal(run.status, 2, run.stderr)
      const [first = "", empty, next = ""] = run.stderr.split("\n")
      assert.ok(first.startsWith(problem), first)
      assert.deepEqual([empty, next.startsWith(usage)], ["", true], run.stderr)
    }
  })

  it("leaves config's own problems at exit 1, on its own line", () => {
    const run = runInProcess(["config", "missing.json"], repo())
    assert.equal(run.status, 1)
    assert.match(lines(run.stderr)[0] ?? "", /^dw-sdlc config: ENOENT: no such file or directory/)
  })
})

describe("dw-sdlc at a --root that names no directory", () => {
  const ROOT_REMEDY = "pass --root a directory inside the repository"
  /** Each command that takes --root, by name, with the arguments it needs beside it. */
  const COMMANDS: [string, string[]][] = [
    ["gate", []],
    ["check", ["markdown-refs"]],
    ["primitives", ["--paths", "README.md"]],
    ["config", []],
    ["doctor", []],
    ["setup", ["--dry-run"]],
    ["references setup", ["--dry-run"]]
  ]

  it("stops every command that takes --root, exit 2, before it judges or writes anything", () => {
    const file = join(scratch("root"), "file")
    write(file, "")
    for (const root of [join(scratch("root"), "no-such-dir"), file]) {
      for (const [name, args] of COMMANDS) {
        const run = runBin([...name.split(" "), ...args, "--root", root], repo())
        assert.deepEqual(
          [run.status, run.stdout, lines(run.stderr)],
          [2, "", [`dw-sdlc ${name}: --root ${root} is not a directory — ${ROOT_REMEDY}`]],
          `${name} --root ${root}`
        )
      }
    }
  })
})
