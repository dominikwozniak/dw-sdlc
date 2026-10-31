// A stand-in for `gh` on a test's PATH, run as `fake-gh.ts <dir> <gh args...>`: it appends the args to
// `<dir>/calls.jsonl` and answers from `<dir>/scenario.json`, the GraphQL replies in the order served.

import { appendFileSync, existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import type { Response, Scenario } from "./pr-harness.ts"

const [dir = "", ...args] = process.argv.slice(2)
const log = join(dir, "calls.jsonl")
const earlier = existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean) : []
appendFileSync(log, `${JSON.stringify(args)}\n`)

const scenario = JSON.parse(readFileSync(join(dir, "scenario.json"), "utf8")) as Scenario
const key = args.slice(0, 2).join(" ")
let response: Response
if (key === "api graphql") {
  const served = earlier.filter((line) => line.startsWith('["api","graphql"')).length
  response = scenario.graphql?.[served] ?? {
    exit: 99,
    stderr: `fake gh: no GraphQL reply left for call ${served + 1}\n`
  }
} else {
  response = scenario.commands?.[key] ?? {}
}
process.stdout.write(response.stdout ?? "")
process.stderr.write(response.stderr ?? "")
process.exitCode = response.exit ?? 0
