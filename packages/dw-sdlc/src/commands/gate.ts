// `dw-sdlc gate`: the Gate of a repository, from the `gate` key of its resolved agentic config. The
// run and the report serve `dw-sdlc check` too, which judges one Check of it.

import { parseArgs } from "node:util"

import { type Gate, type Problem, type RunCheck, repositoryRoot, resolveConfig } from "../agentic-config.ts"
import { CannotRun } from "../checks/check.ts"
import { CHECK_NAMES, type EnabledCheck, enabledChecks, shippedCheck } from "../checks/index.ts"
import { watchDrift } from "../drift.ts"
import { type Fingerprint, fingerprint, isGreen, stampGreen } from "../gate-cache.ts"
import { annotation, type Failure, failureJson, failureLine } from "../report.ts"
import {
  holdingSignals,
  type Output,
  type Ran,
  runCommand,
  type Status,
  stoppedBy,
  TAIL_LINES
} from "../run-command.ts"

export const summary = "run the Gate: the Steps of gate.steps in order, then every Check under gate.checks"

const USAGE = `Usage: dw-sdlc gate [--json] [--verbose] [--root <dir>] [--update-baseline | --cache]

Runs the Gate of the repository holding --root (default: the current directory): each Step of
gate.steps in order from the repository root, stopping at the first that fails; then every Check
under gate.checks, the run scripts and then the Checks the package ships, none stopping the next.

Prints one line per Step with its time, one per Check, one per failure and a last line, green or
failed. A failure line names the file where there is one, the rule and the remedy; under GitHub
Actions it is also a workflow annotation. A Step or run script prints nothing of its own unless it
does not pass: then its last ${TAIL_LINES} lines, both streams in the order written, under its own
line. In a terminal a Step's line shows when it starts and takes its result when it ends.

Each Step runs between two records of every file git tracks or would track: a file the Step created,
changed or deleted is Drift, one failure per file, and the Steps after it still run. Ignored files
and edits made before the run never drift, and a Step a signal stopped is not compared. gate.drift
"allow" turns the watch off.

SIGINT or SIGTERM sent while a command runs stops it and everything after it, and the report still
prints: the stopped command's last lines, its failure line and the last line. A second signal, or one
sent while the Checks the package ships run, ends the Gate at once.

--verbose passes each command's output through as it runs instead, under a line naming the command,
and keeps no tail. --json prints the document alone; each Step and Check in it carries tail, the last
${TAIL_LINES} lines of a command that did not pass, null otherwise. With --verbose, under --json, the
commands' output goes to stderr and every tail is null.

--update-baseline then rewrites the baseline of each Ratchet, only when every Step and every other
Check passed and no Step drifted, and only tighter: a file now within its limit leaves it and no
file joins. Where there is no baseline, it records one. The Ratchet is judged again on what it wrote.

--cache skips the run when the working tree and the Gate match the last green run in this checkout.
Untracked files count and ignored files do not. Each worktree keeps its own stamp. A tree it cannot
hash runs the whole Gate.

Exit 0 when everything passes, 1 when a Step or a Check fails or a Step drifts, 2 when the Gate
cannot run: an invalid config layer, a Step or Check whose command the shell cannot find or execute,
a Check missing an input it reads, or a tree it cannot record for Drift.`

