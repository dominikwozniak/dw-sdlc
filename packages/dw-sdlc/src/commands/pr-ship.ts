// `dw-sdlc pr ship [<n>]`, the Ship script: reads one pull request through gh, decides the Action it
// needs next, performs it when it is the script's and reads again, then answers the first Action that
// is not, as a line or one JSON document, with an exit code that names whose turn it is.

import { repositoryRoot, resolveConfig } from "../agentic-config.ts"
import { CannotRun, readArgs, usageError } from "../cannot-run.ts"
import {
  type Answer,
  decide,
  declaredPolicy,
  devCommand,
  hostArgs,
  isScriptAction,
  lineOf,
  type Policy,
  readyToMerge,
  type ScriptAction,
  type Status
} from "../pr/decide.ts"
import { gateMarks } from "../pr/gate-marks.ts"
import { gh, ghReads, namedProblem, nameItRemedy, now, type Reads, said } from "../pr/read.ts"
import type { PrState } from "../pr/state.ts"
import { shellLine } from "../shell-line.ts"

export const summary = "decide the Action one pull request needs next, as a line or JSON"

const USAGE = `Usage: dw-sdlc pr ship [<n>] [-R owner/name] [--merge] [--dry-run] [--json] [--verbose]

Reads pull request <n> through gh, the one of the current branch as gh pr view resolves it when <n>
is omitted, and answers the Action it needs next: the status, the action, whose turn it is and why.
A branch pushed under another name has an upstream of that name. Where gh resolves no pull request
for it, the script asks for the upstream's, and reads it only when its commits hold HEAD.
The script performs its own Actions, each at most once and then reads again: it updates a branch
GitHub reports BEHIND, marks a draft ready once nothing else holds it back, and squash merges a pull
request ready to merge under pr.merge auto in .ai/agentic.config.json or with --merge for this call;
under ask, the default, it parks with the merge command. Under auto the merge needs green CI or a Gate
mark, no open review thread, no change request, and the viewer's own pull request; nothing else is
waited for. GitHub reports BEHIND only under a rule that a branch be up to date; a branch only behind
its base merges as it is. A ci-pending wait rechecks when CI likely ends: the median time CI took on
the heads of the 10 newest merged pull requests, from the first start to the last completion of their
check runs, less the time since the first start on this head, between 60 and 600 s; 60 s when none
shows a run.
Each Action the call runs is listed under performed. Its ok says whether the read after it shows the
Action took effect, whatever gh's exit status; gh's exit status and stderr stand beside it, so an ok
false with exit 0 is an Action gh accepted that the read does not show yet. An update counts when
the head carries the base it read. When the read after an Action fails, the call exits 2 and names
each Action that ran with gh's exit, under performed too with --json: it may have landed, so do not
run it blind again. It exits 2 too when GitHub refuses the compare it reads after an update, which
decides whether the update merged the base in.
--dry-run performs nothing: it parks at the first Action the script would perform, under performed
with ok null.
CI unavailable is a GitHub Actions job on the head that failed with no step run, as GitHub leaves it
under a billing lock. Under the default pr.ciUnavailable ci it fails as any check does. Under gate,
with gate.steps the agent proves the head with dw-sdlc gate --mark, act prove-locally, and a Gate
mark, the dw-sdlc/gate success on the head, stands in for that job: the merge follows pr.merge as
on green CI. Without gate.steps it parks ci-unavailable, the merge the dev's. A job that ran a step
and failed is fix-ci under both.
Under footprint local in .ai/agentic.config.json or its local layer, the script reads no dw-sdlc/gate
status: the Gate marks come from .git/dw-sdlc/gates/<n>.json, under the common git dir, the file
gate --mark writes. Every decision is the one the status would give.
One line, or one document with --json; --verbose adds the state as read to the document under
facts. Needs an authenticated gh.

Exit 0 done, 10 the agent's turn, 20 wait, 30 the dev's turn, 2 when it cannot run.`

const EXIT: Record<Status, number> = { done: 0, act: 10, wait: 20, park: 30 }

