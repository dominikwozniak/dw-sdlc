# Which env files an agent may read is a list in the config, with git as the fallback

Every repository has its own idea of which env files are safe to read — one commits a secret-free
`.env` and `.env.test` and ignores `.env.development` — and a guard that derives the answer from one rule of
its own, whatever the rule, asks every repository to fit it. `guardrails.envFiles` is therefore an
object: a `deny` list, an `allow` list and a `policy` for the rest, judged in that order, the lists
as globs relative to the repository root. Git stays as the default `policy` rather than being
replaced by the list, because `git ls-files` is an allow list the repository already maintains, so a
repository with no config keeps working. The lists obey the tighten-only rule of ADR 0003 in the
only rank a list has: the local layer may drop from `allow` and add to `deny`, never the reverse.

## Consequences

`envFiles` is an object in the schema: a string there fails validation and the repository
runs strictest until it is rewritten. The strictest set is `policy: deny` with both
lists empty, which refuses even the example names while a layer is broken. A file listed in `allow`
is readable even when git ignores it, so an entry there is a statement that the file holds no
secret. Pure name-based rules, a list with no git fallback, and a per-stack exception were rejected.
