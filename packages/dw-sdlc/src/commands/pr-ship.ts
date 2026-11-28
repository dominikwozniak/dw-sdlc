// `dw-sdlc pr ship [<n>]`, the Ship script: reads one pull request through gh, decides the Action it
// needs next, performs it when it is the script's and reads again, then answers the first Action that
// is not, as a line or one JSON document, with an exit code that names whose turn it is.

import { repositoryRoot, resolveConfig } from "../agentic-config.ts"
import { CannotRun, readArgs, usageError } from "../cannot-run.ts"
import { readCheckout, withCheckout } from "../pr/checkout.ts"
import {
  type Answer,
  decide,
  declaredPolicy,
  lineOf,
  type Policy,
  readyToMerge,
  type Status,
  type Step
} from "../pr/decide.ts"
import { withLanded } from "../pr/done.ts"
import { gateMarks } from "../pr/gate-marks.ts"
import { devCommand, hostArgs, isScriptAction, type ScriptAction } from "../pr/host.ts"
import { gh, ghReads, namedProblem, nameItRemedy, type Reads, said } from "../pr/read.ts"
import type { PrState } from "../pr/state.ts"
import { type WaitClock, waitClock } from "../pr/wait.ts"
import { shellLine } from "../shell-line.ts"

export const summary = "decide the Action one pull request needs next, as a line or JSON"

const USAGE = `Usage: dw-sdlc pr ship [<n>] [-R owner/name] [--merge] [--without-ci] [--dry-run] [--wait] [--json] [--verbose]

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
--wait polls inside the script, every recheckAfter, and prints nothing until it returns one document,
the first answer that is not wait, so a wait costs one turn of the agent. Its limit is the 40 min CI
budget: a ci-pending wait past the budget answers park ci-stuck, and at its limit --wait answers wait
again, with the same step, this call again. Under DW_SDLC_NOW it sleeps nothing: each poll moves its
own clock on by recheckAfter. Run it in the background; the exit is the turn.
The CI limit is three heads in a row whose CI failed, the head counted: the third parks ci-limit, the
dev's turn, with the failing checks under details.checks and the dev's two ways on in next, fix it or say
"merge without CI". The count reads the last 100 commits of the pull request, each with its CI state. A
head the update-branch merge made counts; CI unavailable that no Gate mark stands in for counts; a green
head, or a head a Gate mark stands on, resets the count; a commit no check reported on, or whose checks
all skipped or still run, counts for nothing. A rebase or a force push rewrites the history and restarts
the count. A rerun of failed jobs is no head and never counts: red again on the same head is fix-ci.
CI unavailable is a GitHub Actions job on the head that failed with no step run, as GitHub leaves it
under a billing lock. Under the default pr.ciUnavailable ci it fails as any check does. Under gate,
with gate.steps the agent proves the head with dw-sdlc gate --mark, act prove-locally, and a Gate
mark, the dw-sdlc/gate success on the head, stands in for that job: the merge follows pr.merge as
on green CI. Without gate.steps it parks ci-unavailable, the merge the dev's. A job that ran a step
and failed is fix-ci under both.
--without-ci carries the dev's word "merge without CI" for this call. A Gate mark on the head stands in
for CI, whatever CI says: without one the answer is act prove-locally, with dw-sdlc gate --mark as its
step, and a red Gate is fixed and pushed as under fix-ci. CI unavailable answers prove-locally too,
with gate.steps or without. It moves aside the CI rows only, fix-ci, unverified, ci-pending, ci-stuck
and ci-limit; conflicts, threads, changes requested, a required approval, a draft, another author's
pull request and a partial read hold the merge under it too. It does not imply
--merge: the merge follows pr.merge. Every merge it runs or names for the dev is gh pr merge <n>
--admin --squash --match-head-commit <head>, since gh turns on auto-merge in place of merging while
required checks have not passed. A merge GitHub refuses, as for a viewer whose role cannot bypass the
rules, parks ready-to-merge with that command as the dev's step. Without --without-ci no merge carries
--admin.
Under footprint local in .ai/agentic.config.json or its local layer, the script reads no dw-sdlc/gate
status: the Gate marks come from .git/dw-sdlc/gates/<n>.json, under the common git dir, the file
gate --mark writes. Every decision is the one the status would give.
Before it hands the agent a fix (fix-conflicts, fix-ci, address-review, prove-locally) the script checks
the checkout, unless -R names the pull request. On the pull request's branch, by its own name or its
upstream's, behind the head GitHub holds, git pull --rebase comes first in next. On another branch, a detached HEAD, or
with a commit the pull request lacks, the answer is park wrong-checkout: the one step is the dev's
git switch <branch>, and the reason names where the checkout is and where it should be.
At done the script finishes the Landed branch, unless -R names the pull request. In the main checkout
the one agent step is git switch <base> && git pull --rebase && git branch -D <branch>, holding only
what the state allows: no git switch when the checkout is on another branch, no -D when the branch is
not local or its tip is not the merged head, which a do step then says. While the head ref still
stands on the remote, git push origin --delete <branch> follows as the dev's step: the remote branch
goes through the repository's delete_branch_on_merge, never --delete-branch. A fork's branch is named
nowhere. In a linked worktree the one step is the dev's /sdlc-sweep.
Every answer carries next, the steps to follow in order, and each blocker carries its own next, so
one push can answer every blocker. A step is by agent or by dev. { by, run } is an exact command: for
the agent a shell command, for the dev what they type, a shell command or a slash command. { by, do }
is one line of judgement, carried out on details: the failing checks under details.checks, each with
its log command, and the threads under details.threads, each with a resolve command and a reply command
whose only blank is <text>. The agent takes its steps in order and prints the dev's, never runs them.
At wait, next is this call again with --wait --json. A park with a command for the dev has one by dev
step; a park with none has an empty next, and its reason says whose move it is. Exit 2 has no next.
One line, or one document with --json; the line is the label and the reason, the recheck, then each
step of next in order, marked agent or dev. --verbose adds the state as read to the document under
facts. Needs an authenticated gh.

Exit 0 done, 10 the agent's turn, 20 wait, 30 the dev's turn, 2 when it cannot run.`

