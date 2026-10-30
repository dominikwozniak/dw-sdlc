// The text of a JSON object file as the setup commands read and write it: parsed only when it holds an
// object, rendered two spaces in, and a key appended or removed so a hand-formatted file keeps its layout.

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

/** The index just past the JSON string that opens at `start`. */
function stringEnd(text: string, start: number): number {
  let index = start + 1
  while (text[index] !== '"') {
    index += text[index] === "\\" ? 2 : 1
  }
  return index + 1
}

/** The start and end of the top-level member `key` in `text`, a JSON object, from its name to its value's end. */
function memberSpan(text: string, key: string): { start: number; end: number } | undefined {
  let depth = 0
  let expectKey = false
  let start: number | undefined
  let lastValue = 0
  for (let index = 0; index < text.length;) {
    const char = text.charAt(index)
    if (char === '"') {
      const end = stringEnd(text, index)
      if (depth === 1 && expectKey) {
        expectKey = false
        if (start === undefined && JSON.parse(text.slice(index, end)) === key) {
          start = index
        }
      }
      lastValue = end
      index = end
      continue
    }
    if (char === "{" || char === "[") {
      depth += 1
      expectKey = char === "{" && depth === 1
    } else if (char === "}" || char === "]") {
      depth -= 1
      if (depth === 0 && start !== undefined) {
        return { start, end: lastValue }
      }
    } else if (char === "," && depth === 1) {
      if (start !== undefined) {
        return { start, end: lastValue }
      }
      expectKey = true
    }
    if (!/\s/.test(char)) {
      lastValue = index + 1
    }
    index += 1
  }
  return undefined
}

/** `text`, a JSON object, without its top-level `key`; the members around it keep their layout. */
export function removeKey(text: string, key: string): string {
  const span = memberSpan(text, key)
  if (span === undefined) {
    return text
  }
  const after = text.slice(span.end).match(/^\s*,\s*/)
  if (after !== null) {
    return text.slice(0, span.start) + text.slice(span.end + after[0].length)
  }
  const before = text.slice(0, span.start).match(/,?\s*$/)
  const cut = span.start - (before?.[0].length ?? 0)
  return text.slice(0, cut) + text.slice(span.end)
}
