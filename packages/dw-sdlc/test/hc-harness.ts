// The Worker commands' seam: a fake `hc` and a fake `herdr-app` first on PATH, answering from a scenario and
// logging every call, as the fake `gh` of the Ship script does, and the builders for the JSON herdr prints.

import { chmodSync, existsSync, readFileSync } from "node:fs"
import { delimiter, join } from "node:path"

import { lines, scratch, write, writeJson } from "./harness.ts"

const FAKE = join(import.meta.dirname, "fake-hc.ts")

/** What one call prints and exits with; an empty one prints nothing and exits 0. */
export type Reply = { stdout?: string; stderr?: string; exit?: number }
/** A tool's table: a call's first two words, else its first, to one reply or to the replies served in order. */
export type Table = Record<string, Reply | Reply[]>
export type Scenario = { hc?: Table; "herdr-app"?: Table }

export type FakeHerdr = {
  /** The environment that puts both tools first on PATH, the calling terminal `t1` unless a test says otherwise. */
  env: NodeJS.ProcessEnv
  /** Every `hc` call's arguments in order. */
  hcCalls: () => string[][]
  /** Every `herdr-app` call's arguments in order. */
  appCalls: () => string[][]
}

export function fakeHerdr(scenario: Scenario, caller = "t1"): FakeHerdr {
  const dir = scratch("hc")
  writeJson(join(dir, "scenario.json"), scenario)
  for (const tool of ["hc", "herdr-app"]) {
    const bin = join(dir, tool)
    write(bin, `#!/bin/sh\nexec "${process.execPath}" "${FAKE}" "${dir}" ${tool} "$@"\n`)
    chmodSync(bin, 0o755)
  }
  const calls = (tool: string): string[][] => {
    const log = join(dir, `${tool}.jsonl`)
    return existsSync(log) ? lines(readFileSync(log, "utf8")).map((line) => JSON.parse(line) as string[]) : []
  }
  return {
    env: { PATH: `${dir}${delimiter}${process.env.PATH ?? ""}`, HC_TERMINAL_ID: caller },
    hcCalls: () => calls("hc"),
    appCalls: () => calls("herdr-app")
  }
}

/** A terminal as `hc ls --json` lists it; a status is the word alone, and a terminal that never reported has none. */
export type Listed = {
  address: string
  name?: string
  parent?: string
  state?: "live" | "finished"
  status?: string
  cwd?: string
}

/** The reply of `hc ls --json`. */
export function listing(...terminals: Listed[]): Reply {
  const body = terminals.map(({ state = "live", cwd = "/work/repo", ...rest }) => ({
    agent: "claude-code",
    turn: 0,
    ...rest,
    state,
    cwd
  }))
  return { stdout: JSON.stringify({ hidden_finished: 0, terminals: body }) }
}

/** The reply of `hc get --json` or `hc run --bg --json`: a terminal, its status a record, a first message when one failed. */
export function terminal(
  address: string,
  extra: {
    name?: string
    parent?: string
    state?: string
    status?: string | null
    labels?: Record<string, string>
    firstMessage?: { sent: boolean; reason?: string }
  } = {}
): Reply {
  const { name, parent, state = "live", status = "working", labels = {}, firstMessage } = extra
  return {
    stdout: JSON.stringify({
      address,
      name: name ?? null,
      parent: parent ?? null,
      state,
      labels,
      ...(status === null ? {} : { status: { app: "claude-code", state: status } }),
      ...(firstMessage === undefined ? {} : { first_message: firstMessage })
    })
  }
}

/** The reply of `herdr-app ls`: one space whose tabs hold the terminals named. */
export function layout(tabs: Record<string, string[]>): Reply {
  const body = Object.entries(tabs).map(([id, terminals]) => ({
    id,
    name: "1",
    terminals: terminals.map((address) => ({ terminal: address, status: null, app: null, name: null }))
  }))
  return { stdout: JSON.stringify({ spaces: [{ id: "sp1", name: "repo", tabs: body }] }) }
}
