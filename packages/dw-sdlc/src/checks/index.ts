// The Checks the package ships, in the order the Gate runs them. A new Check is a module beside this
// file, one row below and one key under `gate.checks` in the schema, listed in the same order.

import { agentsMap } from "./agents-map.ts"
import { type Check, type Finding, optionsOf } from "./check.ts"
import { primitives } from "./primitives.ts"

/** A Check turned on by its setting, ready to judge a tree. */
export type EnabledCheck = { name: string; run: (root: string) => Finding[] }

type Shipped = { name: string; enable: (setting: unknown) => EnabledCheck | undefined }

function ship<Options extends object>(check: Check<Options>): Shipped {
  return {
    name: check.name,
    enable: (setting) => {
      const options = optionsOf(check, setting)
      return options === undefined ? undefined : { name: check.name, run: (root) => check.run(root, options) }
    }
  }
}

const SHIPPED: Shipped[] = [ship(primitives), ship(agentsMap)]

/** Every shipped Check a resolved `gate.checks` turns on with `true` or its options. */
export function enabledChecks(checks: Record<string, unknown>): EnabledCheck[] {
  return SHIPPED.flatMap(({ name, enable }) => enable(checks[name]) ?? [])
}
