// `dw-sdlc worker start`: puts a Brief in a herdr terminal as a Worker's first message, on the command, model
// and effort the config names, and reads back whether herdr delivered it.

import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { parseArgs } from "node:util"

import { repositoryRoot, resolveConfig, WORKER_EFFORTS } from "../agentic-config.ts"
import { isObject } from "../json-text.ts"
import { call, hcObject, lead, Refusal, said, workersOf } from "../worker/herdr.ts"

export const summary = "start a Worker on a Brief in a herdr terminal"

const USAGE = `Usage: dw-sdlc worker start --brief <file> --name <name> [--model <model>] [--effort <effort>]
                            [--max-workers <n>] [--json]

Starts a Worker in the background and gives it the Brief as its first message. It runs hc run with the name,
the label role=worker, --outlive-parent and the repository as the folder, then worker.command of the config
with --worktree <name>, --model, --effort and the Brief. --model and --effort default to worker.model and
worker.effort. When the Lead sits in a herdr space the Worker joins it, and its tab, which herdr numbers,
takes the Worker's name.

It reads the terminal back and fails when herdr did not deliver the first message, the terminal has ended
or the Worker reports an error. It does not send the Brief again: read the terminal first.

It refuses outside herdr ($HC_TERMINAL_ID unset) and when the Lead already has --max-workers live
Workers (default 3). The name is 1-32 of a-z, 0-9, - and _; it names the worktree too.

One line, or one JSON document with --json.

Exit 0 started and delivered, 1 started but not delivered, 2 when it cannot run.`

const DEFAULT_MAX_WORKERS = 3
const NAME = /^[a-z0-9][a-z0-9_-]{0,31}$/

type Cli = {
  brief: string
  name: string
  model: string | undefined
  effort: string | undefined
  max: number
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
        "max-workers": { type: "string" }
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
    const max = values["max-workers"] === undefined ? DEFAULT_MAX_WORKERS : Number(values["max-workers"])
    if (!Number.isInteger(max) || max < 1) {
      return { error: `--max-workers takes a whole number from 1, not ${JSON.stringify(values["max-workers"])}` }
    }
    return { brief, name, model, effort, max, json: values.json === true }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

/** The Brief's text; a file that is missing or holds only whitespace stops the command. */
function readBrief(file: string): string {
  let text: string
  try {
    text = readFileSync(resolve(file), "utf8")
  } catch (error) {
    throw new Refusal(`cannot read the Brief ${file}: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (text.trim() === "") {
    throw new Refusal(`the Brief ${file} is empty`)
  }
  return text
}

/** Why herdr did not take the first message, or undefined when it did. */
function undelivered(terminal: Record<string, unknown>): string | undefined {
  const { first_message: first, state, status } = terminal
  if (isObject(first) && first.sent === false) {
    return typeof first.reason === "string" ? first.reason : "herdr gave no reason"
  }
  if (state !== "live") {
    return "the terminal has finished"
  }
  if (isObject(status) && status.state === "error") {
    return "the Worker reports its status as error"
  }
  return undefined
}

/** The id of the herdr space the Lead sits in, if it sits in one. */
function spaceOf(leadId: string): string | undefined {
  const { labels } = hcObject(["get", leadId, "--json"])
  const space = isObject(labels) ? labels["herdr.space"] : undefined
  return typeof space === "string" ? space : undefined
}

/** Names the Worker's tab, which herdr numbers; a tab that stays numbered is a warning, never a failure. */
function nameTab(address: string, name: string): "renamed" | { kept: string } {
  try {
    const layout = tabsOf()
    const tab = layout.find((candidate) => candidate.terminals.includes(address))
    if (tab === undefined) {
      return { kept: `the tab of ${address} is not in herdr-app ls, so it keeps herdr's name` }
    }
    const renamed = call("herdr-app", ["do", "tab.rename", "--id", tab.id, "--name", name])
    if (renamed.status !== 0) {
      return { kept: `herdr-app could not rename the tab of ${address}: ${errorOf(renamed.stdout) ?? said(renamed)}` }
    }
    return "renamed"
  } catch (error) {
    if (error instanceof Refusal) {
      return { kept: `the tab of ${address} keeps herdr's name: ${error.message}` }
    }
    throw error
  }
}

/** The `error` of a herdr-app reply `{ "error": "..." }`. */
function errorOf(stdout: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(stdout)
    return isObject(parsed) && typeof parsed.error === "string" ? parsed.error : undefined
  } catch {
    return undefined
  }
}

