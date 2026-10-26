// `dw-sdlc gate`: the Gate of a repository, from the `gate` key of its resolved agentic config.

import { spawnSync } from "node:child_process"
import { parseArgs } from "node:util"

import { type Problem, repositoryRoot, resolveConfig } from "../agentic-config.ts"
import { annotation, type Failure, failureJson, failureLine } from "../report.ts"

export const summary = "run the Gate: the Steps of gate.steps in order, then every Check under gate.checks"

const USAGE = `Usage: dw-sdlc gate [--json] [--root <dir>]

Runs the Gate of the repository holding --root (default: the current directory): each Step of
gate.steps in order from the repository root, its output passed through, stopping at the first that
fails; then every Check under gate.checks, none stopping the next. Prints one line per failure: the
file where there is one, the rule, the remedy; under GitHub Actions each line is also a workflow
annotation. --json prints one document instead and sends the commands' own output to stderr.

Exit 0 when everything passes, 1 when a Step or a Check fails, 2 when the Gate cannot run: an
invalid config layer, or a Step or Check whose command the shell cannot find or execute.`

type Status = "pass" | "fail" | "error"
type Outcome = { status: Status | "skipped"; exitCode: number | null }
type StepReport = Outcome & { command: string }
type CheckReport = Outcome & { name: string; command: string }
type GateReport = {
  status: Status
  command: string | null
  steps: StepReport[]
  checks: CheckReport[]
  failures: Failure[]
}

const EXIT_CODES: Record<Status, number> = { pass: 0, fail: 1, error: 2 }
/** What the shell answers for a command it cannot find, and for one it cannot execute. */
const NOT_RUNNABLE: Record<number, string> = { 127: "was not found", 126: "could not be executed" }
const SKIPPED: Outcome = { status: "skipped", exitCode: null }

const REMEDIES = {
  invalidLayer: "fix the file; the Gate runs once every layer is valid",
  failed: "fix what it printed above",
  stepNotRunnable: "install the command or fix gate.steps in the agentic config",
  checkNotRunnable: "install the command or fix gate.checks.run in the agentic config"
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`
}

type Cli = { help: boolean; json: boolean; root: string | undefined }

function parseCli(argv: string[]): Cli | { error: string } {
  try {
    const { values } = parseArgs({
      args: argv,
      options: { help: { type: "boolean", short: "h" }, json: { type: "boolean" }, root: { type: "string" } }
    })
    return { help: values.help === true, json: values.json === true, root: values.root }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

function configFailure({ file, path, message }: Problem): Failure {
  const where = path === "" ? message : `${path}: ${message}`
  return { file, rule: "config", message: where, remedy: REMEDIES.invalidLayer }
}

/**
 * Runs `command` through `sh -c` from `root`, stdin closed and stderr passed through; stdout too, or
 * onto stderr when `--json` keeps stdout for the document. `detail` says what went wrong, when it did.
 */
function runCommand(command: string, root: string, json: boolean): Outcome & { detail?: string } {
  const result = spawnSync(command, { shell: true, cwd: root, stdio: ["ignore", json ? 2 : "inherit", "inherit"] })
  if (result.error !== undefined) {
    return { status: "error", exitCode: null, detail: `could not start: ${result.error.message}` }
  }
  if (result.status === 0) {
    return { status: "pass", exitCode: 0 }
  }
  if (result.status === null) {
    return { status: "fail", exitCode: null, detail: `was stopped by ${result.signal ?? "a signal"}` }
  }
  const notRunnable = NOT_RUNNABLE[result.status]
  if (notRunnable !== undefined) {
    return { status: "error", exitCode: result.status, detail: `${notRunnable} (exit ${result.status})` }
  }
  return { status: "fail", exitCode: result.status, detail: `exited ${result.status}` }
}

function worst(outcomes: Outcome[]): Status {
  const statuses = new Set(outcomes.map(({ status }) => status))
  return statuses.has("error") ? "error" : statuses.has("fail") ? "fail" : "pass"
}

function runGate(root: string, json: boolean): GateReport {
  const log = json ? process.stderr : process.stdout
  const { config, problems } = resolveConfig(root)
  const gateCommand = config.gate.command ?? null
  if (problems.length > 0) {
    return { status: "error", command: gateCommand, steps: [], checks: [], failures: problems.map(configFailure) }
  }

  const failures: Failure[] = []
  /** Runs one Step or Check and records its failure under `rule`, if it has one. */
  const runOne = (command: string, rule: string, notRunnable: string): Outcome => {
    const { detail, ...outcome } = runCommand(command, root, json)
    if (detail !== undefined) {
      const remedy = outcome.status === "error" ? notRunnable : REMEDIES.failed
      failures.push({ rule, message: `${JSON.stringify(command)} ${detail}`, remedy })
    }
    return outcome
  }

  const steps: StepReport[] = []
  let stopped = false
  for (const step of config.gate.steps) {
    if (stopped) {
      steps.push({ command: step, ...SKIPPED })
      continue
    }
    log.write(`gate: step ${step}\n`)
    const outcome = runOne(step, "step", REMEDIES.stepNotRunnable)
    steps.push({ command: step, ...outcome })
    stopped = outcome.status !== "pass"
  }

  const checks: CheckReport[] = []
  for (const check of config.gate.checks.run) {
    if (stopped) {
      checks.push({ ...check, ...SKIPPED })
      continue
    }
    log.write(`gate: check ${check.name}\n`)
    checks.push({ ...check, ...runOne(check.command, check.name, REMEDIES.checkNotRunnable) })
  }

  return { status: worst([...steps, ...checks]), command: gateCommand, steps, checks, failures }
}

function verdict(report: GateReport): string {
  if (report.status === "pass") {
    return `gate: green — ${plural(report.steps.length, "step")}, ${plural(report.checks.length, "check")}`
  }
  const failures = plural(report.failures.length, "failure")
  return report.status === "fail" ? `gate: failed — ${failures}` : `gate: cannot run — ${failures}`
}

export function run(argv: string[]): number {
  const cli = parseCli(argv)
  if ("error" in cli) {
    process.stderr.write(`dw-sdlc gate: ${cli.error}\n\n${USAGE}\n`)
    return 2
  }
  if (cli.help) {
    process.stdout.write(`${USAGE}\n`)
    return 0
  }

  const report = runGate(repositoryRoot(cli.root ?? process.cwd()), cli.json)
  const actions = process.env.GITHUB_ACTIONS === "true"
  if (cli.json) {
    const document = { ...report, failures: report.failures.map(failureJson) }
    process.stdout.write(`${JSON.stringify(document, null, 2)}\n`)
    // The runner reads workflow commands from stderr as from stdout, so stdout stays one document.
    for (const failure of actions ? report.failures : []) {
      process.stderr.write(`${annotation(failure)}\n`)
    }
  } else {
    const lines = report.failures.flatMap((failure) =>
      actions ? [failureLine(failure), annotation(failure)] : [failureLine(failure)]
    )
    process.stdout.write(`${[...lines, verdict(report)].join("\n")}\n`)
  }
  return EXIT_CODES[report.status]
}
