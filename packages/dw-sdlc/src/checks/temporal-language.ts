// `temporal-language`: a durable document says what is true, not what changed. A phrase of kody's list,
// as `docs/research/gate/kody.md` records it, fails it across a line break and never inside code;
// decision records, research notes and changelogs record a point in time and are exempt by default.

import { readFileSync } from "node:fs"
import { join } from "node:path"

import { prose } from "../markdown.ts"
import type { Check, Finding } from "./check.ts"
import { matching, treeFiles } from "./tree.ts"

export type TemporalLanguageOptions = { files: string[]; exempt: string[] }

const REMEDY = "describe what is true, in the present tense, as if written from scratch"

/** Between two words: one space, or a line break and the next line's indent. */
const GAP = String.raw`(?: |\n[ \t]*)`

function phrase(...words: string[]): RegExp {
  return new RegExp(String.raw`\b${words.join(GAP)}\b`, "gi")
}

const PHRASES = [
  phrase("now", "we"),
  phrase("we", "now"),
  phrase("we", "no", "longer"),
  phrase("previously", "we"),
  phrase("as", "before"),
  phrase("were", String.raw`\*{0,2}removed`),
  phrase("(?:was|were)", String.raw`\*{0,2}retired`),
  phrase("no", "longer", "(?:support|accept|require|use|fan|carry|replay|incur|authoritative|insert|needed)s?"),
  phrase("is", "now", "(?:a|an|the)"),
  phrase("are", "now"),
  phrase("previously", "(?:a|the)"),
  phrase("recently", "(?:changed|added|updated|removed|introduced)"),
  phrase("used", "to", "(?:support|require)")
]

/** Each phrase in `text` in the order it reads, one that overlaps an earlier hit, as `we no longer support` does, folded into it. */
function hits(text: string): RegExpExecArray[] {
  let end = 0
  return PHRASES.flatMap((pattern) => Array.from(text.matchAll(pattern)))
    .toSorted((a, b) => a.index - b.index)
    .filter((hit) => {
      const overlaps = hit.index < end
      end = Math.max(end, hit.index + hit[0].length)
      return !overlaps
    })
}

function run(root: string, { files, exempt }: TemporalLanguageOptions): Finding[] {
  return matching(root, treeFiles(root), files, exempt).flatMap((file) => {
    const text = prose(readFileSync(join(root, file), "utf8"))
    return hits(text).map((hit) => ({
      file,
      line: text.slice(0, hit.index).split("\n").length,
      message: `${JSON.stringify(hit[0].replace(/\s+/g, " "))} reads as a changelog`,
      remedy: REMEDY
    }))
  })
}

export const temporalLanguage: Check<TemporalLanguageOptions> = {
  name: "temporal-language",
  defaults: {
    files: ["**/*.md"],
    exempt: ["docs/adr/**", "docs/decisions/**", "docs/research/**", "**/CHANGELOG.md"]
  },
  run
}
