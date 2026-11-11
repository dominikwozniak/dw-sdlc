// `dw-sdlc lead start`: starts the next session as a Lead in a herdr terminal of its own, beside the caller and
// outliving it, on the command the config names for a Worker, without what makes it unsafe or isolated.

import { parseArgs } from "node:util"

import { mainCheckout, repositoryRoot, resolveConfig } from "../agentic-config.ts"
import { describe, lead, refuse, Refusal, wholeNumber } from "../worker/herdr.ts"
import { launch, NAME, spaceOf, TAB_WAIT, undelivered } from "../worker/launch.ts"

export const summary = "start the next session as a Lead in a herdr terminal of its own"

const USAGE = `Usage: dw-sdlc lead start --name <name> --prompt <first message> [--wait <seconds>] [--json]

Starts a Lead in the background, the session after this one, and gives it the first message, such as
/sdlc-delegate #326. It runs hc run with the name, the label role=lead, --outlive-parent and the main
checkout as the folder, then worker.command of the config with the first message. It drops
--dangerously-skip-permissions from the command, since a session never starts another that skips them, and
any --worktree or -w with its name, since a Lead works in the main checkout. worker.command is split on
whitespace, so it holds no quoted word. When the caller sits in a herdr space the Lead joins it, and its tab,
which herdr numbers, takes the Lead's name: the window lists the tab a moment after hc run, so the command
looks for it for up to ${TAB_WAIT} seconds, or --wait when shorter, while it reads the terminal back.

It reads the terminal back for up to --wait seconds (default 30), until the Lead shows work: its status
turns working, blocked or done. It fails when herdr reports the first message as unsent, the terminal has
ended, the Lead reports an error, or the Lead is still idle or silent when the time is up. It never sends
the first message again: read the terminal with hc read first.

It refuses outside herdr ($HC_TERMINAL_ID unset) and in a linked worktree, where a Lead cannot start its
Workers. The name is 1-32 of a-z, 0-9, - and _, such as lead-<issue>-<slug>.

One line, or one JSON document with --json.

Exit 0 started and delivered, 1 started but not delivered, 2 when it cannot run.`

const DEFAULT_WAIT = 30
/** What a session started by a session never carries: it would run with no permission check. */
const UNSAFE = "--dangerously-skip-permissions"
/** The flags that put a Claude Code session in a worktree of its own, each taking an optional name. */
const WORKTREE = new Set(["--worktree", "-w"])

type Cli = { name: string; prompt: string; wait: number; json: boolean }

function parseCli(argv: string[]): Cli | "help" | { error: string } {
  try {
    const { values } = parseArgs({
      args: argv,
      options: {
        help: { type: "boolean", short: "h" },
        json: { type: "boolean" },
        name: { type: "string" },
        prompt: { type: "string" },
        wait: { type: "string" }
      }
    })
    if (values.help === true) {
      return "help"
    }
    const { name, prompt } = values
    if (name === undefined || !NAME.test(name)) {
      return { error: `--name takes 1-32 of a-z, 0-9, - and _, not ${JSON.stringify(name ?? "")}` }
    }
    if (prompt === undefined || prompt.trim() === "") {
      return { error: "give the Lead its first message: --prompt <first message>" }
    }
    const wait = wholeNumber("--wait", values.wait, DEFAULT_WAIT, 0)
    if (typeof wait === "object") {
      return wait
    }
    return { name, prompt, wait, json: values.json === true }
  } catch (error) {
    return { error: describe(error) }
  }
}

/** `words` without the flag that skips permissions and without a worktree flag, its name with it when it has one. */
function leadCommand(words: string[]): string[] {
  const kept: string[] = []
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index] ?? ""
    if (word === UNSAFE || word.startsWith("--worktree=")) {
      continue
    }
    if (WORKTREE.has(word)) {
      const next = words[index + 1]
      if (next !== undefined && !next.startsWith("-")) {
        index += 1
      }
      continue
    }
    kept.push(word)
  }
  return kept
}

async function start(cli: Cli): Promise<number> {
  const caller = lead()
  const checkout = repositoryRoot(process.cwd())
  const main = mainCheckout(checkout)
  if (main !== undefined) {
    throw new Refusal(
      `in a linked worktree, ${checkout}: a Lead works in the main checkout, and this session cannot start one there`,
      `run it from the main checkout, ${main}, or start the Lead there by hand`
    )
  }
  const command = leadCommand(resolveConfig(checkout).config.worker.command.split(/\s+/).filter(Boolean))
  if (command.length === 0) {
    throw new Refusal("worker.command holds no command", "set it in .ai/agentic.config.local.json, or remove the key")
  }

  const { address, tab, reason } = await launch("lead start", {
    name: cli.name,
    role: "lead",
    space: spaceOf(caller),
    cwd: checkout,
    argv: [...command, cli.prompt],
    wait: cli.wait
  })

  if (cli.json) {
    const started = { name: cli.name, address, command: command.join(" "), cwd: checkout }
    const document = { ...started, delivered: reason === undefined, ...(reason === undefined ? {} : { reason }), tab }
    process.stdout.write(`${JSON.stringify(document, null, 2)}\n`)
  }
  if (reason !== undefined) {
    process.stderr.write(undelivered("lead start", cli.name, address, reason, "first message"))
    return 1
  }
  if (!cli.json) {
    process.stdout.write(`started ${cli.name} (${address}) in ${checkout}\n`)
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
    process.stderr.write(`dw-sdlc lead start: ${cli.error}\n\n${USAGE}\n`)
    return 2
  }
  try {
    return await start(cli)
  } catch (error) {
    return refuse("lead start", error)
  }
}
