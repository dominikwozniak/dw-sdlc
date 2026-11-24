// The glob an `envFiles` list names, as the guards match it.

const GLOB_CHAR: Record<string, string> = { "*": ".*", "?": "." }

/**
 * Whether an `envFiles` glob selects the file at `relativePath` (to the repository root, or the
 * basename outside one). `*` and `?` as in a shell pattern, `*` crossing `/`; a leading `**` and a
 * slash mean at any depth. The same rule `hooks/block-env-access.sh` applies with `[[ == ]]`.
 */
export function matchesEnvGlob(glob: string, relativePath: string): boolean {
  const anyDepth = glob.startsWith("**/")
  const pattern = anyDepth ? glob.slice(3) : glob
  const source = [...pattern].map((char) => GLOB_CHAR[char] ?? char.replace(/[.+^${}()|[\]\\]/g, "\\$&")).join("")
  return new RegExp(`^${anyDepth ? "(.*/)?" : ""}${source}$`).test(relativePath)
}
