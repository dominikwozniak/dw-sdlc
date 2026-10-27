// `dw-sdlc gate`: the Gate of a repository, from the `gate` key of its resolved agentic config. The
// run and the report serve `dw-sdlc check` too, which judges one Check of it.

import { spawnSync } from "node:child_process"
import { parseArgs } from "node:util"

import { type Gate, type Problem, type RunCheck, repositoryRoot, resolveConfig } from "../agentic-config.ts"
import { CannotRun } from "../checks/check.ts"
import { CHECK_NAMES, type EnabledCheck, enabledChecks, shippedCheck } from "../checks/index.ts"
import { annotation, type Failure, failureJson, failureLine } from "../report.ts"

export const summary = "run the Gate: the Steps of gate.steps in order, then every Check under gate.checks"

const USAGE = `Usage: dw-sdlc gate [--json] [--root <dir>] [--update-baseline]

Runs the Gate of the repository holding --root (default: the current directory): each Step of
gate.steps in order from the repository root, its output passed through, stopping at the first that
fails; then every Check under gate.checks, the run scripts and then the Checks the package ships,
none stopping the next. Prints one line per failure: the file where there is one, the rule, the
remedy; under GitHub Actions each line is also a workflow annotation. --json prints one document
instead and sends the commands' own output to stderr.

--update-baseline then rewrites the baseline of each Ratchet, only when every Step and every other
Check passed, and only tighter: a file now within its limit leaves it and no file joins. Where there
is no baseline, it records one. The Ratchet is judged again on what it wrote.

Exit 0 when everything passes, 1 when a Step or a Check fails, 2 when the Gate cannot run: an
invalid config layer, a Step or Check whose command the shell cannot find or execute, or a Check
missing an input it reads.`

type Status = "pass" | "fail" | "error"
type Outcome = { status: Status | "skipped"; exitCode: number | null }
type StepReport = Outcome & { command: string }
/** A Check the package ships runs in this process: it has no command. */
type CheckReport = Outcome & { name: string; command: string | null }
type GateReport = {
  status: Status
  command: string | null
  steps: StepReport[]
  checks: CheckReport[]
  failures: Failure[]
}
/** A Check the package ships and what it found. */
type Judged = { check: EnabledCheck; outcome: Outcome; failures: Failure[] }
/** Where the Gate says what it runs: stdout, or stderr under `--json`. */
type Log = { write: (text: string) => unknown }
/** The Steps and Checks one run judges. */
type Selection = { steps: string[]; run: RunCheck[]; shipped: EnabledCheck[] }
/** A run of the whole Gate, or of the Checks named `only` alone: no Step, no progress line, no refresh. */
type RunOptions = { json: boolean } & ({ updateBaseline: boolean } | { only: string })

const EXIT_CODES: Record<Status, number> = { pass: 0, fail: 1, error: 2 }
/** What the shell answers for a command it cannot find, and for one it cannot execute. */
const NOT_RUNNABLE: Record<number, string> = { 127: "was not found", 126: "could not be executed" }
const SKIPPED: Outcome = { status: "skipped", exitCode: null }
/** One Check run by name says nothing before its result. */
const QUIET: Log = { write: () => true }