type Outcome = { status: Status | "skipped"; exitCode: number | null; tail: string[] | null }
type StepReport = Outcome & { command: string }
/** A Check the package ships runs in this process: it has no command. */
type CheckReport = Outcome & { name: string; command: string | null }
type GateReport = {
  status: Status
  command: string | null
  /** Present on a run the cache skipped. */
  cached?: true
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
/** How a run of the whole Gate goes: plain, refreshing each Ratchet's baseline, or cached on a green tree. */
type Mode = "plain" | "update-baseline" | "cache"
/** A run of the whole Gate, or of the Checks named `only` alone: no Step, no progress line, no refresh. */
type RunOptions = { json: boolean } & ({ mode: Mode; verbose: boolean } | { only: string })
type Kind = "step" | "check"
/** What a run prints around a Step or Check: before it runs, and once it has its result. */
type Progress = {
  start: (kind: Kind, subject: string) => void
  end: (kind: Kind, subject: string, outcome: Outcome | Ran) => void
}

const EXIT_CODES: Record<Status, number> = { pass: 0, fail: 1, error: 2 }
const SKIPPED: Outcome = { status: "skipped", exitCode: null, tail: null }
const SILENT: Log = { write: () => true }
const STATUS_WORDS: Record<Outcome["status"], string> = {
  pass: "pass",
  fail: "failed",
  error: "cannot run",
  skipped: "skipped"
}

const REMEDIES = {
  invalidLayer: "fix the file; the Gate runs once every layer is valid",
  failed: "fix what it printed above; run it alone for the full output",
  notRunnable: {
    step: "install the command or fix gate.steps in the agentic config",
    check: "install the command or fix gate.checks.run in the agentic config"
  },
  checkStopped: "fix what stopped it, or report it to dw-sdlc"
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`
}

type Cli = { help: boolean; json: boolean; verbose: boolean; root: string | undefined; mode: Mode }

function parseCli(argv: string[]): Cli | { error: string } {
  try {
    const { values } = parseArgs({
      args: argv,
      options: {
        help: { type: "boolean", short: "h" },
        json: { type: "boolean" },
        verbose: { type: "boolean" },
        root: { type: "string" },
        "update-baseline": { type: "boolean" },
        cache: { type: "boolean" }
      }
    })
    const refresh = values["update-baseline"] === true
    const cache = values.cache === true
    if (refresh && cache) {
      return { error: "--cache and --update-baseline do not combine: a refresh needs the Gate to run" }
    }
    const mode = refresh ? "update-baseline" : cache ? "cache" : "plain"
    const flags = { help: values.help === true, json: values.json === true, verbose: values.verbose === true }
    return { ...flags, root: values.root, mode }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

function configFailure({ file, path, message }: Problem): Failure {
  const where = path === "" ? message : `${path}: ${message}`
  return { file, rule: "config", message: where, remedy: REMEDIES.invalidLayer }
}

/**
 * What follows a Step's or Check's name once it ran: pass, failed or cannot run, with a command's exit,
 * a Step's time, and a captured tail indented under the line.
 */
function outcomeText(kind: Kind, outcome: Outcome | Ran): string {
  const isCommand = "seconds" in outcome
  const exit = isCommand && outcome.status !== "pass" ? howItEnded(outcome) : ""
  const time = isCommand && kind === "step" ? ` (${Math.round(outcome.seconds)} s)` : ""
  const head = `${STATUS_WORDS[outcome.status]}${exit}${time}`
  if (outcome.tail === null) {
    return head
  }
  if (outcome.tail.length === 0) {
    return `${head}; it printed nothing`
  }
  const tail = outcome.tail.map((line) => (line === "" ? "" : `  ${line}`))
  return [`${head}; its last ${TAIL_LINES} lines:`, ...tail].join("\n")
}

/** How a command that did not pass ended: the signal that stopped it, or its exit code. */
function howItEnded({ signal, exitCode }: Ran): string {
  if (signal !== null) {
    return `, stopped by ${signal}`
  }
  return exitCode === null ? "" : `, exit ${exitCode}`
}

function none(): void {}

/** Whether a Step's line goes out before it runs, to take its result in place: only in a terminal. */
function live(kind: Kind): boolean {
  return kind === "step" && process.stdout.isTTY
}

/**
 * Quiet, the Gate prints each result, a Step's name first when stdout is a terminal; `--verbose` names
 * each command before its output; `--json` prints neither. One Check run by name prints only a tail.
 */
function progressOf(options: RunOptions, log: Log): Progress {
  if ("only" in options) {
    const end = (kind: Kind, subject: string, outcome: Outcome | Ran): void => {
      if (!options.json && outcome.tail !== null) {
        process.stdout.write(`${kind} ${subject} — ${outcomeText(kind, outcome)}\n`)
      }
    }
    return { start: none, end }
  }
  if (options.verbose) {
    return { start: (kind, subject) => log.write(`gate: ${kind} ${subject}\n`), end: none }
  }
  if (options.json) {
    return { start: none, end: none }
  }
  return {
    start: (kind, subject) => {
      if (live(kind)) {
        process.stdout.write(`gate: ${kind} ${subject}`)
      }
    },
    end: (kind, subject, outcome) => {
      process.stdout.write(`${live(kind) ? "" : `gate: ${kind} ${subject}`} — ${outcomeText(kind, outcome)}\n`)
    }
  }
}

/** What a Check that threw reports: the input it lacks, or what stopped it. */
function erred(check: EnabledCheck, error: unknown): Judged {
  const finding =
    error instanceof CannotRun
      ? error.finding
      : { message: `stopped: ${error instanceof Error ? error.message : String(error)}`, remedy: REMEDIES.checkStopped }
  return {
    check,
    outcome: { status: "error", exitCode: EXIT_CODES.error, tail: null },
    failures: [{ rule: check.name, ...finding }]
  }
}

/** Runs one Check the package ships, its failures named by the Check; one it cannot judge is an error. */
function runShipped(check: EnabledCheck, root: string): Judged {
  try {
    const failures = check.run(root).map((finding) => ({ rule: check.name, ...finding }))
    const status = failures.length === 0 ? "pass" : "fail"
    return { check, outcome: { status, exitCode: EXIT_CODES[status], tail: null }, failures }
  } catch (error) {
    return erred(check, error)
  }
}

/**
 * Rewrites the baseline of each Ratchet while every Step, every run Check and the watch for Drift in
 * `others` and every other shipped Check passed, and judges the Ratchet again on what it wrote.
 * Returns a line on each.
 */
function refreshBaselines(judged: Judged[], others: Pick<Outcome, "status">[], root: string): string[] {
  if (!judged.some(({ check }) => check.baseline !== undefined)) {
    return ["gate: no Ratchet is turned on, so no baseline to refresh"]
  }
  const notes: string[] = []
  for (const [index, { check }] of judged.entries()) {
    if (check.baseline === undefined) {
      continue
    }
    const { file, refresh } = check.baseline
    const rest = [...others, ...judged.filter((_, at) => at !== index).map(({ outcome }) => outcome)]
    if (rest.some(({ status }) => status !== "pass")) {
      notes.push(`gate: baseline ${file} not refreshed — a Step or another Check did not pass`)
      continue
    }
    try {
      notes.push(`gate: baseline ${file} ${refresh(root)}`)
      judged[index] = runShipped(check, root)
    } catch (error) {
      if (error instanceof CannotRun) {
        notes.push(`gate: baseline ${file} not refreshed — ${error.finding.message}; ${error.finding.remedy}`)
      } else {
        judged[index] = erred(check, error)
      }
    }
  }
  return notes
}

function worst(outcomes: Pick<Outcome, "status">[]): Status {
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

export async function runGate(root: string, options: RunOptions): Promise<GateReport> {
  const { json } = options
  const only = "only" in options ? options.only : undefined
  const mode = "mode" in options ? options.mode : undefined
  const log: Log = only !== undefined ? SILENT : json ? process.stderr : process.stdout
  const progress = progressOf(options, log)
  const output: Output = "verbose" in options && options.verbose ? (json ? "stderr" : "stdout") : "capture"
  const { config, problems } = resolveConfig(root)
  const gateCommand = config.gate.command ?? null
  if (problems.length > 0) {
    return { status: "error", command: gateCommand, steps: [], checks: [], failures: problems.map(configFailure) }
  }
  const selected = select(config.gate, only)
  if ("rule" in selected) {
    return { status: "error", command: gateCommand, steps: [], checks: [], failures: [selected] }
  }

  let toStamp: Fingerprint | undefined
  if (mode === "cache") {
    const found = fingerprint(root, config.gate)
    if ("error" in found) {
      log.write(`gate: cannot fingerprint the tree, so the whole Gate runs — ${found.error}\n`)
    } else if (isGreen(found)) {
      return { status: "pass", command: gateCommand, cached: true, steps: [], checks: [], failures: [] }
    } else {
      toStamp = found
    }
  }

  const failures: Failure[] = []
  const watch = watchDrift(root, config.gate)
  /** Runs one Step or Check, prints its progress and records its failure under `rule`, if it has one. */
  const runOne = async (kind: Kind, subject: string, command: string): Promise<Outcome> => {
    progress.start(kind, subject)
    const ran = await runCommand(command, root, output)
    progress.end(kind, subject, ran)
    if (ran.detail !== undefined) {
      const remedy = ran.status === "error" ? REMEDIES.notRunnable[kind] : REMEDIES.failed
      failures.push({
        rule: kind === "step" ? "step" : subject,
        message: `${JSON.stringify(command)} ${ran.detail}`,
        remedy
      })
    }
    return { status: ran.status, exitCode: ran.exitCode, tail: ran.tail }
  }

  // While commands run, SIGINT and SIGTERM stop the one running and every one after it, and the report
  // still prints. The Checks the package ships run in this process, where a signal ends the Gate at once.
  const commands = await holdingSignals(async () => {
    let failedStep = false
    const halted = (): boolean => failedStep || stoppedBy() !== undefined
    const steps: StepReport[] = []
    for (const step of selected.steps) {
      const watched = halted() ? undefined : await watch.step(step, () => runOne("step", step, step))
      failures.push(...(watched?.failures ?? []))
      const outcome: Outcome = watched?.result ?? SKIPPED
      steps.push({ command: step, ...outcome })
      failedStep ||= outcome.status !== "pass"
    }
    const checks: CheckReport[] = []
    for (const check of selected.run) {
      checks.push({ ...check, ...(halted() ? SKIPPED : await runOne("check", check.name, check.command)) })
    }
    return { steps, checks, halted: halted() }
  })
  const { steps, checks } = commands
  const late = commands.halted ? undefined : stoppedBy()
  if (late !== undefined) {
    // It landed after the last command, which it could not stop: it ends the Gate as in the shipped Checks.
    process.kill(process.pid, late)
  }
  const stopped = commands.halted
  const judged = selected.shipped.map((check): Judged => {
    if (stopped) {
      return { check, outcome: SKIPPED, failures: [] }
    }
    progress.start("check", check.name)
    return runShipped(check, root)
  })
  const drift = { status: watch.status() }
  const notes = mode === "update-baseline" ? refreshBaselines(judged, [...steps, ...checks, drift], root) : []
  // A Ratchet's result is printed after its refresh, which judges it again.
  for (const { check, outcome, failures: found } of judged) {
    if (outcome.status !== "skipped") {
      progress.end("check", check.name, outcome)
    }
    failures.push(...found)
    checks.push({ name: check.name, command: null, ...outcome })
  }
  for (const note of notes) {
    log.write(`${note}\n`)
  }

  const status = worst([...steps, ...checks, drift])
  // Stamped with the fingerprint taken before the run: a Gate that changed the tree runs again next time.
  if (status === "pass" && toStamp !== undefined) {
    stampGreen(toStamp)
  }
  return { status, command: gateCommand, steps, checks, failures }
}

/** The last line, after `label`: green with what ran, or failed or cannot run with how many failures. */
function verdict(label: string, report: GateReport): string {
  if (report.cached === true) {
    return `${label}: green — cached, the tree matches the last green run`
  }
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

export async function run(argv: string[]): Promise<number> {
  const cli = parseCli(argv)
  if ("error" in cli) {
    process.stderr.write(`dw-sdlc gate: ${cli.error}\n\n${USAGE}\n`)
    return 2
  }
  if (cli.help) {
    process.stdout.write(`${USAGE}\n`)
    return 0
  }

  const { json, verbose, mode } = cli
  const report = await runGate(repositoryRoot(cli.root ?? process.cwd()), { json, verbose, mode })
  return printReport(report, json, "gate")
}