type Tab = { id: string; terminals: string[] }

/** The tabs `herdr-app ls` shows, each with the addresses of its terminals. */
function tabsOf(): Tab[] {
  const listed = call("herdr-app", ["ls"])
  if (listed.status !== 0) {
    throw new Refusal(`herdr-app ls failed: ${said(listed)}`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(listed.stdout)
  } catch {
    throw new Refusal("herdr-app ls answered no JSON")
  }
  const spaces = isObject(parsed) && Array.isArray(parsed.spaces) ? parsed.spaces : []
  return spaces
    .flatMap((space: unknown) => (isObject(space) && Array.isArray(space.tabs) ? space.tabs : []))
    .flatMap((tab: unknown) => {
      if (!isObject(tab) || typeof tab.id !== "string" || !Array.isArray(tab.terminals)) {
        return []
      }
      const terminals = tab.terminals.flatMap((entry: unknown) =>
        isObject(entry) && typeof entry.terminal === "string" ? [entry.terminal] : []
      )
      return [{ id: tab.id, terminals }]
    })
}

function start(cli: Cli): number {
  const brief = readBrief(cli.brief)
  const leadId = lead()
  const root = repositoryRoot(process.cwd())
  const worker = resolveConfig(root).config.worker
  const command = worker.command.split(/\s+/).filter(Boolean)
  if (command.length === 0) {
    throw new Refusal("worker.command holds no command", "set it in .ai/agentic.config.local.json, or remove the key")
  }
  const model = cli.model ?? worker.model
  const effort = cli.effort ?? worker.effort

  const live = workersOf(leadId, false).filter((candidate) => candidate.state === "live")
  if (live.length >= cli.max) {
    throw new Refusal(
      `${leadId} already has ${live.length} live Workers (the limit is ${cli.max})`,
      `carry one through first, or raise the limit with --max-workers ${live.length + 1}`
    )
  }

  const space = spaceOf(leadId)
  const ran = hcObject([
    "run",
    "--bg",
    "--json",
    "--name",
    cli.name,
    "--label",
    "role=worker",
    ...(space === undefined ? [] : ["--label", `herdr.space=${space}`]),
    "--outlive-parent",
    "--cwd",
    root,
    "--",
    ...command,
    "--worktree",
    cli.name,
    "--model",
    model,
    "--effort",
    effort,
    brief
  ])
  const { address } = ran
  if (typeof address !== "string") {
    throw new Refusal("hc run answered no address for the terminal it started", "check hc ls before starting it again")
  }

  const tab = space === undefined ? "none" : nameTab(address, cli.name)
  if (typeof tab === "object") {
    process.stderr.write(`dw-sdlc worker start: warning: ${tab.kept}\n`)
  }
  const reason = undelivered(hcObject(["get", address, "--json"]))

  const started = { name: cli.name, address, command: worker.command, model, effort, cwd: root }
  if (cli.json) {
    const tabState = typeof tab === "object" ? "kept" : tab
    const document = {
      ...started,
      delivered: reason === undefined,
      ...(reason === undefined ? {} : { reason }),
      tab: tabState
    }
    process.stdout.write(`${JSON.stringify(document, null, 2)}\n`)
  }
  if (reason !== undefined) {
    process.stderr.write(
      `dw-sdlc worker start: ${cli.name} (${address}) started but its first message was not delivered: ${reason} — ` +
        `run hc read ${address} to see why; do not send the Brief again before you have read it\n`
    )
    return 1
  }
  if (!cli.json) {
    process.stdout.write(`started ${cli.name} (${address}) on ${model} at ${effort} effort\n`)
  }
  return 0
}

export function run(argv: string[]): number {
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
    return start(cli)
  } catch (error) {
    if (error instanceof Refusal) {
      process.stderr.write(
        `dw-sdlc worker start: ${error.message}${error.remedy === undefined ? "" : ` — ${error.remedy}`}\n`
      )
      return 2
    }
    throw error
  }
}
