// What the decision reads of a head's CI: the checks that are CI, which fail, which wait, and which are
// CI unavailable, a job GitHub never ran, for which a Gate mark on the head stands in.

import { shellLine } from "../shell-line.ts"
import { type CiCheck, GATE, OWN_PREFIX, type PrState } from "./state.ts"

/** How long a head may carry no check before it parks as unverified, from when its CI could start. */
export const GRACE_SECONDS = 120
/** How long CI may stay pending before it parks as stuck, from the first start among the pending checks. */
export const BUDGET_MINUTES = 40
/** The bounds of a `ci-pending` recheck, and the recheck when no merged pull request shows how long CI takes. */
export const RECHECK_FLOOR = 30
export const RECHECK_CEILING = 600
const RECHECK_UNTIMED = 60

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

/** When the pending checks started: the first start among them, one not yet started from when CI could start. */
export function pendingStartOf(pr: PrState): number {
  return Math.min(
    ...pendingOf(pr).map((check) => (check.startedAt === null ? ciStartOf(pr) : Date.parse(check.startedAt)))
  )
}

/**
 * The seconds until CI on the head likely ends, from `start`: the median of the repository's recent CI
 * durations, the higher middle of an even count, less the time run so far, within the floor and the
 * ceiling; with no duration known, a minute.
 */
export function recheckOf(pr: PrState, start: number, now: number): number {
  const sorted = pr.ciDurations.toSorted((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]
  if (median === undefined) {
    return RECHECK_UNTIMED
  }
  const left = Math.round(median - (now - start) / 1000)
  return Math.min(RECHECK_CEILING, Math.max(RECHECK_FLOOR, left))
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

/** Whether the Gate is green on the head: a Gate mark, or CI that ran a check and passed every one it ran. */
export function gateGreen(pr: PrState): boolean {
  const ci = ciOf(pr)
  const passed = ci.some((check) => check.bucket === "pass")
  return proven(pr) || (passed && ci.every((check) => check.bucket === "pass" || check.bucket === "skipping"))
}

/**
 * Whether the Gate may still turn green on the head with no dev: CI runs or is yet to report, the agent
 * proves CI unavailable with the Gate, as `gateSteps` lets it where a Gate mark stands in, or the viewer's
 * draft has yet to start CI.
 */
export function gateComing(
  pr: PrState,
  now: number,
  { ciUnavailable, gateSteps }: { ciUnavailable: string; gateSteps: boolean }
): boolean {
  const ran = ciOf(pr).some((check) => check.bucket !== "skipping")
  return (
    pr.draft ||
    pendingOf(pr).length > 0 ||
    (gateSteps && unavailableOf(pr, ciUnavailable === "gate").length > 0) ||
    (!ran && now - ciStartOf(pr) <= GRACE_SECONDS * 1000)
  )
}

/** Whether the head carries a Gate mark: the Gate passed on it. */
export function proven(pr: PrState): boolean {
  return pr.checks.some((check) => check.name === GATE && check.bucket === "pass")
}

/** A failing check as the agent reads it: its link, and the command that prints a GitHub Actions job's log. */
export function failure({ name, link, log }: CiCheck): Record<string, unknown> {
  return { name, link, ...(log === null ? {} : { log: shellLine(log) }) }
}
