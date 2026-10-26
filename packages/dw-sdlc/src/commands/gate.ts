// `dw-sdlc gate`: the Gate of a repository. The commands of `gate.steps` run in order from the
// repository root, each one's output passed through, and the first that fails ends the run; then every
// Check under `gate.checks` runs, none stopping the next. The report is one line per failure, or with
// `--json` one document on stdout while the commands' own output goes to stderr.

import { spawnSync } from "node:child_process"
import { parseArgs } from "node:util"

import { type Problem, repositoryRoot, resolveConfig } from "../agentic-config.ts"
import { annotation, type Failure, failureJson, failureLine } from "../report.ts"

export const summary = "run the Gate: gate.steps in order, then every Check under gate.checks"

const USAGE = `Usage: dw-sdlc gate [--json] [--root <dir>]

Runs the Gate of the repository holding --root (default: the current directory): each command of
gate.steps in order from the repository root, stopping at the first that fails, then every Check
under gate.checks. Prints one line per failure: the file where there is one, the rule, the remedy;
under GitHub Actions also a workflow annotation. --json prints one document instead and sends the
commands' own output to stderr.

Exit 0 when everything passes, 1 when a step or a Check fails, 2 when the Gate cannot run: an
invalid config layer, or a step or Check whose command the shell cannot find or execute.`

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
  config: "fix the file; the Gate runs once every layer is valid",
  failed: "fix what it printed above",
  steps: "install the command or fix gate.steps in the agentic config",
  run: "install the command or fix gate.checks.run in the agentic config"
}

function show(value: string): string {
  return JSON.stringify(value)
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
  return { file, rule: "config", message: path === "" ? message : `${path}: ${message}`, remedy: REMEDIES.config }
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

/** `error` when anything could not run, else `fail` when anything failed, else `pass`. */
function worst(outcomes: Outcome[]): Status {
  const statuses = new Set(outcomes.map(({ status }) => status))
  return statuses.has("error") ? "error" : statuses.has("fail") ? "fail" : "pass"
}

function runGate(root: string, json: boolean): GateReport {
  const log = json ? process.stderr : process.stdout
  const { config, problems } = resolveConfig(root)
  const command = config.gate.command ?? null
  if (problems.length > 0) {
    return { status: "error", command, steps: [], checks: [], failures: problems.map(configFailure) }
  }

  const failures: Failure[] = []
  const steps: StepReport[] = []
  let stopped = false
  for (const step of config.gate.steps) {
    if (stopped) {
      steps.push({ command: step, ...SKIPPED })
      continue
    }
    log.write(`gate: step ${step}\n`)
    const { detail, ...outcome } = runCommand(step, root, json)
    steps.push({ command: step, ...outcome })
    if (detail !== undefined) {
      const remedy = outcome.status === "error" ? REMEDIES.steps : REMEDIES.failed
      failures.push({ rule: "step", message: `${show(step)} ${detail}`, remedy })
      stopped = true
    }
  }

  const checks: CheckReport[] = []
  for (const check of config.gate.checks.run) {
    if (stopped) {
      checks.push({ ...check, ...SKIPPED })
      continue
    }
    log.write(`gate: check ${check.name}\n`)
    const { detail, ...outcome } = runCommand(check.command, root, json)
    checks.push({ ...check, ...outcome })
    if (detail !== undefined) {
      const remedy = outcome.status === "error" ? REMEDIES.run : REMEDIES.failed
      failures.push({ rule: check.name, message: `${show(check.command)} ${detail}`, remedy })
    }
  }

  return { status: worst([...steps, ...checks]), command, steps, checks, failures }
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
  const annotations = process.env.GITHUB_ACTIONS === "true" ? report.failures.map(annotation) : []
  if (cli.json) {
    const document = { ...report, failures: report.failures.map(failureJson) }
    process.stdout.write(`${JSON.stringify(document, null, 2)}\n`)
    // The runner reads workflow commands from stderr as from stdout, so stdout stays one document.
    for (const line of annotations) {
      process.stderr.write(`${line}\n`)
    }
  } else {
    const lines = [...report.failures.map(failureLine), ...annotations, verdict(report)]
    process.stdout.write(`${lines.join("\n")}\n`)
  }
  return EXIT_CODES[report.status]
}
