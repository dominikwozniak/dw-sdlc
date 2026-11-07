// `dw-sdlc worker report`: delivers a Worker's Recap to its Lead, and keeps trying while the Lead is blocked.

import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { parseArgs } from "node:util"

import { call, describe, lead, refuse, Refusal, said, wholeNumber } from "../worker/herdr.ts"

export const summary = "deliver a Recap to the Lead, retrying while it is blocked"

const USAGE = `Usage: dw-sdlc worker report --to <lead> --recap <file> [--attempts <n>] [--interval <seconds>]

Sends the Recap in <file> to the Lead's terminal with hc send. A Recap of one short line goes as itself;
anything longer goes as the absolute path of its file, which the Lead reads.

hc send exits 9 when the Lead is blocked on a dialog. The command then waits --interval seconds (default
60) and sends again, up to --attempts sends (default 30), and exits 1 when the Lead is still blocked. It
never passes --force: typing into a blocked Lead may answer its dialog. Any other refusal of hc send ends
it at once with exit 1.

Needs a terminal herdr started ($HC_TERMINAL_ID) and hc on PATH.

Exit 0 delivered, 1 not delivered, 2 when it cannot run.`

/** `hc send` exits with this when the target is blocked on a permission or a question. */
const BLOCKED = 9
const DEFAULT_ATTEMPTS = 30
const DEFAULT_INTERVAL = 60
/** The longest Recap that goes as itself, in characters; a longer one goes as a path. */
const SHORT = 300

type Cli = { to: string; recap: string; attempts: number; interval: number }

function parseCli(argv: string[]): Cli | "help" | { error: string } {
  try {
    const { values } = parseArgs({
      args: argv,
      options: {
        help: { type: "boolean", short: "h" },
        to: { type: "string" },
        recap: { type: "string" },
        attempts: { type: "string" },
        interval: { type: "string" }
      }
    })
    if (values.help === true) {
      return "help"
    }
    const { to, recap } = values
    if (to === undefined || to === "") {
      return { error: "name the Lead's terminal: --to <lead>" }
    }
    if (recap === undefined) {
      return { error: "name the Recap file: --recap <file>" }
    }
    const attempts = wholeNumber("--attempts", values.attempts, DEFAULT_ATTEMPTS, 1)
    const interval = wholeNumber("--interval", values.interval, DEFAULT_INTERVAL, 0)
    if (typeof attempts === "object") {
      return attempts
    }
    if (typeof interval === "object") {
      return interval
    }
    return { to, recap, attempts, interval }
  } catch (error) {
    return { error: describe(error) }
  }
}

/** What to send for the Recap in `file`: the Recap itself when it is one short line, else the file's path. */
function messageFor(file: string): { message: string; path: string } {
  const path = resolve(file)
  let text: string
  try {
    text = readFileSync(path, "utf8").trim()
  } catch (error) {
    throw new Refusal(`cannot read the Recap ${file}: ${describe(error)}`)
  }
  if (text === "") {
    throw new Refusal(`the Recap ${file} is empty`)
  }
  return { message: text.includes("\n") || text.length > SHORT ? path : text, path }
}

async function report({ to, recap, attempts, interval }: Cli): Promise<number> {
  lead()
  const { message, path } = messageFor(recap)
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const sent = call("hc", ["send", to, message])
    if (sent.status === 0) {
      process.stdout.write(`reported to ${to}\n`)
      return 0
    }
    if (sent.status !== BLOCKED) {
      process.stderr.write(`dw-sdlc worker report: hc send failed: ${said(sent)} — the Recap stays at ${path}\n`)
      return 1
    }
    if (attempt === attempts) {
      break
    }
    process.stderr.write(
      `dw-sdlc worker report: ${to} is blocked; waiting ${interval} s (attempt ${attempt} of ${attempts})\n`
    )
    await new Promise((done) => setTimeout(done, interval * 1000))
  }
  process.stderr.write(
    `dw-sdlc worker report: gave up after ${attempts} attempts: ${to} is still blocked — ` +
      `the Recap stays at ${path}; say so on your screen so the dev can open ${to}\n`
  )
  return 1
}

export async function run(argv: string[]): Promise<number> {
  const cli = parseCli(argv)
  if (cli === "help") {
    process.stdout.write(`${USAGE}\n`)
    return 0
  }
  if ("error" in cli) {
    process.stderr.write(`dw-sdlc worker report: ${cli.error}\n\n${USAGE}\n`)
    return 2
  }
  try {
    return await report(cli)
  } catch (error) {
    return refuse("worker report", error)
  }
}
