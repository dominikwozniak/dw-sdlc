// GitHub's compare of two commits, read two ways: whether a head carries the Review of an earlier commit,
// the pull request's own changes from the base the same at both, since a merge of the base in adds none
// of its own; and the files a Review would read, with their changed lines, for `pr.review: auto`.

import { type ChangedFile, fieldOf, integer, type Node, object, ReplyError, rootOf, shown, string } from "./state.ts"

/** GitHub's compare lists at most this many files; one that lists as many may hold back the rest. */
const FILE_LIMIT = 300

/** The gh arguments of the compare from `from` to `commit`, the files on its one page. */
export function compareArgs(repo: string, from: string, commit: string): string[] {
  return ["api", `repos/${repo}/compare/${from}...${commit}?per_page=1`]
}

/** The files a compare reply lists. */
function filesOf(reply: string): Node[] {
  const { value, at } = fieldOf(rootOf(reply, "the compare"), "files")
  if (!Array.isArray(value)) {
    throw new ReplyError(`${at} is ${shown(value)}, not a list`)
  }
  return value.map((item: unknown, index) => object(item, `${at}[${index}]`))
}

/** A field the compare may leave out, as a file's patch or its previous name. */
function optional(file: Node, key: string): string | null {
  return file.value[key] === undefined || file.value[key] === null ? null : string(file, key)
}

/**
 * A file's own change: its status, its names and the lines its patch adds and removes, in order,
 * without the hunk headers and context a moved base shifts; null when the compare shows no patch.
 */
function changeOf(file: Node): string | null {
  const names = [string(file, "filename"), string(file, "status"), optional(file, "previous_filename")]
  const patch = optional(file, "patch")
  if (patch === null) {
    return null
  }
  return JSON.stringify([...names, patch.split("\n").filter((line) => /^[-+\\]/.test(line))])
}

/** The own changes a compare reply lists, file by file; null when it cannot show them whole. */
export function changesOf(reply: string): string[] | null {
  const changes = filesOf(reply).map(changeOf)
  const whole = changes.filter((change) => change !== null)
  return changes.length >= FILE_LIMIT || whole.length < changes.length ? null : whole
}

/** The files a compare reply lists with their changed lines; `unsized` when it may hold some back. */
export function changedOf(reply: string): ChangedFile[] | "unsized" {
  const files = filesOf(reply).map((file) => ({
    path: string(file, "filename"),
    previous: optional(file, "previous_filename"),
    lines: optional(file, "patch") === null ? null : integer(file, "additions") + integer(file, "deletions")
  }))
  return files.length >= FILE_LIMIT ? "unsized" : files
}

/** Whether the own changes at the head are those at the reviewed commit; unknown changes never are. */
export function sameChanges(then: string[] | null, now: string[] | null): boolean {
  if (then === null || now === null) {
    return false
  }
  return JSON.stringify(then.toSorted()) === JSON.stringify(now.toSorted())
}
