// The text of a JSON object file as the setup commands read and write it: parsed only when it holds an
// object, rendered two spaces in, and a key appended so a hand-formatted file keeps its layout.

export type JsonObject = Record<string, unknown>

export function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** The JSON object `text` holds, or undefined when it holds anything else. */
export function parseObject(text: string): JsonObject | undefined {
  try {
    const parsed: unknown = JSON.parse(text)
    return isObject(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

export function render(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

/** `text`, a JSON object, with `key` set to `value` after its last key, two spaces in. */
export function appendKey(text: string, key: string, value: unknown): string {
  const close = text.lastIndexOf("}")
  const body = text.slice(0, close).trimEnd()
  const comma = body.endsWith("{") ? "" : ","
  const rendered = JSON.stringify(value, null, 2).replaceAll("\n", "\n  ")
  return `${body}${comma}\n  ${JSON.stringify(key)}: ${rendered}\n${text.slice(close)}`
}
