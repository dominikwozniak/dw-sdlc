// `dw-sdlc worker start`: puts a Brief in a herdr terminal as a Worker's first message, on the command, model
// and effort the config names, and reads back whether the Worker took it.

import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { parseArgs } from "node:util"

import { mainCheckout, repositoryRoot, resolveConfig, WORKER_EFFORTS } from "../agentic-config.ts"
import { describe, isLive, lead, refuse, Refusal, wholeNumber, workersOf } from "../worker/herdr.ts"
import { launch, NAME, spaceOf, TAB_WAIT, undelivered } from "../worker/launch.ts"
import { freshenOrigin } from "../worker/origin.ts"

export const summary = "start a Worker on a Brief in a herdr terminal"

const USAGE = `Usage: dw-sdlc worker start --brief <file> --name <name> [--model <model>] [--effort <effort>]
                            [--max-workers <n>] [--wait <seconds>] [--json]

Starts a Worker in the background and gives it the Brief as its first message. It runs hc run with the name,
the label role=worker, --outlive-parent and the repository as the folder, then worker.command of the config
with --worktree <name>, --model, --effort and the Brief. worker.command is split on whitespace, so it holds
no quoted word. --model and --effort default to worker.model and worker.effort. When the Lead sits in a
herdr space the Worker joins it, and its tab, which herdr numbers, takes the Worker's name: the window lists
the tab a moment after hc run, so the command looks for it for up to ${TAB_WAIT} seconds, or --wait when shorter,
while it reads the terminal back.

It reads the terminal back for up to --wait seconds (default 30), until the Worker shows work: its status
turns working, blocked or done. It fails when herdr reports the first message as unsent, the terminal has
ended, the Worker reports an error, or the Worker is still idle or silent when the time is up. It never sends
the Brief again: read the terminal with hc read first.

Before it starts the Worker it fetches origin's default branch into the clone (the branch origin/HEAD names,
else baseBranch of the config, else every branch of origin), so the Worker's worktree, which Claude Code
branches from origin/<default>, begins from origin's tip. A clone with no origin skips the fetch. When the
fetch fails the command starts no Worker and exits 2.

It refuses outside herdr ($HC_TERMINAL_ID unset) and when the Lead already has --max-workers live
Workers (default 3). The name is 1-32 of a-z, 0-9, - and _; it names the worktree too.

One line, or one JSON document with --json.

Exit 0 started and delivered, 1 started but not delivered, 2 when it cannot run, a failed fetch included.`

const DEFAULT_MAX_WORKERS = 3
const DEFAULT_WAIT = 30

type Cli = {
  brief: string
  name: string
  model: string | undefined
  effort: string | undefined
  max: number
  wait: number
  json: boolean
}

function parseCli(argv: string[]): Cli | "help" | { error: string } {
  try {
    const { values } = parseArgs({
      args: argv,
      options: {
        help: { type: "boolean", short: "h" },
        json: { type: "boolean" },
        brief: { type: "string" },
        name: { type: "string" },
        model: { type: "string" },
        effort: { type: "string" },
        "max-workers": { type: "string" },
        wait: { type: "string" }
      }
    })
    if (values.help === true) {
      return "help"
    }
    const { brief, name, model, effort } = values
    if (brief === undefined) {
      return { error: "name the Brief file: --brief <file>" }
    }
    if (name === undefined || !NAME.test(name)) {
      return { error: `--name takes 1-32 of a-z, 0-9, - and _, not ${JSON.stringify(name ?? "")}` }
    }
    if (model !== undefined && (model.trim() === "" || model.startsWith("-"))) {
      return { error: `--model takes a model name, not ${JSON.stringify(model)}` }
    }
    if (effort !== undefined && !(WORKER_EFFORTS as readonly string[]).includes(effort)) {
      return { error: `--effort takes one of ${WORKER_EFFORTS.join(", ")}, not ${JSON.stringify(effort)}` }
    }
    const max = wholeNumber("--max-workers", values["max-workers"], DEFAULT_MAX_WORKERS, 1)
    const wait = wholeNumber("--wait", values.wait, DEFAULT_WAIT, 0)
    if (typeof max === "object") {
      return max
    }
    if (typeof wait === "object") {
      return wait
    }
    return { brief, name, model, effort, max, wait, json: values.json === true }
  } catch (error) {
    return { error: describe(error) }
  }
}

/** The Brief's text; a file that is missing or holds only whitespace stops the command. */
function readBrief(file: string): string {
  let text: string
  try {
    text = readFileSync(resolve(file), "utf8")
  } catch (error) {
    throw new Refusal(`cannot read the Brief ${file}: ${describe(error)}`)
  }
  if (text.trim() === "") {
    throw new Refusal(`the Brief ${file} is empty`)
  }
  return text
}

async function start(cli: Cli): Promise<number> {
  const brief = readBrief(cli.brief)
  const leadId = lead()
  const checkout = repositoryRoot(process.cwd())
  // The Worker's --worktree makes a worktree of the repository itself, never of a linked one.
  const root = mainCheckout(checkout) ?? checkout
  const { baseBranch, worker } = resolveConfig(checkout).config
  const command = worker.command.split(/\s+/).filter(Boolean)
  if (command.length === 0) {
    throw new Refusal("worker.command holds no command", "set it in .ai/agentic.config.local.json, or remove the key")
  }
  const model = cli.model ?? worker.model
  const effort = cli.effort ?? worker.effort

  const live = workersOf(leadId, false).filter(isLive)
  if (live.length >= cli.max) {
    throw new Refusal(
      `${leadId} already has ${live.length} live Workers (the limit is ${cli.max})`,
      `carry one through first, or raise the limit with --max-workers ${live.length + 1}`
    )
  }

  // Before hc run, so a failed fetch starts no terminal.
  freshenOrigin(root, baseBranch)

  const { address, tab, reason } = await launch("worker start", {
    name: cli.name,
    role: "worker",
    space: spaceOf(leadId),
    cwd: root,
    argv: [...command, "--worktree", cli.name, "--model", model, "--effort", effort, brief],
    wait: cli.wait
  })

  if (cli.json) {
    const started = { name: cli.name, address, command: worker.command, model, effort, cwd: root }
    const document = { ...started, delivered: reason === undefined, ...(reason === undefined ? {} : { reason }), tab }
    process.stdout.write(`${JSON.stringify(document, null, 2)}\n`)
  }
  if (reason !== undefined) {
    process.stderr.write(undelivered("worker start", cli.name, address, reason, "Brief"))
    return 1
  }
  if (!cli.json) {
    process.stdout.write(`started ${cli.name} (${address}) on ${model} at ${effort} effort\n`)
  }
  return 0
}

export async function run(argv: string[]): Promise<number> {
  const cli = parseCli(argv)
  if (cli === "help") {
    process.stdout.write(`${USAGE}\n`)
    return 0
  }
  if ("error" in cli) {
    process.stderr.write(`dw-sdlc worker start: ${cli.error}\n\n${USAGE}\n`)
    return 2
  }
  try {
    return await start(cli)
  } catch (error) {
    return refuse("worker start", error)
  }
}
