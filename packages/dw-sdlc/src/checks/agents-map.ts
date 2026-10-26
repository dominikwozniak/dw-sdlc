// `agents-map`: the agent map stays a map. Within its budget, naming the Gate command, routing to the
// Primitives catalogue, every path its Task Router points at existing, and the skills directory, its
// lock and its links in step.

import { existsSync, globSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs"
import { join } from "node:path"

import { resolveConfig } from "../agentic-config.ts"
import { codeSpans, tableRows } from "../markdown.ts"
import { CannotRun, type Check, type Finding } from "./check.ts"
import { catalogueFile } from "./primitives.ts"

export type AgentsMapOptions = { file: string; maxLines: number; maxBytes: number }

const ROUTER = "Task Router"
const AGENTS_SKILLS = ".agents/skills"
const CLAUDE_SKILLS = ".claude/skills"
const LOCK = "skills-lock.json"

const REMEDIES = {
  missing: "write it, or point gate.checks.agents-map.file at the map",
  budget: `cut it, or move a topic into a doc a ${ROUTER} row points at`,
  command: "name it where the map lists the commands",
  noCommand: "set gate.command in the agentic config, or give package.json a check script",
  catalogue: "add a row that sends an agent to the catalogue",
  route: "fix the path or drop it from the row",
  unlocked: "add it through the skills CLI, or remove the directory",
  unheld: "restore the skill, or drop it from the lock",
  lock: "fix it, or write it again through the skills CLI",
  stray: `remove it, or move the skill into ${AGENTS_SKILLS}`
}

/** A code span that names a path: no spaces, and a slash or a file extension; `*` makes it a glob. */
function isPath(span: string): boolean {
  return /^[\w.*/-]+$/.test(span) && (span.includes("/") || /\.\w+$/.test(span))
}

function exists(root: string, path: string): boolean {
  return path.includes("*") ? globSync(path, { cwd: root }).length > 0 : existsSync(join(root, path))
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** The budget, the Gate command, the row to the catalogue and every path the Task Router points at. */
function judgeMap(root: string, { file, maxLines, maxBytes }: AgentsMapOptions, text: string): Finding[] {
  const findings: Finding[] = []
  const lines = text.endsWith("\n") ? text.split("\n").length - 1 : text.split("\n").length
  if (lines > maxLines) {
    findings.push({ file, message: `${lines} lines, over the ${maxLines}-line budget`, remedy: REMEDIES.budget })
  }
  const bytes = Buffer.byteLength(text)
  if (bytes > maxBytes) {
    findings.push({ file, message: `${bytes} bytes, over the ${maxBytes}-byte budget`, remedy: REMEDIES.budget })
  }

  const { gate } = resolveConfig(root).config
  if (gate.command === undefined) {
    findings.push({ message: "the Gate has no command for the map to name", remedy: REMEDIES.noCommand })
  } else if (!new RegExp(`(^|[^\\w-])${escape(gate.command)}($|[^\\w-])`, "m").test(text)) {
    const message = `does not name the Gate command ${JSON.stringify(gate.command)}`
    findings.push({ file, message, remedy: REMEDIES.command })
  }

  // The first column says when a row applies; the others say what to read.
  const routes = tableRows(text, ROUTER).map(({ cells, line }) => ({
    line,
    paths: codeSpans(cells.slice(1).join(" ")).filter(isPath)
  }))
  const catalogue = catalogueFile(gate.checks)
  if (existsSync(join(root, catalogue)) && !routes.some(({ paths }) => paths.includes(catalogue))) {
    const message = `no ${ROUTER} row points at ${catalogue}`
    findings.push({ file, message, remedy: REMEDIES.catalogue })
  }
  for (const { line, paths } of routes) {
    for (const missing of paths.filter((path) => !exists(root, path))) {
      const message = `the ${ROUTER} points at ${JSON.stringify(missing)}, which does not exist`
      findings.push({ file, line, message, remedy: REMEDIES.route })
    }
  }
  return findings
}

/** The names of the directories in `dir`, sorted; empty when there is no `dir`. */
function directories(dir: string): string[] {
  if (!existsSync(dir)) {
    return []
  }
  return readdirSync(dir)
    .filter((name) => statSync(join(dir, name), { throwIfNoEntry: false })?.isDirectory() === true)
    .toSorted()
}

/** The skills `skills-lock.json` pins, or why it cannot be read. */
function lockedSkills(root: string): string[] | { problem: string } {
  let lock: unknown
  try {
    lock = JSON.parse(readFileSync(join(root, LOCK), "utf8"))
  } catch (error) {
    return { problem: `not JSON: ${error instanceof Error ? error.message : String(error)}` }
  }
  if (typeof lock !== "object" || lock === null || !("skills" in lock)) {
    return { problem: "it has no skills object" }
  }
  const { skills } = lock
  if (typeof skills !== "object" || skills === null || Array.isArray(skills)) {
    return { problem: "it has no skills object" }
  }
  return Object.keys(skills).toSorted()
}

/**
 * The skills directory, `.agents/skills` or else `.claude/skills`, against the lock where there is one,
 * and `.agents/skills` against the links `.claude/skills` holds to it where there are both.
 */
function judgeSkills(root: string): Finding[] {
  const dir = existsSync(join(root, AGENTS_SKILLS)) ? AGENTS_SKILLS : CLAUDE_SKILLS
  const skills = directories(join(root, dir))
  const findings: Finding[] = []

  if (existsSync(join(root, LOCK))) {
    const locked = lockedSkills(root)
    if ("problem" in locked) {
      findings.push({ file: LOCK, message: `not a skills lock: ${locked.problem}`, remedy: REMEDIES.lock })
    } else {
      for (const skill of skills.filter((name) => !locked.includes(name))) {
        const message = `skill ${JSON.stringify(skill)} is not in ${LOCK}`
        findings.push({ file: `${dir}/${skill}`, message, remedy: REMEDIES.unlocked })
      }
      for (const skill of locked.filter((name) => !skills.includes(name))) {
        const message = `locks skill ${JSON.stringify(skill)}, which ${dir} does not hold`
        findings.push({ file: LOCK, message, remedy: REMEDIES.unheld })
      }
    }
  }

  if (dir === AGENTS_SKILLS && existsSync(join(root, CLAUDE_SKILLS))) {
    const entries = readdirSync(join(root, CLAUDE_SKILLS)).toSorted()
    for (const skill of skills) {
      const file = `${CLAUDE_SKILLS}/${skill}`
      const remedy = `link it to ../../${AGENTS_SKILLS}/${skill}`
      if (!entries.includes(skill)) {
        findings.push({ file, message: `skill ${JSON.stringify(skill)} has no link here`, remedy })
      } else if (!linksTo(join(root, file), join(root, AGENTS_SKILLS, skill))) {
        findings.push({ file, message: `is not a link to ${AGENTS_SKILLS}/${skill}`, remedy })
      }
    }
    for (const entry of entries.filter((name) => !skills.includes(name))) {
      const message = `${AGENTS_SKILLS} holds no skill ${JSON.stringify(entry)}`
      findings.push({ file: `${CLAUDE_SKILLS}/${entry}`, message, remedy: REMEDIES.stray })
    }
  }
  return findings
}

/** Whether `link` is a symbolic link that resolves to `target`. */
function linksTo(link: string, target: string): boolean {
  if (!lstatSync(link).isSymbolicLink()) {
    return false
  }
  try {
    return realpathSync(link) === realpathSync(target)
  } catch {
    return false
  }
}

function run(root: string, options: AgentsMapOptions): Finding[] {
  const path = join(root, options.file)
  if (!existsSync(path)) {
    throw new CannotRun({ file: options.file, message: "the map does not exist", remedy: REMEDIES.missing })
  }
  return [...judgeMap(root, options, readFileSync(path, "utf8")), ...judgeSkills(root)]
}

export const agentsMap: Check<AgentsMapOptions> = {
  name: "agents-map",
  defaults: { file: "AGENTS.md", maxLines: 150, maxBytes: 10240 },
  run
}
