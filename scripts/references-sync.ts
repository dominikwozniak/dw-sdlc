// Clones every repository the references/AGENTS.md table lists into references/<dir>, or moves a clone
// that is already there to the head of its branch. The clones are gitignored — only the router is
// tracked — so nothing this writes reaches a commit, and it may run on any branch. Each clone is
// shallow, and sparse when its row's `skip` cell names paths to leave out.

import { spawnSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { parseArgs } from "node:util"

const ROUTER = "references/AGENTS.md"

const USAGE = `Usage: pnpm references:sync [dir...]

Clones every repository in the ${ROUTER} table into references/<dir>, or updates the clone already
there to the head of its branch; only the given dirs when named. Shallow, and without the paths a
row's skip cell names. Exit 1 when any repository fails, 2 on a bad table or argument.`

export type Reference = { dir: string; repository: string; branch: string; skip: string[] }

function fail(message: string, code: 1 | 2): never {
  console.error(`references:sync: ${message}`)
  process.exit(code)
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function git(args: string[], cwd?: string): { ok: boolean; out: string; err: string } {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" })
  return { ok: result.status === 0, out: result.stdout.trim(), err: result.stderr.trim() }
}

function cells(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|")
}

function unquote(cell: string): string {
  return cell.trim().replace(/^`(.*)`$/, "$1")
}

/** The skip cell: every backticked path in it; empty, `—` or `-` is none. */
function skipPaths(cell: string): string[] {
  const paths = [...cell.matchAll(/`([^`]+)`/g)].map((match) => match[1] ?? "")
  for (const path of paths) {
    if (path.startsWith("/") || path.split("/").includes("..")) {
      throw new Error(`skip path "${path}" must be relative to the clone and stay inside it`)
    }
  }
  return paths
}

export function parseReferences(markdown: string): Reference[] {
  const lines = markdown.split(/\r?\n/)
  const start = lines.indexOf("## Repositories")
  if (start === -1) {
    throw new Error('no "## Repositories" section')
  }

  const table: string[][] = []
  for (const line of lines.slice(start + 1)) {
    if (line.trim().startsWith("|")) {
      table.push(cells(line))
    } else if (table.length > 0 || line.startsWith("## ")) {
      break
    }
  }

  const [header, separator, ...rows] = table
  if (header === undefined || separator === undefined || !separator.every((cell) => /^\s*:?-+:?\s*$/.test(cell))) {
    throw new Error("the Repositories table needs a header row and a separator row")
  }
  const names = header.map(unquote)
  const column = (name: string): number => {
    const index = names.indexOf(name)
    if (index === -1) {
      throw new Error(`the Repositories table has no "${name}" column`)
    }
    return index
  }
  const [dirAt, repositoryAt, branchAt, skipAt] = [
    column("dir"),
    column("repository"),
    column("branch"),
    column("skip")
  ]

  return rows.map((row, index) => {
    const [dir, repository, branch] = [dirAt, repositoryAt, branchAt].map((at) => unquote(row[at] ?? ""))
    if (dir === undefined || !/^[\w.-]+$/.test(dir) || repository === undefined || repository === "" || !branch) {
      throw new Error(`row ${index + 1} needs a single-directory dir, a repository and a branch`)
    }
    return { dir, repository, branch, skip: skipPaths(row[skipAt] ?? "") }
  })
}

/** Clones or updates one reference; the reason it failed, or undefined. */
function sync(root: string, reference: Reference): string | undefined {
  const { dir, repository, branch, skip } = reference
  const target = join(root, "references", dir)
  const step = (args: string[], cwd?: string): void => {
    const result = git(args, cwd)
    if (!result.ok) {
      throw new Error(`git ${args.join(" ")}: ${result.err}`)
    }
  }
  try {
    if (existsSync(target)) {
      const origin = git(["remote", "get-url", "origin"], target)
      if (!existsSync(join(target, ".git")) || !origin.ok || origin.out !== repository) {
        return `references/${dir} exists and is not a clone of ${repository}; move it aside and run again`
      }
      step(["fetch", "--quiet", "--depth", "1", "origin", branch], target)
    } else {
      const clone = ["clone", "--quiet", "--depth", "1", "--single-branch", "--branch", branch]
      step([...clone, "--no-checkout", "--filter=blob:none", repository, target])
    }
    if (skip.length > 0) {
      step(["sparse-checkout", "set", "--no-cone", "/*", ...skip.map((path) => `!/${path}`)], target)
    } else {
      step(["sparse-checkout", "disable"], target)
    }
    // Detached at the fetched head: a local edit the update would overwrite fails the row instead.
    step(["checkout", "--quiet", "--detach", `refs/remotes/origin/${branch}`], target)
  } catch (error) {
    return messageOf(error)
  }
  return undefined
}

function parseCli(argv: string[]): { help: boolean; dirs: string[] } {
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: { help: { type: "boolean", short: "h" } }
    })
    return { help: values.help === true, dirs: positionals }
  } catch (error) {
    fail(`${messageOf(error)}\n\n${USAGE}`, 2)
  }
}

function main(argv: string[]): void {
  const cli = parseCli(argv)
  if (cli.help) {
    console.log(USAGE)
    return
  }

  const toplevel = git(["rev-parse", "--show-toplevel"])
  if (!toplevel.ok) {
    fail(`not inside a git repository: ${toplevel.err}`, 2)
  }
  const root = toplevel.out
  let references: Reference[]
  try {
    references = parseReferences(readFileSync(join(root, ROUTER), "utf8"))
  } catch (error) {
    fail(`${ROUTER}: ${messageOf(error)}`, 2)
  }

  const unknown = cli.dirs.filter((dir) => !references.some((reference) => reference.dir === dir))
  if (unknown.length > 0) {
    fail(`not listed in ${ROUTER}: ${unknown.join(", ")}`, 2)
  }
  const selected =
    cli.dirs.length === 0 ? references : references.filter((reference) => cli.dirs.includes(reference.dir))

  const failures: string[] = []
  for (const reference of selected) {
    const problem = sync(root, reference)
    if (problem === undefined) {
      const head = git(["rev-parse", "--short", "HEAD"], join(root, "references", reference.dir)).out
      console.log(`references/${reference.dir}  ${head}  ${reference.repository} ${reference.branch}`)
    } else {
      failures.push(problem)
      console.error(`references/${reference.dir}  FAILED  ${problem}`)
    }
  }

  const listed = new Set(references.map((reference) => reference.dir))
  const stray = readdirSync(join(root, "references"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !listed.has(entry.name))
    .map((entry) => entry.name)
  if (stray.length > 0) {
    console.log(`Not listed in ${ROUTER}, left alone: ${stray.map((dir) => `references/${dir}`).join(", ")}`)
  }
  if (failures.length > 0) {
    process.exit(1)
  }
}

if (import.meta.main) {
  main(process.argv.slice(2))
}
