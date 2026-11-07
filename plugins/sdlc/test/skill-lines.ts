// What holds a skill's `dw-sdlc` command line to the bin's own parser: find each line a SKILL.md runs,
// fill its placeholders, and spawn the bin with `--help`. Every subcommand parses its arguments strictly
// and answers `--help` before any `gh` call or write, so a probe needs no network and changes nothing.

import { spawnSync } from "node:child_process"
import { join } from "node:path"

export type BinLine = { line: number; text: string; words: string[] }
type ProbeResult = { status: number; stderr: string }

/** What a placeholder stands for. A name not listed here stands for `x`. */
const FILLERS: Record<string, string> = { n: "1", head: "a".repeat(40) }

const BIN_LINE = /node "\$\{CLAUDE_PLUGIN_ROOT\}\/dw-sdlc\/src\/cli\.ts" ([^`\n]*)/g

/** The words of a line, a double-quoted word kept whole and unquoted. */
function wordsOf(args: string): string[] {
  return [...args.matchAll(/"([^"]*)"|\S+/g)].map(([word, quoted]) => quoted ?? word)
}

/** An optional placeholder, `[<n>]`, dropped; a required one, `<n>`, filled. A bracketed flag, `[--merge]`, is
 * unwrapped, so its name is probed. */
function fillPlaceholders(args: string): string {
  return args
    .replaceAll(/\[<[\w-]+>\]/g, "")
    .replaceAll(/\[(-[^\]]*)\]/g, "$1")
    .replaceAll(/<([\w-]+)>/g, (_, name: string) => FILLERS[name] ?? "x")
}

/** Every bin line the text names, with the line it stands on and the words it passes the bin. */
export function binLines(text: string): BinLine[] {
  return [...text.matchAll(BIN_LINE)].map((match) => {
    const args = match[1] ?? ""
    return {
      line: text.slice(0, match.index).split("\n").length,
      text: args.trim(),
      words: wordsOf(fillPlaceholders(args))
    }
  })
}

/** Spawns the plugin's own link to the bin with the line's words and `--help`. */
function probe(pluginRoot: string, { words }: BinLine): ProbeResult {
  const result = spawnSync(process.execPath, [join(pluginRoot, "dw-sdlc", "src", "cli.ts"), ...words, "--help"], {
    encoding: "utf8"
  })
  if (result.error !== undefined) {
    throw result.error
  }
  return { status: result.status ?? -1, stderr: result.stderr }
}

/** One message per line that fails the probe, naming the skill file and the line it stands on. */
export function violations(pluginRoot: string, skillPath: string, text: string): string[] {
  return binLines(text).flatMap((line) => {
    const { status, stderr } = probe(pluginRoot, line)
    return status === 0
      ? []
      : [`${skillPath}:${line.line} \`${line.text}\` exits ${status}: ${stderr.trim().split("\n")[0]}`]
  })
}
