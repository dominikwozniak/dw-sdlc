// What every Check the package ships is: a name, the options `true` stands for, and a run over the
// tree that answers with its failures. The Gate names the Check as each failure's rule.

import type { Failure } from "../report.ts"

/** A failure as a Check finds it: the file and line where it has one, what is wrong, the remedy. */
export type Finding = Omit<Failure, "rule">

/** An input the Check needs is missing or unreadable, so the Gate cannot run: exit 2, not 1. */
export class CannotRun extends Error {
  finding: Finding

  constructor(finding: Finding) {
    super(finding.message)
    this.finding = finding
  }
}

export type Check<Options extends object> = {
  /** The Check's key under `gate.checks`. */
  name: string
  defaults: Options
  /** Every failure of the tree at `root`, none when it passes; throws `CannotRun` when it cannot judge. */
  run: (root: string, options: Options) => Finding[]
}

/** The options `setting` turns the Check on with: the defaults under `true`, an object over them, else off. */
export function optionsOf<Options extends object>(check: Check<Options>, setting: unknown): Options | undefined {
  if (setting === true) {
    return check.defaults
  }
  if (typeof setting === "object" && setting !== null && !Array.isArray(setting)) {
    // The schema has refused every key the Check does not take and every value of the wrong type.
    return { ...check.defaults, ...(setting as Partial<Options>) }
  }
  return undefined
}
