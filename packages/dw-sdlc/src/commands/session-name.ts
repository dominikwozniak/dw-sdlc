// `dw-sdlc session name`: names the calling session, a herdr terminal, as a Lead or a Worker: its role label,
// its name label and its tab.

import { CannotRun, readArgs, usageError } from "../cannot-run.ts"
import { labelTerminal, lead } from "../worker/herdr.ts"
import { NAME, TAB_WAIT } from "../worker/launch.ts"
import { nameTab } from "../worker/tabs.ts"

export const summary = "name this session as a Lead or a Worker in herdr"

const USAGE = `Usage: dw-sdlc session name <name> --role lead|worker

Names the calling session, the terminal $HC_TERMINAL_ID, and no other: it runs hc label with role=<role>
and name=<name>, then renames the tab holding the terminal in the herdr window, which it looks for up to
${TAB_WAIT} seconds. A tab it cannot rename keeps herdr's name, said on stderr and no failure. The name is
1-32 of a-z, 0-9, - and _, such as lead-<issue>-<slug> or worker-<issue>-<slug>.

The label role=worker on a session the dev started by hand makes it a Worker by name only: no Lead lists
it in worker ls, since hc has no way to give a terminal a parent afterwards.

Needs a terminal herdr started ($HC_TERMINAL_ID) with hc and herdr-app on PATH. One line.

Exit 0 named, 2 when it cannot run.`

const ROLES = ["lead", "worker"]

export async function run(argv: string[]): Promise<number> {
  const { values, positionals } = readArgs(
    {
      args: argv,
      options: { help: { type: "boolean", short: "h" }, role: { type: "string" } },
      allowPositionals: true
    },
    USAGE
  )
  if (values.help === true) {
    process.stdout.write(`${USAGE}\n`)
    return 0
  }
  const [name, ...extra] = positionals
  if (name === undefined || extra.length > 0 || !NAME.test(name)) {
    throw usageError(`give one name of 1-32 of a-z, 0-9, - and _, not ${JSON.stringify(positionals.join(" "))}`, USAGE)
  }
  const { role } = values
  if (role === undefined || !ROLES.includes(role)) {
    throw usageError(`--role takes lead or worker, not ${JSON.stringify(role ?? "")}`, USAGE)
  }
  const caller = lead()
  const refused = labelTerminal(caller, { role, name })
  if (refused !== undefined) {
    throw new CannotRun(refused)
  }
  const tab = await nameTab(caller, name, TAB_WAIT)
  process.stdout.write(`named ${caller} ${name} (role=${role})\n`)
  if (tab !== "renamed") {
    process.stderr.write(`dw-sdlc session name: ${tab.kept}\n`)
  }
  return 0
}
