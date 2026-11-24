// What the decision reads of a head's CI: the checks that are CI, which fail, which wait, and which are
// CI unavailable, a job GitHub never ran, for which a Gate mark on the head stands in.

import { shellLine } from "../shell-line.ts"
import { type CiCheck, GATE, type PrState } from "./state.ts"

/** How long a head may carry no check before it parks as unverified, from when its CI could start. */
export const GRACE_SECONDS = 120
/** How long CI may stay pending before it parks as stuck, from the first start among the pending checks. */
export const BUDGET_MINUTES = 40
/** The prefix of the contexts the script posts itself, as `dw-sdlc/review`: never CI. */
const OWN_PREFIX = "dw-sdlc/"

/** When the head's CI could start: its commit, or its ready when it left draft later, since a draft runs nothing. */
export function ciStartOf(pr: PrState): number {
  return Math.max(Date.parse(pr.headCommittedAt), Date.parse(pr.readyAt ?? pr.headCommittedAt))
}

export function ciOf(pr: PrState): CiCheck[] {
  return pr.checks.filter((check) => !check.name.startsWith(OWN_PREFIX))
}

/** A pending check that never started, past the budget counted from when the head's CI could start. */
function neverStarted(pr: PrState, check: CiCheck, now: number): boolean {
  return check.bucket === "pending" && check.startedAt === null && now - ciStartOf(pr) > BUDGET_MINUTES * 60_000
}

/** The checks that are CI unavailable at `now`: a job that ran no step, or one that never started. */
export function unavailableOf(pr: PrState, now: number): CiCheck[] {
  return ciOf(pr).filter((check) => (check.bucket === "fail" && check.unstarted) || neverStarted(pr, check, now))
}

export function pendingOf(pr: PrState, now: number): CiCheck[] {
  return ciOf(pr).filter((check) => check.bucket === "pending" && !neverStarted(pr, check, now))
}

/** The checks that failed on a run: a job GitHub never ran is CI unavailable, not a failure. */
export function failingOf(pr: PrState): CiCheck[] {
  return ciOf(pr).filter((check) => check.bucket === "fail" && !check.unstarted)
}

/** A head with no check, or whose every check was skipped: it ran nothing. */
export function ranNothing(pr: PrState): boolean {
  return ciOf(pr).every((check) => check.bucket === "skipping")
}

/** Whether the head carries a Gate mark: the Gate passed on it, so it stands in for CI unavailable. */
export function proven(pr: PrState): boolean {
  return pr.checks.some((check) => check.name === GATE && check.bucket === "pass")
}

/** Why each check is CI unavailable, as a reason names it. */
export function unavailableWhy(checks: CiCheck[]): string[] {
  return checks.map(({ name, unstarted }) =>
    unstarted ? `${name} ran no step` : `${name} never started within ${BUDGET_MINUTES} min`
  )
}

/** A failing check as the agent reads it: its link, and the command that prints a GitHub Actions job's log. */
export function failure({ name, link, log }: CiCheck): Record<string, unknown> {
  return { name, link, ...(log === null ? {} : { log: shellLine(log) }) }
}
