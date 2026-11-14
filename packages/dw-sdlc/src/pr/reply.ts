// The reply of a gh call read as JSON: each field checked as the type the reader asks for, and a
// reply that fails names the field by its path.

/** A reply that is not the shape the query asks for; the message names the field. */
export class ReplyError extends Error {}

/** A JSON object of the reply and the path that reached it, as `data.repository.pullRequest`. */
export type Node = { value: Record<string, unknown>; at: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function shown(value: unknown): string {
  return value === undefined ? "missing" : JSON.stringify(value)
}

/** The JSON object `reply` holds, the root its fields' paths start from; `what` names it in a problem. */
export function rootOf(reply: string, what: string): Node {
  let json: unknown
  try {
    json = JSON.parse(reply)
  } catch {
    throw new ReplyError(`${what} is not JSON`)
  }
  if (!isRecord(json)) {
    throw new ReplyError(`${what} is not a JSON object`)
  }
  return { value: json, at: "" }
}

export function fieldOf(node: Node, key: string): { value: unknown; at: string } {
  return { value: node.value[key], at: node.at === "" ? key : `${node.at}.${key}` }
}

export function object(value: unknown, at: string): Node {
  if (!isRecord(value)) {
    throw new ReplyError(`${at} is ${shown(value)}, not an object`)
  }
  return { value, at }
}

export function child(node: Node, key: string): Node {
  const { value, at } = fieldOf(node, key)
  return object(value, at)
}

export function childOrNull(node: Node, key: string): Node | null {
  const { value, at } = fieldOf(node, key)
  return value === null ? null : object(value, at)
}

export function string(node: Node, key: string): string {
  const { value, at } = fieldOf(node, key)
  if (typeof value !== "string") {
    throw new ReplyError(`${at} is ${shown(value)}, not a string`)
  }
  return value
}

export function stringOrNull(node: Node, key: string): string | null {
  return node.value[key] === null ? null : string(node, key)
}

export function boolean(node: Node, key: string): boolean {
  const { value, at } = fieldOf(node, key)
  if (typeof value !== "boolean") {
    throw new ReplyError(`${at} is ${shown(value)}, not a boolean`)
  }
  return value
}

export function integer(node: Node, key: string): number {
  const { value, at } = fieldOf(node, key)
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new ReplyError(`${at} is ${shown(value)}, not an integer`)
  }
  return value
}

export function integerOrNull(node: Node, key: string): number | null {
  const { value, at } = fieldOf(node, key)
  if (value !== null && !Number.isInteger(value)) {
    throw new ReplyError(`${at} is ${shown(value)}, not an integer or null`)
  }
  return typeof value === "number" ? value : null
}

/** A time as GitHub writes it, ISO 8601; the decision reads it as one. */
export function time(node: Node, key: string): string {
  const value = string(node, key)
  if (Number.isNaN(Date.parse(value))) {
    throw new ReplyError(`${fieldOf(node, key).at} is ${shown(value)}, not a time`)
  }
  return value
}

export function timeOrNull(node: Node, key: string): string | null {
  return node.value[key] === null ? null : time(node, key)
}

export function isOneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return values.some((known) => known === value)
}

export function oneOf<T extends string>(node: Node, key: string, values: readonly T[]): T {
  const { value, at } = fieldOf(node, key)
  if (!isOneOf(values, value)) {
    throw new ReplyError(`${at} is ${shown(value)}, not one of ${values.join(", ")}`)
  }
  return value
}

/** The objects of a connection's `nodes`. */
export function nodes(node: Node, key: string): Node[] {
  const { value, at } = fieldOf(child(node, key), "nodes")
  if (!Array.isArray(value)) {
    throw new ReplyError(`${at} is ${shown(value)}, not a list`)
  }
  return value.map((item: unknown, index) => object(item, `${at}[${index}]`))
}

/** Whether a connection has more nodes after the ones the reply holds. */
export function hasMore(node: Node, key: string): boolean {
  return boolean(child(child(node, key), "pageInfo"), "hasNextPage")
}

/** The first object of a connection's `nodes`; an empty connection does not parse. */
export function firstNode(node: Node, key: string): Node {
  const [first] = nodes(node, key)
  if (first === undefined) {
    throw new ReplyError(`${node.at}.${key}.nodes is empty`)
  }
  return first
}
