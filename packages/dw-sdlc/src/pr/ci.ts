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

export function pendingOf(pr: PrState): CiCheck[] {
  return ciOf(pr).filter((check) => check.bucket === "pending")
}

/**
 * The checks that are CI unavailable, a GitHub Actions job that failed with no step run, when a Gate mark
 * may stand in for them; none when it may not, as they fail then.
 */
export function unavailableOf(pr: PrState, markStandsIn: boolean): CiCheck[] {
  return markStandsIn ? ciOf(pr).filter((check) => check.bucket === "fail" && check.unstarted) : []
}

export function failingOf(pr: PrState, markStandsIn: boolean): CiCheck[] {
  const unavailable = unavailableOf(pr, markStandsIn)
  return ciOf(pr).filter((check) => check.bucket === "fail" && !unavailable.includes(check))
}

/** Whether the head carries a Gate mark: the Gate passed on it. */
export function proven(pr: PrState): boolean {
  return pr.checks.some((check) => check.name === GATE && check.bucket === "pass")
}

/** A failing check as the agent reads it: its link, and the command that prints a GitHub Actions job's log. */
export function failure({ name, link, log }: CiCheck): Record<string, unknown> {
  return { name, link, ...(log === null ? {} : { log: shellLine(log) }) }
}
