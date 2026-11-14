// How `dw-sdlc setup` and `dw-sdlc references setup` write a file: only when its text would change,
// nothing under --dry-run, and one line a file saying what the step did or would do.

import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"

/** `by hand` is an edit the setup names and leaves to the user; `skipped` is a file it has no reason to write. */
export type Outcome = "wrote" | "unchanged" | "skipped" | "refused" | "by hand"
export type Step = { file: string; outcome: Outcome; detail?: string }
/** A file's text after the step and what writing it does, or why the step leaves the file alone. */
export type Change = { text: string; detail?: string | undefined } | { refusal: string }

export class Writer {
  readonly steps: Step[] = []
  private readonly dryRun: boolean
  constructor(dryRun: boolean) {
    this.dryRun = dryRun
  }

  private record(file: string, outcome: Outcome, detail: string | undefined): void {
    this.steps.push(detail === undefined ? { file, outcome } : { file, outcome, detail })
  }

  /**
   * The file at `path`, recorded under `label`, as `change` leaves it, or as it leaves the text the file
   * holds now: written when the text differs, unchanged when it does not, else refused.
   */
  apply(label: string, path: string, change: Change | ((current: string | undefined) => Change)): void {
    const current = existsSync(path) ? readFileSync(path, "utf8") : undefined
    const next = typeof change === "function" ? change(current) : change
    if ("refusal" in next) {
      this.record(label, "refused", next.refusal)
      return
    }
    if (next.text === current) {
      this.record(label, "unchanged", undefined)
      return
    }
    if (!this.dryRun) {
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, next.text)
    }
    this.record(label, "wrote", next.detail)
  }

  /** The file at `path`, made by `make` when nothing sits there, a dangling symlink included; never replaced. */
  create(label: string, path: string, make: (path: string) => void): void {
    const absent = lstatSync(path, { throwIfNoEntry: false }) === undefined
    if (absent && !this.dryRun) {
      mkdirSync(dirname(path), { recursive: true })
      make(path)
    }
    this.record(label, absent ? "wrote" : "unchanged", undefined)
  }

  refuse(label: string, detail: string): void {
    this.record(label, "refused", detail)
  }

  skip(label: string, detail: string): void {
    this.record(label, "skipped", detail)
  }

  byHand(label: string, detail: string): void {
    this.record(label, "by hand", detail)
  }
}

/** One line a step: what it did, or would do under `dryRun`, the file, and why where it says. */
export function stepLines(steps: Step[], dryRun: boolean): string[] {
  return steps.map(({ file, outcome, detail }) => {
    const verb = outcome === "wrote" && dryRun ? "would write" : outcome
    return `${verb.padEnd(11)} ${file}${detail === undefined ? "" : ` — ${detail}`}`
  })
}
