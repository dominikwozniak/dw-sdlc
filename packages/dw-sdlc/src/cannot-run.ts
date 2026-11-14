// What stops a command before it reaches a verdict: exit 2, one problem and, where there is one, its
// remedy. The bin alone prints it, as `dw-sdlc <command>: <problem> — <remedy>`; the Gate reports a
// Check's as one of its failures. A command line the command cannot read carries its usage below.

import { parseArgs, type ParseArgsConfig } from "node:util"

/** Where the problem sits, and what the bin prints below its line. */
export type Detail = {
  /** The file, and its line, of an input a Check reads. */
  file?: string
  line?: number
  /** Lines the bin prints below the problem's, as a command's usage. */
  after?: string
}

export class CannotRun extends Error {
  readonly remedy: string | undefined
  readonly detail: Detail

  constructor(message: string, remedy?: string, detail: Detail = {}) {
    super(message)
    this.remedy = remedy
    this.detail = detail
  }

  /** The same problem, with `remedy` where it names none. */
  orRemedy(remedy: string): CannotRun {
    return this.remedy === undefined ? new CannotRun(this.message, remedy, this.detail) : this
  }
}

/** What an error says, whatever was thrown. */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** A command line the command cannot read: the problem, then its usage after an empty line. */
export function usageError(problem: string, usage: string): CannotRun {
  return new CannotRun(problem, undefined, { after: `\n${usage}` })
}

/** `parseArgs` over a command line; one it cannot read stops the command with its usage. */
export function readArgs<T extends ParseArgsConfig>(config: T, usage: string): ReturnType<typeof parseArgs<T>> {
  try {
    return parseArgs(config)
  } catch (error) {
    throw usageError(messageOf(error), usage)
  }
}
