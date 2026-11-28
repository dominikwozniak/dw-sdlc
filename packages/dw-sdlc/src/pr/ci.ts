// What the decision reads of a head's CI: the checks that are CI, which fail, which wait, and which are
// CI unavailable, a job GitHub never ran, for which a Gate mark on the head stands in.

import { shellLine } from "../shell-line.ts"
import { type CiCheck, GATE, OWN_PREFIX, type PrState } from "./state.ts"

/** How long a head may carry no check before it parks as unverified, from when its CI could start. */
export const GRACE_SECONDS = 120
/** How long CI may stay pending before it parks as stuck, from the first start among the pending checks. */
export const BUDGET_MINUTES = 40
/**
 * The bounds of a `ci-pending` recheck, the floor also the recheck when no merged pull request shows how
 * long CI takes: a run past its usual time wakes the caller once a minute.
 */
export const RECHECK_FLOOR = 60
export const RECHECK_CEILING = 600

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
 * The seconds until CI on the head likely ends: the median of the repository's recent CI durations, the
 * higher middle of an even count, less the time since the first start among the head's checks, within
 * the floor and the ceiling; with no duration known, the floor. A merged head is timed the same way.
 */
export function recheckOf(pr: PrState, now: number): number {
  const started = ciOf(pr).flatMap(({ startedAt }) => (startedAt === null ? [] : [Date.parse(startedAt)]))
  const start = started.length === 0 ? ciStartOf(pr) : Math.min(...started)
  const sorted = pr.ciDurations.toSorted((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]
  if (median === undefined) {
    return RECHECK_FLOOR
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

/** Whether `checks` hold a Gate mark: the Gate passed on the commit they belong to. */
function marked(checks: CiCheck[]): boolean {
  return checks.some((check) => check.name === GATE && check.bucket === "pass")
}

/** Whether the head carries a Gate mark: the Gate passed on it. */
export function proven(pr: PrState): boolean {
  return marked(pr.checks)
}

/** How many heads in a row with failing CI park the Ship script: the CI limit. */
export const CI_LIMIT = 3

/** The checks of a commit that are CI: the ones dw-sdlc posts itself, as the Gate mark, are not. */
const ciChecks = (checks: CiCheck[]): CiCheck[] => checks.filter((check) => !check.name.startsWith(OWN_PREFIX))

/**
 * The checks that make one commit red: the failing ones, bar CI unavailable when a Gate mark on the commit
 * stands in for it. Under pr.ciUnavailable ci `markStandsIn` is false and CI unavailable fails as any check.
 */
function redOf(checks: CiCheck[], markStandsIn: boolean): CiCheck[] {
  const failing = ciChecks(checks).filter((check) => check.bucket === "fail")
  return markStandsIn && marked(checks) ? failing.filter((check) => !check.unstarted) : failing
}

/** The checks that make the head red, as the CI limit's park lists them. */
export function redChecksOf(pr: PrState, markStandsIn: boolean): CiCheck[] {
  return redOf(pr.checks, markStandsIn)
}

/** Whether a commit with no red check is a green head: a Gate mark stands on it, or its CI passed whole. */
function greenOf(checks: CiCheck[]): boolean {
  const ci = ciChecks(checks)
  const passed = ci.some((check) => check.bucket === "pass")
  return marked(checks) || (passed && ci.every((check) => check.bucket === "pass" || check.bucket === "skipping"))
}

/**
 * How many heads in a row, the head counted, have failing CI. A head the update-branch merge made counts
 * as any does. A green head ends the row. A commit no check reported on, or whose checks still run or all
 * skipped, was never a head CI judged: it counts for nothing and ends nothing.
 */
export function redHeadsOf(pr: PrState, markStandsIn: boolean): number {
  let count = 0
  for (const { checks } of [...pr.ciHistory, pr].toReversed()) {
    if (redOf(checks, markStandsIn).length > 0) {
      count += 1
    } else if (greenOf(checks)) {
      break
    }
  }
  return count
}

/** Whether the head is the CI limit's: red itself, and the third head in a row with failing CI. */
export function limitedOf(pr: PrState, markStandsIn: boolean): boolean {
  return redOf(pr.checks, markStandsIn).length > 0 && redHeadsOf(pr, markStandsIn) >= CI_LIMIT
}

/** A failing check as the agent reads it: its link, and the command that prints a GitHub Actions job's log. */
export function failure({ name, link, log }: CiCheck): Record<string, unknown> {
  return { name, link, ...(log === null ? {} : { log: shellLine(log) }) }
}
