// `dw-sdlc worker ls`: the Workers the calling Lead started, with the state herdr holds them in.

import { parseArgs } from "node:util"

import { lead, Refusal, table, workersOf } from "../worker/herdr.ts"

export const summary = "list the Workers this Lead started and their states"

const USAGE = `Usage: dw-sdlc worker ls [--json]

Lists the Workers the calling Lead started (terminals labelled role=worker whose parent is this
terminal): name, address, herdr's state, status and the folder each was launched in. The status is what
the Worker reports, one of idle, working, done, blocked, error, or finished once its terminal has ended;
unknown before it reports. herdr's done means a turn ended, not the task: the Worker's Recap says whether
the task is done. Finished Workers stay listed until they are removed with hc rm.

Needs a terminal herdr started ($HC_TERMINAL_ID) and hc on PATH. One line a Worker, or one JSON array
with --json.

Exit 0 listed, 2 when it cannot run.`

export function run(argv: string[]): number {
  let json: boolean
  try {
    const { values } = parseArgs({
      args: argv,
      options: { help: { type: "boolean", short: "h" }, json: { type: "boolean" } }
    })
    if (values.help === true) {
      process.stdout.write(`${USAGE}\n`)
      return 0
    }
    json = values.json === true
  } catch (error) {
    process.stderr.write(`dw-sdlc worker ls: ${error instanceof Error ? error.message : String(error)}\n\n${USAGE}\n`)
    return 2
  }
  try {
    const workers = workersOf(lead(), true)
    if (json) {
      process.stdout.write(`${JSON.stringify(workers, null, 2)}\n`)
    } else if (workers.length === 0) {
      process.stdout.write("no Workers\n")
    } else {
      const rows = workers.map((worker) => [worker.name, worker.address, worker.state, worker.status, worker.folder])
      process.stdout.write(`${table([["NAME", "ADDRESS", "STATE", "STATUS", "FOLDER"], ...rows])}\n`)
    }
    return 0
  } catch (error) {
    if (error instanceof Refusal) {
      process.stderr.write(
        `dw-sdlc worker ls: ${error.message}${error.remedy === undefined ? "" : ` — ${error.remedy}`}\n`
      )
      return 2
    }
    throw error
  }
}
