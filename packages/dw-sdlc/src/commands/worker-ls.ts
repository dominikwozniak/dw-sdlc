// `dw-sdlc worker ls`: the Workers the calling Lead started, with the state herdr holds them in.

import { readArgs } from "../cannot-run.ts"
import { lead, table, workersOf, workingFolders } from "../worker/herdr.ts"

export const summary = "list the Workers this Lead started and their states"

const USAGE = `Usage: dw-sdlc worker ls [--json]

Lists the Workers the calling Lead started (terminals labelled role=worker whose parent is this
terminal): name, address, herdr's state, status and folder. A live Worker's folder is the one it works
in, its worktree, as hc get reports it; a finished one, or one herdr cannot tell it for, shows the folder
it was launched in. The status is what the Worker reports, one of idle, working, done, blocked, error, or
finished once its terminal has ended; unknown before it reports. herdr's done means a turn ended, not the
task: the Worker's Recap says whether the task is done. Finished Workers stay listed until they are
removed with hc rm.

Needs a terminal herdr started ($HC_TERMINAL_ID) and hc on PATH. One line a Worker, or one JSON array
with --json.

Exit 0 listed, 2 when it cannot run.`

export function run(argv: string[]): number {
  const { values } = readArgs(
    { args: argv, options: { help: { type: "boolean", short: "h" }, json: { type: "boolean" } } },
    USAGE
  )
  if (values.help === true) {
    process.stdout.write(`${USAGE}\n`)
    return 0
  }
  const workers = workingFolders(workersOf(lead(), true))
  if (values.json === true) {
    process.stdout.write(`${JSON.stringify(workers, null, 2)}\n`)
  } else if (workers.length === 0) {
    process.stdout.write("no Workers\n")
  } else {
    const rows = workers.map((worker) => [worker.name, worker.address, worker.state, worker.status, worker.folder])
    process.stdout.write(`${table([["NAME", "ADDRESS", "STATE", "STATUS", "FOLDER"], ...rows])}\n`)
  }
  return 0
}