const EXIT: Record<Status, number> = { done: 0, act: 10, wait: 20, park: 30 }

type Cli = {
  help: boolean
  json: boolean
  verbose: boolean
  merge: boolean
  withoutCi: boolean
  dryRun: boolean
  wait: boolean
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
        "without-ci": { type: "boolean" },
        "dry-run": { type: "boolean" },
        wait: { type: "boolean" },
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
    withoutCi: values["without-ci"] === true,
    dryRun: values["dry-run"] === true,
    wait: values.wait === true,
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
function handedOver(pr: PrState, policy: Policy, answer: Answer, action: ScriptAction, reason: string): Answer {
  if (action === "merge") {
    return { ...readyToMerge(pr, policy, reason), blockers: answer.blockers }
  }
  const next: Step[] = [{ by: "dev", run: devCommand(pr, action, policy) }]
  return { ...answer, status: "park", actor: "dev", reason, next }
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
  action: ScriptAction,
  policy: Policy
): { command: string; perform: () => { status: number; stderr: string } } {
  const args = hostArgs(pr, action, true, policy)
  return { command: shellLine(["gh", ...args]), perform: () => gh(args) }
}

/**
 * Reads and decides until the Action is not the script's. Each script Action runs at most once, then the
 * pull request is read again; under --dry-run, or when an Action comes round again, it is the dev's.
 */
function ship(
  cli: Cli,
  root: string,
  policy: Policy,
  clock: WaitClock
): { pr: PrState; answer: Answer; performed: Performed[] } {
  const reads = ghReads(policy.footprint === "local" ? gateMarks(root) : null)
  // -R names the pull request from anywhere: the checkout is then no part of the call.
  const checkout = cli.repo === undefined ? readCheckout(root) : undefined
  let pr = readTarget(cli, root, reads)
  const performed: Performed[] = []
  for (;;) {
    const answer = decide(pr, clock.time(), policy)
    const { action } = answer
    if (!isScriptAction(action)) {
      return { pr, answer: withLanded(root, pr, withCheckout(root, pr, answer, checkout), checkout), performed }
    }
    const { command, perform } = scriptRun(pr, action, policy)
    const { would } = NAMED[action]
    if (cli.dryRun) {
      performed.push({ action, command, ok: null })
      return {
        pr,
        answer: handedOver(pr, policy, answer, action, `the script would ${would}; --dry-run performs nothing`),
        performed
      }
    }
    const done = performed.find((earlier) => earlier.action === action)
    // --dry-run returns before any Action runs, so an earlier one always carries gh's exit.
    if (done !== undefined && done.ok !== null) {
      const reason = reasonOf(done, NAMED[action])
      return { pr, answer: handedOver(pr, policy, answer, action, reason), performed }
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

/**
 * One call of `ship`, or under --wait the polls of it: after each answer of `wait`, the clock lets its
 * recheck pass and the pull request is read again, until the answer is not a wait or the limit is reached.
 * What each poll performed stands in the one document.
 */
function shipUntilAnswered(
  cli: Cli,
  root: string,
  policy: Policy
): { pr: PrState; answer: Answer; performed: Performed[] } {
  const clock = waitClock()
  const performed: Performed[] = []
  for (;;) {
    let shipped: ReturnType<typeof ship>
    try {
      shipped = ship(cli, root, policy, clock)
    } catch (error) {
      // An earlier poll may have run an Action: the document names it whatever stops a later poll.
      if (error instanceof CannotRun && performed.length > 0) {
        const later = error instanceof Interrupted ? error.performed : []
        throw new Interrupted(new CannotRun(error.message, error.remedy), [...performed, ...later])
      }
      throw error
    }
    performed.push(...shipped.performed)
    const { answer } = shipped
    if (!cli.wait || answer.status !== "wait" || clock.spent()) {
      return { ...shipped, performed }
    }
    clock.pass(answer.recheckAfter)
  }
}

/** The step at a wait: this call again with --wait --json, whose output is the next answer. */
function waitStep(argv: string[]): Step {
  const kept = argv.filter((arg) => arg !== "--json" && arg !== "--wait")
  return { by: "agent", run: shellLine(["dw-sdlc", "pr", "ship", ...kept, "--wait", "--json"]) }
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
    ...(cli.merge ? { merge: "auto" } : {}),
    withoutCi: cli.withoutCi
  }
  let shipped: ReturnType<typeof ship>
  try {
    shipped = shipUntilAnswered(cli, root, policy)
  } catch (error) {
    if (cli.json && error instanceof Interrupted) {
      const { message, remedy, performed } = error
      process.stdout.write(`${JSON.stringify({ error: message, remedy, performed }, null, 2)}\n`)
    }
    throw error
  }
  const { pr, performed } = shipped
  const answer = shipped.answer.status === "wait" ? { ...shipped.answer, next: [waitStep(argv)] } : shipped.answer
  const output = cli.json ? JSON.stringify(documentOf(pr, answer, performed, cli.verbose), null, 2) : lineOf(answer)
  process.stdout.write(`${output}\n`)
  return EXIT[answer.status]
}
