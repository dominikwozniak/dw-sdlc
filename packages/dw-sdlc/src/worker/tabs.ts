// The tab of a Worker's terminal in the herdr window: `hc run` with a `herdr.space` label opens one that herdr
// numbers, and `herdr-app` names it.

import { isObject, parseObject } from "../json-text.ts"
import { call, Refusal, said } from "./herdr.ts"

type Tab = { id: string; terminals: string[] }

/** The tabs `herdr-app ls` shows, each with the addresses of its terminals. */
function tabsOf(): Tab[] {
  const listed = call("herdr-app", ["ls"])
  if (listed.status !== 0) {
    throw new Refusal(`herdr-app ls failed: ${said(listed)}`)
  }
  const parsed = parseObject(listed.stdout)
  if (parsed === undefined) {
    throw new Refusal("herdr-app ls answered no JSON object")
  }
  const spaces = Array.isArray(parsed.spaces) ? parsed.spaces : []
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

/** The `error` of a herdr-app reply `{ "error": "..." }`. */
function errorOf(stdout: string): string | undefined {
  const parsed = parseObject(stdout)
  return typeof parsed?.error === "string" ? parsed.error : undefined
}

/** Names the tab holding `address`; `kept` says why the tab stays numbered, which is a warning and never a failure. */
export function nameTab(address: string, name: string): "renamed" | { kept: string } {
  try {
    const tab = tabsOf().find((candidate) => candidate.terminals.includes(address))
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
