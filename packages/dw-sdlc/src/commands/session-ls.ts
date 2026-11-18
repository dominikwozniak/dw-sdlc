// `dw-sdlc session ls`: every live session in herdr with its role, not only the Workers of one Lead.

import { readArgs } from "../cannot-run.ts"
import { type Listed, listTerminals, table } from "../worker/herdr.ts"
import { ROLES } from "../worker/launch.ts"

export const summary = "list every live herdr session with its role and name"

const USAGE = `Usage: dw-sdlc session ls [--json]

Lists every live terminal herdr runs, not only the Workers of this Lead as worker ls does: role, name,
address, status and folder. The role is the label role= of the terminal, lead or worker, and - for a terminal
with none. The name is the one hc holds for it, else the name of its tab in the herdr window, else its
address. The status is what the session reports (idle, working, done, blocked, error), unknown before it
reports. The folder is the one it was launched in.

Needs hc on PATH. One line a session, or one JSON array with --json.

Exit 0 listed, 2 when it cannot run.`

/** The tab part of a place herdr shows a terminal at, "space / tab". */
function tabOf(place: string | undefined): string | undefined {
  const tab = place?.split(" / ").slice(1).join(" / ")
  return tab === undefined || tab === "" ? undefined : tab
}

export function run(argv: string[]): number {
  const { values } = readArgs(
    { args: argv, options: { help: { type: "boolean", short: "h" }, json: { type: "boolean" } } },
    USAGE
  )
  if (values.help === true) {
    process.stdout.write(`${USAGE}\n`)
    return 0
  }
  const roleOf = new Map<string, string>()
  for (const role of ROLES) {
    for (const { address } of listTerminals({ label: `role=${role}` })) {
      roleOf.set(address, role)
    }
  }
  const sessions = listTerminals().map((terminal: Listed) => ({
    role: roleOf.get(terminal.address) ?? "-",
    // `Listed.name` is the address for a terminal hc holds no name for.
    name: terminal.name === terminal.address ? (tabOf(terminal.place) ?? terminal.address) : terminal.name,
    address: terminal.address,
    status: terminal.status ?? "unknown",
    folder: terminal.folder
  }))
  if (values.json === true) {
    process.stdout.write(`${JSON.stringify(sessions, null, 2)}\n`)
  } else if (sessions.length === 0) {
    process.stdout.write("no sessions\n")
  } else {
    const rows = sessions.map((session) => [
      session.role,
      session.name,
      session.address,
      session.status,
      session.folder
    ])
    process.stdout.write(`${table([["ROLE", "NAME", "ADDRESS", "STATUS", "FOLDER"], ...rows])}\n`)
  }
  return 0
}
