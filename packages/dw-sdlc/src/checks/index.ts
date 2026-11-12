// The Checks the package ships, in the order the Gate runs them. A new Check is a module beside this
// file, one row below and one key under `gate.checks` in the schema, listed in the same order.

import { agentsMap } from "./agents-map.ts"
import { type Check, type Finding, optionsOf } from "./check.ts"
import { commentBudget } from "./comment-budget.ts"
import { decisionRecords } from "./decision-records.ts"
import { disableDirectives } from "./disable-directives.ts"
import { fileSizeRatchet } from "./file-size-ratchet.ts"
import { markdownBudget } from "./markdown-budget.ts"
import { markdownRefs } from "./markdown-refs.ts"
import { primitives } from "./primitives.ts"
import { routedDocs } from "./routed-docs.ts"
import { temporalLanguage } from "./temporal-language.ts"

/** A Check turned on by its setting, ready to judge a tree, and to refresh its baseline if it is a Ratchet. */
export type EnabledCheck = {
  name: string
  run: (root: string) => Finding[]
  baseline?: { file: string; refresh: (root: string) => string }
}

type Shipped = { name: string; enable: (setting: unknown) => EnabledCheck | undefined }

function ship<Options extends object>(check: Check<Options>): Shipped {
  return {
    name: check.name,
    enable: (setting) => {
      const options = optionsOf(check, setting)
      if (options === undefined) {
        return undefined
      }
      const enabled: EnabledCheck = { name: check.name, run: (root) => check.run(root, options) }
      const { baseline } = check
      if (baseline !== undefined) {
        enabled.baseline = { file: baseline.file, refresh: (root) => baseline.refresh(root, options) }
      }
      return enabled
    }
  }
}

const SHIPPED: Shipped[] = [
  ship(primitives),
  ship(agentsMap),
  ship(routedDocs),
  ship(markdownBudget),
  ship(markdownRefs),
  ship(temporalLanguage),
  ship(decisionRecords),
  ship(fileSizeRatchet),
  ship(commentBudget),
  ship(disableDirectives)
]

/** The name of every Check the package ships, in the order the Gate runs them. */
export const CHECK_NAMES: readonly string[] = SHIPPED.map(({ name }) => name)

/** Every shipped Check a resolved `gate.checks` turns on with `true` or its options. */
export function enabledChecks(checks: Record<string, unknown>): EnabledCheck[] {
  return SHIPPED.flatMap(({ name, enable }) => enable(checks[name]) ?? [])
}

/** The shipped Check `name` on `setting`, or on its defaults where `setting` leaves it off. */
export function shippedCheck(name: string, setting: unknown): EnabledCheck | undefined {
  const on = setting === false || setting === undefined ? true : setting
  return SHIPPED.find((check) => check.name === name)?.enable(on)
}