const REMEDIES = {
  invalidLayer: "fix the file; the Gate runs once every layer is valid",
  failed: "fix what it printed above",
  stepNotRunnable: "install the command or fix gate.steps in the agentic config",
  checkNotRunnable: "install the command or fix gate.checks.run in the agentic config",
  checkStopped: "fix what stopped it, or report it to dw-sdlc"
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`
}

type Cli = { help: boolean; json: boolean; root: string | undefined; updateBaseline: boolean }

function parseCli(argv: string[]): Cli | { error: string } {
  try {
    const { values } = parseArgs({
      args: argv,
      options: {
        help: { type: "boolean", short: "h" },
        json: { type: "boolean" },
        root: { type: "string" },
        "update-baseline": { type: "boolean" }
      }
    })
    return {
      help: values.help === true,
      json: values.json === true,
      root: values.root,
      updateBaseline: values["update-baseline"] === true
    }
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

/** What a Check that threw reports: the input it lacks, or what stopped it. */
function erred(check: EnabledCheck, error: unknown): Judged {
  const finding =
    error instanceof CannotRun
      ? error.finding
      : { message: `stopped: ${error instanceof Error ? error.message : String(error)}`, remedy: REMEDIES.checkStopped }
  return {
    check,
    outcome: { status: "error", exitCode: EXIT_CODES.error },
    failures: [{ rule: check.name, ...finding }]
  }
}

/** Runs one Check the package ships, its failures named by the Check; one it cannot judge is an error. */
function runShipped(check: EnabledCheck, root: string): Judged {
  try {
    const failures = check.run(root).map((finding) => ({ rule: check.name, ...finding }))
    const status = failures.length === 0 ? "pass" : "fail"
    return { check, outcome: { status, exitCode: EXIT_CODES[status] }, failures }
  } catch (error) {
    return erred(check, error)
  }
}

/**
 * Rewrites the baseline of each Ratchet while every Step, every run Check in `others` and every other
 * shipped Check passed, and judges the Ratchet again on what it wrote.
 */
function refreshBaselines(judged: Judged[], others: Outcome[], root: string, log: Log): void {
  if (!judged.some(({ check }) => check.baseline !== undefined)) {
    log.write("gate: no Ratchet is turned on, so no baseline to refresh\n")
    return
  }
  for (const [index, { check }] of judged.entries()) {
    if (check.baseline === undefined) {
      continue
    }
    const { file, refresh } = check.baseline
    const rest = [...others, ...judged.filter((_, at) => at !== index).map(({ outcome }) => outcome)]
    if (rest.some(({ status }) => status !== "pass")) {
      log.write(`gate: baseline ${file} not refreshed — a Step or another Check did not pass\n`)
      continue
    }
    try {
      log.write(`gate: baseline ${file} ${refresh(root)}\n`)
      judged[index] = runShipped(check, root)
    } catch (error) {
      if (error instanceof CannotRun) {
        log.write(`gate: baseline ${file} not refreshed — ${error.finding.message}; ${error.finding.remedy}\n`)
      } else {
        judged[index] = erred(check, error)
      }
    }
  }
}

function worst(outcomes: Outcome[]): Status {
  const statuses = new Set(outcomes.map(({ status }) => status))
  return statuses.has("error") ? "error" : statuses.has("fail") ? "fail" : "pass"
}

/**
 * Every Step and Check of `gate`, or with `only` no Step and the Checks of that name: the run Checks
 * and the shipped one, which runs on its defaults where the config leaves it off. No Check of that
 * name is a failure.
 */
function select(gate: Gate, only: string | undefined): Selection | Failure {
  if (only === undefined) {
    return { steps: gate.steps, run: gate.checks.run, shipped: enabledChecks(gate.checks) }
  }
  const scripts = gate.checks.run.filter((check) => check.name === only)
  const shipped = shippedCheck(only, gate.checks[only])
  if (scripts.length === 0 && shipped === undefined) {
    const names = [...gate.checks.run.map((check) => check.name), ...CHECK_NAMES].join(", ")
    return { rule: "check", message: `no Check is named ${JSON.stringify(only)}`, remedy: `name one of ${names}` }
  }
  return { steps: [], run: scripts, shipped: shipped === undefined ? [] : [shipped] }
}

export function runGate(root: string, options: RunOptions): GateReport {
  const { json } = options
  const only = "only" in options ? options.only : undefined
  const log: Log = only !== undefined ? QUIET : json ? process.stderr : process.stdout
  const { config, problems } = resolveConfig(root)
  const gateCommand = config.gate.command ?? null
  if (problems.length > 0) {
    return { status: "error", command: gateCommand, steps: [], checks: [], failures: problems.map(configFailure) }
  }
  const selected = select(config.gate, only)
  if ("rule" in selected) {
    return { status: "error", command: gateCommand, steps: [], checks: [], failures: [selected] }
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
  for (const step of selected.steps) {
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
  for (const check of selected.run) {
    if (stopped) {
      checks.push({ ...check, ...SKIPPED })
      continue
    }
    log.write(`gate: check ${check.name}\n`)
    checks.push({ ...check, ...runOne(check.command, check.name, REMEDIES.checkNotRunnable) })
  }
  const judged = selected.shipped.map((check): Judged => {
    if (stopped) {
      return { check, outcome: SKIPPED, failures: [] }
    }
    log.write(`gate: check ${check.name}\n`)
    return runShipped(check, root)
  })
  if ("updateBaseline" in options && options.updateBaseline) {
    refreshBaselines(judged, [...steps, ...checks], root, log)
  }
  for (const { check, outcome, failures: found } of judged) {
    failures.push(...found)
    checks.push({ name: check.name, command: null, ...outcome })
  }

  return { status: worst([...steps, ...checks]), command: gateCommand, steps, checks, failures }
}

/** The last line, after `label`: green with what ran, or failed or cannot run with how many failures. */
function verdict(label: string, report: GateReport): string {
  if (report.status === "pass") {
    return `${label}: green — ${plural(report.steps.length, "step")}, ${plural(report.checks.length, "check")}`
  }
  const failures = plural(report.failures.length, "failure")
  return report.status === "fail" ? `${label}: failed — ${failures}` : `${label}: cannot run — ${failures}`
}

/**
 * Prints `report`: a line per failure and the verdict under `label`, or one document under `json`; under
 * GitHub Actions each failure is also an annotation. Returns the exit code.
 */
export function printReport(report: GateReport, json: boolean, label: string): number {
  const actions = process.env.GITHUB_ACTIONS === "true"
  if (json) {
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
    process.stdout.write(`${[...lines, verdict(label, report)].join("\n")}\n`)
  }
  return EXIT_CODES[report.status]
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

  const { json, updateBaseline } = cli
  return printReport(runGate(repositoryRoot(cli.root ?? process.cwd()), { json, updateBaseline }), json, "gate")
}