type Cli = {
  help: boolean
  json: boolean
  verbose: boolean
  merge: boolean
  dryRun: boolean
  number: number | undefined
  repo: string | undefined
}

/**
 * A host action the call ran: `ok` whether the read after it shows the Action took effect, beside gh's
 * exit status and its stderr when it wrote any. Under --dry-run, which runs nothing, `ok` is null alone.
 */
type Performed = { action: ScriptAction; command: string } & (
  | { ok: boolean; exit: number; stderr?: string }
  | { ok: null; exit?: number; stderr?: string }
)

/**
 * A call that stopped after it ran Actions: what it ran stands in `performed`, `ok` null where no read
 * followed, and each Action is named with gh's exit under the problem.
 */
class Interrupted extends CannotRun {
  readonly performed: Performed[]
  constructor({ message, remedy }: CannotRun, performed: Performed[]) {
    const ran = performed.map(({ action, exit }) => `${action} ran (gh exit ${exit ?? "unknown"})`)
    super(message, remedy, { after: ran.join("\n") })
    this.performed = performed
  }
}

function parseCli(argv: string[]): Cli {
  const { values, positionals } = readArgs(
    {
      args: argv,
      allowPositionals: true,
      options: {
        help: { type: "boolean", short: "h" },
        json: { type: "boolean" },
        verbose: { type: "boolean" },
        merge: { type: "boolean" },
        "dry-run": { type: "boolean" },
        repo: { type: "string", short: "R" }
      }
    },
    USAGE
  )
  const [number, ...more] = positionals
  const { repo } = values
  if (values.help !== true) {
    if (more.length > 0) {
      throw usageError(`name one pull request, not ${positionals.length}`, USAGE)
    }
    const problem = namedProblem(number, repo)
    if (problem !== undefined) {
      throw usageError(problem, USAGE)
    }
  }
  return {
    help: values.help === true,
    json: values.json === true,
    verbose: values.verbose === true,
    merge: values.merge === true,
    dryRun: values["dry-run"] === true,
    number: number === undefined ? undefined : Number(number),
    repo
  }
}

/** How a reason names each script Action: what the script would do, the act, and the state it acts on. */
const NAMED: Record<ScriptAction, { would: string; act: string; still: string }> = {
  "update-branch": { would: "update the branch", act: "the update", still: "the branch still reads behind its base" },
  "mark-ready": { would: "mark it ready", act: "the mark-ready", still: "the pull request still reads as a draft" },
  merge: { would: "merge it", act: "the merge", still: "the pull request still reads open" }
}

/**
 * Whether the read after a script Action shows it took effect. gh's exit status cannot tell: a reply
 * lost on the way back exits non-zero after GitHub applied the Action.
 */
const TOOK: Record<ScriptAction, (before: PrState, after: PrState, reads: Reads) => boolean> = {
  // A moved head alone may be a push: the update took effect when the head carries the base it read.
  "update-branch": (before, after, reads) => after.head !== before.head && reads.carriesBase(before, after),
  "mark-ready": (_, after) => !after.draft,
  merge: (_, after) => after.state === "MERGED"
}

/**
 * Why an Action that ran comes round again: gh refused it, or accepted it and the read shows nothing yet,
 * or the effect is gone again.
 */
function reasonOf(
  { ok, exit, stderr = "" }: { ok: boolean; exit: number; stderr?: string },
  { act, still }: { act: string; still: string }
): string {
  if (ok) {
    return `${act} ran, and ${still}`
  }
  return exit === 0
    ? `gh accepted ${act}; the read does not show it yet`
    : `gh refused ${act}: ${said(stderr) || `gh exited ${exit}`}`
}

/** A script Action the call leaves to the dev, `reason` saying why; a merge parks as ready-to-merge. */
function handedOver(pr: PrState, answer: Answer, action: ScriptAction, reason: string): Answer {
  if (action === "merge") {
    return { ...readyToMerge(pr, reason), blockers: answer.blockers }
  }
  return { ...answer, status: "park", actor: "dev", reason, command: devCommand(pr, action) }
}

