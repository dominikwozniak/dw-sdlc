// `skill-sections`: each README section a skill copies, a part, matches its source. A part sits between
// `<!-- README.md#<anchor> -->` and `<!-- /README.md#<anchor> -->` and repeats only a section a Primitive's
// docs name. `dw-sdlc check skill-sections --write` writes each part from its section.

import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join, posix } from "node:path"

import { resolveConfig } from "../agentic-config.ts"
import { readCatalogue } from "../catalogue.ts"
import { headings, prose } from "../markdown.ts"
import { CannotRun, type Check, type Finding } from "./check.ts"
import { catalogueFile } from "./primitives.ts"
import { matching, treeFiles } from "./tree.ts"

export type SkillSectionsOptions = { files: string[] }

/** Either marker of a part: `/` before `README.md` closes it. */
const MARKER = /<!-- (\/?)README\.md#(\S+) -->/g
const WRITE = "dw-sdlc check skill-sections --write"

const REMEDIES = {
  stale: `edit the README, not the part, then run ${WRITE}`,
  readme: "write the README, or drop the part",
  section: "point it at a heading the README has",
  unpaired:
    "open a part with <!-- README.md#<anchor> --> and close it with <!-- /README.md#<anchor> -->, each on its own line",
  missing: "create it, or point gate.checks.primitives.file at the catalogue",
  invalid: "fix what dw-sdlc check primitives names"
}

type Marker = { close: boolean; anchor: string; start: number; end: number }
/** A skill file with each part written from its section, what stays wrong with it, and the parts it rewrote. */
type Rendered = { text: string; findings: Finding[]; rewritten: number }
/** What every file of one run shares: the docs the catalogue names, read once, and each README read. */
type Sources = { listed: () => Set<string>; readmes: Map<string, string | undefined> }

/** The markers outside code in `text`, in order. */
function markers(text: string): Marker[] {
  return Array.from(prose(text).matchAll(MARKER), (match) => ({
    close: match[1] === "/",
    anchor: match[2] ?? "",
    start: match.index,
    end: match.index + match[0].length
  }))
}

/** The README a skill file copies from: the one beside the `skills` directory it is in, else beside it. */
function readmeOf(path: string): string {
  const directories = path.split("/").slice(0, -1)
  const at = directories.lastIndexOf("skills")
  const unit = at === -1 ? directories : directories.slice(0, at)
  return posix.join(...unit, "README.md")
}

/** The section under the heading with `anchor`, up to the next heading of its level or above, its end trimmed. */
function sectionOf(markdown: string, anchor: string): string | undefined {
  const all = headings(markdown)
  const start = all.find((heading) => heading.anchor === anchor)
  if (start === undefined) {
    return undefined
  }
  const end = all.find((heading) => heading.line > start.line && heading.level <= start.level)
  return markdown
    .split("\n")
    .slice(start.line - 1, end === undefined ? undefined : end.line - 1)
    .join("\n")
    .trimEnd()
}

function lineAt(text: string, offset: number): number {
  return text.slice(0, offset).split("\n").length
}

function readmeText(root: string, path: string, sources: Sources): string | undefined {
  if (!sources.readmes.has(path)) {
    const full = join(root, path)
    sources.readmes.set(path, existsSync(full) ? readFileSync(full, "utf8") : undefined)
  }
  return sources.readmes.get(path)
}

function render(root: string, path: string, sources: Sources): Rendered {
  const text = readFileSync(join(root, path), "utf8")
  const readme = readmeOf(path)
  const found = markers(text)
  const findings: Finding[] = []
  const pieces: string[] = []
  let copied = 0
  let rewritten = 0
  for (let index = 0, open = found[0]; open !== undefined; open = found[++index]) {
    const close = found[index + 1]
    const line = lineAt(text, open.start)
    const fail = (message: string, remedy: string) => findings.push({ file: path, line, message, remedy })
    if (open.close || close === undefined || !close.close || close.anchor !== open.anchor) {
      const marker = `README.md#${open.anchor}`
      const message = open.close
        ? `the closing marker of ${marker} has no opening marker`
        : `the opening marker of ${marker} has no closing marker`
      fail(message, REMEDIES.unpaired)
      continue
    }
    index++
    const part = `the part from README.md#${open.anchor}`
    const source = readmeText(root, readme, sources)
    const section = source === undefined ? undefined : sectionOf(source, open.anchor)
    if (!sources.listed().has(`${readme}#${open.anchor}`)) {
      const remedy = `name ${readme}#${open.anchor} in a Primitive's docs, or point the part at a section they name`
      fail(`${part} copies a section no Primitive's docs name`, remedy)
    } else if (source === undefined) {
      fail(`${part} reads ${readme}, which does not exist`, REMEDIES.readme)
    } else if (section === undefined) {
      fail(`${part} names no heading of ${readme}`, REMEDIES.section)
    } else if (text.slice(open.end, close.start) !== `\n\n${section}\n\n`) {
      fail(`${part} differs from that section of ${readme}`, REMEDIES.stale)
      pieces.push(text.slice(copied, open.end), `\n\n${section}\n\n`)
      copied = close.start
      rewritten++
    }
  }
  pieces.push(text.slice(copied))
  return { text: pieces.join(""), findings, rewritten }
}

/** The docs entries the catalogue names, each read from the root; the catalogue is read on the first call. */
function listedDocs(root: string): () => Set<string> {
  let listed: Set<string> | undefined
  return () => {
    if (listed === undefined) {
      const file = catalogueFile(resolveConfig(root).config.gate.checks)
      const read = readCatalogue(root, file)
      if (read.state === "missing") {
        throw new CannotRun({
          file,
          message: "the catalogue does not exist, and a skill holds a part",
          remedy: REMEDIES.missing
        })
      }
      if (read.state === "invalid") {
        throw new CannotRun({
          file,
          message: "the catalogue is not valid, and a skill holds a part",
          remedy: REMEDIES.invalid
        })
      }
      listed = new Set(read.catalogue.primitives.flatMap(({ docs }) => docs).map((entry) => posix.join(".", entry)))
    }
    return listed
  }
}

function renderAll(root: string, { files }: SkillSectionsOptions): { path: string; rendered: Rendered }[] {
  const sources: Sources = { listed: listedDocs(root), readmes: new Map() }
  return matching(root, treeFiles(root), files).map((path) => ({ path, rendered: render(root, path, sources) }))
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`
}

function write(root: string, options: SkillSectionsOptions): string {
  const changed = renderAll(root, options).filter(({ rendered }) => rendered.rewritten > 0)
  for (const { path, rendered } of changed) {
    writeFileSync(join(root, path), rendered.text)
  }
  if (changed.length === 0) {
    return "every part matches its section, so nothing was written"
  }
  const parts = changed.reduce((sum, { rendered }) => sum + rendered.rewritten, 0)
  return `wrote ${plural(parts, "part")} in ${plural(changed.length, "file")}`
}

export const skillSections: Check<SkillSectionsOptions> = {
  name: "skill-sections",
  defaults: { files: ["**/skills/**/*.md"] },
  run: (root, options) => renderAll(root, options).flatMap(({ rendered }) => rendered.findings),
  write
}
