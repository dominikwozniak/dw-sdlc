# The merge scripts/agentic-config.ts performs, for the guards: the same defaults, the same tighten
# rule, the same messages. That file and its tests are the reference; the tests run this too.
#
# `resolve($inferred; $committed; $local)` takes the inferred layer (commit.convention, packageManagers),
# the committed and local documents (null when absent or invalid) and returns {config, problems},
# where problems are the local loosenings. The caller puts guardrails on `strictest` when any layer
# had a problem.

def local_file: ".ai/agentic.config.local.json";

# Strictest value first; the local override may only move towards the front.
def strictness: {forcePush: ["deny", "lease"], envFiles: ["deny", "git"]};

def strictest: {
  forcePush: "deny",
  envFiles: {policy: "deny", allow: [], deny: []},
  protectedBranches: ["master", "main", "production"]
};

# The preset each commit.convention names. `ticket-key` is a ticket key ahead of a short type list;
# `conventional` is Conventional Commits. Both POSIX ERE, because `grep -E` runs them.
def commit_patterns: {
  "ticket-key": "^\\[[A-Z]+-[0-9]+\\] (feat|fix|refactor|docs|chore|test|perf|ci): .+",
  conventional: "^(build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test)(\\([^)]+\\))?!?: .+"
};

def defaults($inferred): {
  version: 1,
  baseBranch: "auto",
  packageManagers: $inferred.packageManagers,
  guardrails: {
    forcePush: "lease",
    envFiles: {policy: "git", allow: ["**/.env.example", "**/.env.sample", "**/.env.template"], deny: []},
    protectedBranches: ["master", "main", "production"]
  },
  commit: {convention: $inferred.commit.convention},
  validation: {commands: []},
  worktree: {setup: []}
};

# guardrails.envFiles merges key by key, each list wholesale; the other guardrails as one value.
def apply($layer):
  . as $base
  | {
      version: 1,
      baseBranch: ($layer.baseBranch // $base.baseBranch),
      packageManagers: ($base.packageManagers + ($layer.packageManagers // {})),
      guardrails: (($base.guardrails + ($layer.guardrails // {}))
        | .envFiles = ($base.guardrails.envFiles + ($layer.guardrails.envFiles // {}))),
      commit: ($base.commit + ($layer.commit // {})),
      validation: {commands: ($layer.validation.commands // $base.validation.commands)},
      worktree: {setup: ($layer.worktree.setup // $base.worktree.setup)}
    };

def _rank($key; $value): strictness[$key] | index($value);

def _problem($path; $message): {file: local_file, path: $path, message: $message};

# Every guardrail the local layer sets less strictly than what it would override: a lower-ranked
# forcePush or envFiles.policy, a dropped protected branch, an added envFiles.allow entry, a dropped
# envFiles.deny entry.
def loosenings($base; $local):
  if $local == null then []
  else [
    (select($local.forcePush != null and _rank("forcePush"; $local.forcePush) > _rank("forcePush"; $base.forcePush))
      | _problem("guardrails.forcePush";
          "\($local.forcePush | tojson) loosens \($base.forcePush | tojson); the local file may tighten guardrails, never loosen them")),
    (select($local.envFiles.policy != null
        and _rank("envFiles"; $local.envFiles.policy) > _rank("envFiles"; $base.envFiles.policy))
      | _problem("guardrails.envFiles.policy";
          "\($local.envFiles.policy | tojson) loosens \($base.envFiles.policy | tojson); the local file may tighten guardrails, never loosen them")),
    (select($local.envFiles.allow != null)
      | ($local.envFiles.allow - $base.envFiles.allow) as $added
      | select(($added | length) > 0)
      | _problem("guardrails.envFiles.allow";
          "adds \($added | map(tojson) | join(", ")); the local file may drop allowed env files, never add them")),
    (select($local.envFiles.deny != null)
      | ($base.envFiles.deny - $local.envFiles.deny) as $dropped
      | select(($dropped | length) > 0)
      | _problem("guardrails.envFiles.deny";
          "drops \($dropped | map(tojson) | join(", ")); the local file may add denied env files, never drop them")),
    (select($local.protectedBranches != null)
      | ($base.protectedBranches - $local.protectedBranches) as $dropped
      | select(($dropped | length) > 0)
      | _problem("guardrails.protectedBranches";
          "drops \($dropped | map(tojson) | join(", ")); the local file may add protected branches, never remove them"))
  ] end;

# commit.pattern from the convention's preset when no layer set one; a set pattern wins.
def finalize: .commit.pattern //= commit_patterns[.commit.convention];

def resolve($inferred; $committed; $local):
  (defaults($inferred) | if $committed != null then apply($committed) else . end) as $base
  | loosenings($base.guardrails; $local.guardrails) as $problems
  | {
      config: ((if $local != null and ($problems | length) == 0 then $base | apply($local) else $base end) | finalize),
      problems: $problems
    };
