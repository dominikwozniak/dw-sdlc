// The clock of `pr ship --wait`: the time each poll decides at, and how it passes between polls. The
// system clock and a real sleep, or under DW_SDLC_NOW a clock each poll moves on by its own wait.

import { exec } from "../exec.ts"
import { BUDGET_MINUTES } from "./ci.ts"
import { now } from "./read.ts"

/** How long `--wait` polls before it hands the wait back: the CI budget. */
const LIMIT_SECONDS = BUDGET_MINUTES * 60
/** The recheck of a wait that names none. */
const FALLBACK_SECONDS = 60
/** What a sleep may overrun its seconds by before the exec limit stops it. */
const SLEEP_SLACK_MS = 30_000

export type WaitClock = {
  /** The time the next poll decides at, milliseconds since the epoch. */
  time: () => number
  /** Whether the limit is reached. */
  spent: () => boolean
  /** Lets the wait of `recheckAfter` seconds pass, cut at the limit: a sleep, or under DW_SDLC_NOW a move of the clock. */
  pass: (recheckAfter: number | undefined) => void
}

export function waitClock(): WaitClock {
  const start = now()
  const simulated = (process.env.DW_SDLC_NOW?.trim() ?? "") !== ""
  let moved = 0
  const time = (): number => (simulated ? start + moved : Date.now())
  const elapsed = (): number => (time() - start) / 1000
  return {
    time,
    spent: () => elapsed() >= LIMIT_SECONDS,
    pass: (recheckAfter) => {
      const seconds = Math.min(recheckAfter ?? FALLBACK_SECONDS, Math.ceil(LIMIT_SECONDS - elapsed()))
      if (simulated) {
        moved += seconds * 1000
        return
      }
      exec("sleep", [String(seconds)], { limitMs: seconds * 1000 + SLEEP_SLACK_MS })
    }
  }
}
