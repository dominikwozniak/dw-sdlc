// `dw-sdlc worker report`: delivers a Worker's Recap to its Lead, and keeps trying while the Lead is blocked.

import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { setTimeout as sleep } from "node:timers/promises"

import { CannotRun, messageOf, readArgs, usageError } from "../cannot-run.ts"
import { labelTerminal, lead, sendTo, VERDICT_LABEL, wholeNumber } from "../worker/herdr.ts"

export const summary = "deliver a Recap to the Lead, retrying while it is blocked"

const USAGE = `Usage: dw-sdlc worker report --to <lead> --recap <file> [--attempts <n>] [--interval <seconds>]

Sends the Recap in <file> to the Lead's terminal with hc send. A Recap of one short line goes as itself;
anything longer goes as the absolute path of its file, which the Lead reads.

hc send exits 9 when the Lead is blocked on a dialog. The command then waits --interval seconds (default
60) and sends again, up to --attempts sends (default 30), and exits 1 when the Lead is still blocked. It
never passes --force: typing into a blocked Lead may answer its dialog. Any other refusal of hc send ends
it at once with exit 1.

Once the Recap is delivered it reads the Recap's first word, its verdict, and when that is done, act, wait or
park it sets the label ${VERDICT_LABEL}=<word> on this terminal. A Sweep stops a Worker only once it has
delivered a Recap of done or park, so a Worker whose turn ended on a question, or at a wait, keeps its
terminal and worktree. A first word that is no verdict sets no label. When hc label refuses, the Recap is
still delivered and the command exits 1: the Sweep keeps the Worker until the label is set, so do not send
the Recap again.

Needs a terminal herdr started ($HC_TERMINAL_ID) and hc on PATH.

Exit 0 delivered, 1 not delivered, 2 when it cannot run.`

const DEFAULT_ATTEMPTS = 30
const DEFAULT_INTERVAL = 60
/** The longest Recap that goes as itself, in characters; a longer one goes as a path. */
const SHORT = 300

type Cli = { help: false; to: string; recap: string; attempts: number; interval: number }

function parseCli(argv: string[]): Cli | { help: true } {
  const { values } = readArgs(
    {
      args: argv,
      options: {
        help: { type: "boolean", short: "h" },
        to: { type: "string" },
        recap: { type: "string" },
        attempts: { type: "string" },
        interval: { type: "string" }
      }
    },
    USAGE
  )
  if (values.help === true) {
    return { help: true }
  }
  const { to, recap } = values
  if (to === undefined || to === "") {
    throw usageError("name the Lead's terminal: --to <lead>", USAGE)
  }
  if (recap === undefined) {
    throw usageError("name the Recap file: --recap <file>", USAGE)
  }
  const attempts = wholeNumber("--attempts", values.attempts, DEFAULT_ATTEMPTS, 1)
  const interval = wholeNumber("--interval", values.interval, DEFAULT_INTERVAL, 0)
  if (typeof attempts === "object") {
    throw usageError(attempts.error, USAGE)
  }
  if (typeof interval === "object") {
    throw usageError(interval.error, USAGE)
  }
  return { help: false, to, recap, attempts, interval }
}

/** The verdicts a Recap opens with: the Action words of /sdlc-recap. */
const VERDICTS = new Set(["done", "act", "wait", "park"])

/** The verdict a Recap opens with, as `done` in "`done`: merged" or "**Done** - merged"; undefined when it opens with none. */
function verdictOf(recap: string): string | undefined {
  const word = recap.match(/^[^\p{L}\p{N}]*(\p{L}+)/u)?.[1]?.toLowerCase()
  return word !== undefined && VERDICTS.has(word) ? word : undefined
}

/** What to send for the Recap in `file`: the Recap itself when it is one short line, else the file's path. */
function messageFor(file: string): { message: string; path: string; verdict: string | undefined } {
  const path = resolve(file)
  let text: string
  try {
    text = readFileSync(path, "utf8").trim()
  } catch (error) {
    throw new CannotRun(`cannot read the Recap ${file}: ${messageOf(error)}`)
  }
  if (text === "") {
    throw new CannotRun(`the Recap ${file} is empty`)
  }
  return { message: text.includes("\n") || text.length > SHORT ? path : text, path, verdict: verdictOf(text) }
}

/** Sets the verdict on this terminal: exit 0, or exit 1 with what is left undone. */
function mark(own: string, verdict: string): number {
  const refused = labelTerminal(own, { [VERDICT_LABEL]: verdict })
  if (refused === undefined) {
    return 0
  }
  process.stderr.write(
    `dw-sdlc worker report: the Recap is delivered, but ${refused}; a Sweep keeps this Worker until ` +
      `${VERDICT_LABEL}=${verdict} is set, so set it by hand and send the Recap no more\n`
  )
  return 1
}

async function report({ to, recap, attempts, interval }: Cli): Promise<number> {
  const own = lead()
  const { message, path, verdict } = messageFor(recap)
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const sent = sendTo(to, message)
    if (sent === "sent") {
      process.stdout.write(`reported to ${to}\n`)
      return verdict === undefined ? 0 : mark(own, verdict)
    }
    if (sent !== "blocked") {
      process.stderr.write(`dw-sdlc worker report: ${sent.refused} — the Recap stays at ${path}\n`)
      return 1
    }
    if (attempt === attempts) {
      break
    }
    process.stderr.write(
      `dw-sdlc worker report: ${to} is blocked; waiting ${interval} s (attempt ${attempt} of ${attempts})\n`
    )
    await sleep(interval * 1000)
  }
  process.stderr.write(
    `dw-sdlc worker report: gave up after ${attempts} attempts: ${to} is still blocked — ` +
      `the Recap stays at ${path}; say so on your screen so the dev can open ${to}\n`
  )
  return 1
}

export async function run(argv: string[]): Promise<number> {
  const cli = parseCli(argv)
  if (cli.help) {
    process.stdout.write(`${USAGE}\n`)
    return 0
  }
  return report(cli)
}
