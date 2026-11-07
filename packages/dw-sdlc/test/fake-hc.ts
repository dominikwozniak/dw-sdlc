// A stand-in for `hc` and for `herdr-app` on a test's PATH, run as `fake-hc.ts <dir> <tool> <args...>`: it
// appends the args to `<dir>/<tool>.jsonl` and answers from the tool's table in `<dir>/scenario.json`.
// A call is answered by its first two words, else by its first; a list of replies is served in order.

import { appendFileSync, existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import type { Reply, Scenario } from "./hc-harness.ts"

const [dir = "", tool = "", ...args] = process.argv.slice(2)
const table = (JSON.parse(readFileSync(join(dir, "scenario.json"), "utf8")) as Scenario)[tool as keyof Scenario] ?? {}

/** The table key a call is answered by, undefined when the scenario names none. */
function keyOf(words: string[]): string | undefined {
  return [words.slice(0, 2).join(" "), words[0] ?? ""].find((key) => key in table)
}

const log = join(dir, `${tool}.jsonl`)
const earlier = existsSync(log)
  ? readFileSync(log, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as string[])
  : []
appendFileSync(log, `${JSON.stringify(args)}\n`)

const key = keyOf(args)
let reply: Reply
if (key === undefined) {
  reply = { exit: 99, stderr: `fake ${tool}: no scenario for ${JSON.stringify(args.slice(0, 2).join(" "))}\n` }
} else {
  const answer = table[key] as Reply | Reply[]
  const served = earlier.filter((words) => keyOf(words) === key).length
  reply = Array.isArray(answer)
    ? (answer[served] ?? {
        exit: 99,
        stderr: `fake ${tool}: no reply left for ${JSON.stringify(key)} call ${served + 1}\n`
      })
    : answer
}
process.stdout.write(reply.stdout ?? "")
process.stderr.write(reply.stderr ?? "")
process.exitCode = reply.exit ?? 0
