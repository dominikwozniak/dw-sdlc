// A failure of the Gate as every consumer reads it: one line naming the file and line where there is
// one, the rule, what is wrong and the remedy; the same as a GitHub Actions workflow annotation; the
// same as JSON.

export type Failure = {
  file?: string
  line?: number
  rule: string
  message: string
  remedy: string
  /** What the repository owner wrote to try, printed as `hint: <text>` under the failure line. */
  hint?: string
}

/** `hint: <text>` where the failure carries a Hint, nothing otherwise. */
export function hintLines({ hint }: Failure): string[] {
  return hint === undefined ? [] : [`hint: ${hint}`]
}

/** `file:line: rule: message — remedy`, without the location where the failure has none. */
export function failureLine({ file, line, rule, message, remedy }: Failure): string {
  const where = file === undefined ? "" : `${file}${line === undefined ? "" : `:${line}`}: `
  return `${where}${rule}: ${message} — ${remedy}`
}

// The escaping `@actions/core` applies to a workflow command: `%`, CR and LF in the message, and `:` and
// `,` too in a property.
function escapeData(text: string): string {
  return text.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A")
}

function escapeProperty(text: string): string {
  return escapeData(text).replaceAll(":", "%3A").replaceAll(",", "%2C")
}

/** `::error file=…,line=…,title=<rule>::<message> — <remedy>`, an annotation on the file where there is one. */
export function annotation({ file, line, rule, message, remedy }: Failure): string {
  const properties = [
    ...(file === undefined ? [] : [`file=${escapeProperty(file)}`]),
    ...(line === undefined ? [] : [`line=${line}`]),
    `title=${escapeProperty(rule)}`
  ]
  return `::error ${properties.join(",")}::${escapeData(`${message} — ${remedy}`)}`
}

/** The failure as JSON: every key present, null where it has no file or line. */
export function failureJson({ file, line, rule, message, remedy }: Failure): Record<string, unknown> {
  return { file: file ?? null, line: line ?? null, rule, message, remedy }
}