/** The pull request the call names, else this checkout's; none found stops the call with what to name. */
function readTarget(cli: Cli, root: string, reads: Reads): PrState {
  if (cli.number !== undefined || cli.repo !== undefined) {
    return reads.named(cli, "pr ship")
  }
  const found = reads.checkout(root)
  if ("problem" in found) {
    const nameIt = nameItRemedy("pr ship")
    throw new CannotRun(
      found.problem,
      found.lacksHead ? `push HEAD if it is this branch's pull request, else ${nameIt}` : nameIt
    )
  }
  return found
}

/** The command a script Action runs, and the run: gh, naming the repository, so the checkout plays no part. */
function scriptRun(
  pr: PrState,
  action: ScriptAction
): { command: string; perform: () => { status: number; stderr: string } } {
  const args = hostArgs(pr, action, true)
  return { command: shellLine(["gh", ...args]), perform: () => gh(args) }
}

/**
 * Reads and decides until the Action is not the script's. Each script Action runs at most once, then the
 * pull request is read again; under --dry-run, or when an Action comes round again, it is the dev's.
 */
function ship(cli: Cli, root: string, policy: Policy): { pr: PrState; answer: Answer; performed: Performed[] } {
  const reads = ghReads(policy.footprint === "local" ? gateMarks(root) : null)
  let pr = readTarget(cli, root, reads)
  const performed: Performed[] = []
  for (;;) {
    const answer = decide(pr, now(), policy)
    const { action } = answer
    if (!isScriptAction(action)) {
      return { pr, answer, performed }
    }
    const { command, perform } = scriptRun(pr, action)
    const { would } = NAMED[action]
    if (cli.dryRun) {
      performed.push({ action, command, ok: null })
      return {
        pr,
        answer: handedOver(pr, answer, action, `the script would ${would}; --dry-run performs nothing`),
        performed
      }
    }
    const done = performed.find((earlier) => earlier.action === action)
    // --dry-run returns before any Action runs, so an earlier one always carries gh's exit.
    if (done !== undefined && done.ok !== null) {
      const reason = reasonOf(done, NAMED[action])
      return { pr, answer: handedOver(pr, answer, action, reason), performed }
    }
    const { status, stderr } = perform()
    const before = pr
    const message = stderr.trim()
    const record = { action, command, exit: status, ...(message === "" ? {} : { stderr: message }) }
    try {
      pr = reads.again(pr)
      performed.push({ ...record, ok: TOOK[action](before, pr, reads) })
    } catch (error) {
      if (error instanceof CannotRun) {
        // The Action may have landed: the caller must not run it blind again.
        throw new Interrupted(error, [...performed, { ...record, ok: null }])
      }
      throw error
    }
  }
}

function documentOf(pr: PrState, answer: Answer, performed: Performed[], verbose: boolean): Record<string, unknown> {
  const facts = verbose ? { facts: pr } : {}
  return { pr: pr.url, head: pr.head, base: pr.base, ...answer, performed, ...facts }
}

export function run(argv: string[]): number {
  const cli = parseCli(argv)
  if (cli.help) {
    process.stdout.write(`${USAGE}\n`)
    return 0
  }
  // An invalid config layer resolves to ask, like every other strictest setting.
  const root = repositoryRoot(process.cwd())
  const { config } = resolveConfig(root)
  const policy: Policy = {
    ...declaredPolicy(config),
    ...(cli.merge ? { merge: "auto" } : {})
  }
  let shipped: ReturnType<typeof ship>
  try {
    shipped = ship(cli, root, policy)
  } catch (error) {
    if (cli.json && error instanceof Interrupted) {
      const { message, remedy, performed } = error
      process.stdout.write(`${JSON.stringify({ error: message, remedy, performed }, null, 2)}\n`)
    }
    throw error
  }
  const { pr, answer, performed } = shipped
  const output = cli.json ? JSON.stringify(documentOf(pr, answer, performed, cli.verbose), null, 2) : lineOf(answer)
  process.stdout.write(`${output}\n`)
  return EXIT[answer.status]
}
