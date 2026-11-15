// The Checks the package ships, in the order the Gate runs them. A new Check is a module beside this
// file, one row below and one key under `gate.checks` in the schema, listed in the same order.

import type { Gate } from "../agentic-config.ts"
import { agentsMap } from "./agents-map.ts"
import { type Check, type Finding, optionsOf } from "./check.ts"
import { commentBudget } from "./comment-budget.ts"
import { decisionRecords } from "./decision-records.ts"
import { disableDirectives } from "./disable-directives.ts"
import { fileSizeRatchet } from "./file-size-ratchet.ts"
import { markdownBudget } from "./markdown-budget.ts"
import { markdownRefs } from "./markdown-refs.ts"
import { pinnedActions } from "./pinned-actions.ts"
import { primitives } from "./primitives.ts"
import { routedDocs } from "./routed-docs.ts"
import { skillSections } from "./skill-sections.ts"
import { temporalLanguage } from "./temporal-language.ts"

/** A Check turned on by its setting in a Gate, ready to judge a tree, and to refresh its baseline if it is a Ratchet. */
export type EnabledCheck = {
  name: string
  run: (root: string) => Finding[]
  baseline?: { file: string; refresh: (root: string) => string }
  write?: (root: string) => string
}

type Shipped = { name: string; enable: (setting: unknown, gate: Gate) => EnabledCheck | undefined }

function ship<Options extends object>(check: Check<Options>): Shipped {
  return {
    name: check.name,
    enable: (setting, gate) => {
      const options = optionsOf(check, setting)
      if (options === undefined) {
        return undefined
      }
      const enabled: EnabledCheck = { name: check.name, run: (root) => check.run(root, options, gate) }
      const { baseline } = check
      if (baseline !== undefined) {
        enabled.baseline = { file: baseline.file, refresh: (root) => baseline.refresh(root, options) }
      }
      const { write } = check
      if (write !== undefined) {
        enabled.write = (root) => write(root, options, gate)
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
  ship(disableDirectives),
  ship(skillSections),
  ship(pinnedActions)
]

/** The name of every Check the package ships, in the order the Gate runs them. */
export const CHECK_NAMES: readonly string[] = SHIPPED.map(({ name }) => name)

/** Every shipped Check the resolved `gate` turns on with `true` or its options under `gate.checks`. */
export function enabledChecks(gate: Gate): EnabledCheck[] {
  return SHIPPED.flatMap(({ name, enable }) => enable(gate.checks[name], gate) ?? [])
}

/** The shipped Check `name` on the setting `gate` gives it, or on its defaults where the setting leaves it off. */
export function shippedCheck(name: string, gate: Gate): EnabledCheck | undefined {
  const setting = gate.checks[name]
  const on = setting === false || setting === undefined ? true : setting
  return SHIPPED.find((check) => check.name === name)?.enable(on, gate)
}
