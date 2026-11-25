# The merge dw-sdlc/src/agentic-config.ts performs, for the guards: the same defaults, the same
# tighten rule, the same messages. That file is the reference; the tests run both.

def local_file: ".ai/agentic.config.local.json";

# Strictest value first; the local override may only move towards the front.
def strictness: {
  forcePush: ["deny", "ask", "lease"],
  commitOnProtected: ["deny", "allow"],
  filteredOutput: ["deny", "allow"],
  envFiles: ["deny", "git"],
  merge: ["ask", "auto"],
  review: ["full", "auto", "light", "off"],
  ciUnavailable: ["ci", "gate"]
};

# Secret files of a Rails app, denied by default; nothing in a Node repository matches them.
def default_deny: ["**/config/master.key", "**/config/credentials/*.key"];

def strictest: {
  forcePush: "deny",
  commitOnProtected: "deny",
  filteredOutput: "deny",
  envFiles: {policy: "deny", allow: [], deny: default_deny},
  protectedBranches: ["master", "main", "production"]
};

# pr.merge and pr.review while any layer is invalid: the Ship script merges nothing itself and the
# agent reviews every head in full.
def strictest_pr: {merge: "ask", review: "full", ciUnavailable: "ci"};

# A resolved config as it runs while any layer is invalid; pr.reviewCommand, pr.reviewFull and worker have no
# strictest value and keep what the valid layers name, footprint too, but for the local `resolve` keeps.
def on_strictest: .guardrails = strictest | .pr += strictest_pr;

# The preset each commit.convention names. `conventional` is Conventional Commits; `ticket-key` is a ticket
# key ahead of the same form, scope and `!` included. Both POSIX ERE, because `grep -E` runs them.
def commit_patterns: {
  "ticket-key": "^\\[[A-Z][A-Z0-9]*-[0-9]+\\] (build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test)(\\([^)]+\\))?!?: .+",
  conventional: "^(build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test)(\\([^)]+\\))?!?: .+"
};

def defaults($inferred): {
  version: 1,
  baseBranch: "auto",
  packageManagers: $inferred.packageManagers,
  guardrails: {
    forcePush: "lease",
    commitOnProtected: "allow",
    filteredOutput: "deny",
    envFiles: {policy: "git", allow: ["**/.env.example", "**/.env.sample", "**/.env.template"], deny: default_deny},
    protectedBranches: ["master", "main", "production"]
  },
  commit: {},
  gate: ({steps: [], drift: "fail", checks: {run: []}} + ($inferred.gate // {})),
  pr: {merge: "ask", review: "auto", reviewCommand: "/code-review", reviewFull: [], ciUnavailable: "ci"},
  worker: {command: "claude", model: "sonnet", effort: "high"},
  worktree: {setup: []},
  footprint: "github"
};

# guardrails.envFiles merges key by key, each list wholesale; the other guardrails as one value.
# gate.checks merges Check by Check, `run` wholesale; gate.steps wholesale. pr.reviewFull is the union of
# the layers, in order, an id once.
def apply($layer):
  . as $base
  | {
      version: 1,
      baseBranch: ($layer.baseBranch // $base.baseBranch),
      packageManagers: ($base.packageManagers + ($layer.packageManagers // {})),
      guardrails: (($base.guardrails + ($layer.guardrails // {}))
        | .envFiles = ($base.guardrails.envFiles + ($layer.guardrails.envFiles // {}))),
      commit: ($base.commit + ($layer.commit // {})),
      gate: (($base.gate + ($layer.gate // {})) | .checks = ($base.gate.checks + ($layer.gate.checks // {}))),
      pr: (($base.pr + ($layer.pr // {}))
        | .reviewFull = (reduce (($base.pr.reviewFull + ($layer.pr.reviewFull // []))[]) as $id
            ([]; if any(.[]; . == $id) then . else . + [$id] end))),
      worker: ($base.worker + ($layer.worker // {})),
      worktree: {setup: ($layer.worktree.setup // $base.worktree.setup)},
      footprint: ($layer.footprint // $base.footprint)
    };

def _rank($key; $value): strictness[$key] | index($value);

def _problem($path; $message): {file: local_file, path: $path, message: $message};

# Every guardrail the local layer sets less strictly than what it would override: a lower-ranked
# forcePush, commitOnProtected, filteredOutput or envFiles.policy, a dropped protected branch, an
# added envFiles.allow entry, a dropped envFiles.deny entry.
def loosenings($base; $local):
  if $local == null then []
  else [
    (("forcePush", "commitOnProtected", "filteredOutput") as $key
      | select($local[$key] != null and _rank($key; $local[$key]) > _rank($key; $base[$key]))
      | _problem("guardrails.\($key)";
          "\($local[$key] | tojson) loosens \($base[$key] | tojson); the local file may tighten guardrails, never loosen them")),
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

# Each local pr key less strict than the one it would override: merge auto over ask, review off over light
# over auto over full, ciUnavailable gate over ci.
def pr_loosenings($base; $local):
  [("merge", "review", "ciUnavailable") as $key
    | select($local[$key] != null and _rank($key; $local[$key]) > _rank($key; $base[$key]))
    | _problem("pr.\($key)";
        "\($local[$key] | tojson) loosens \($base[$key] | tojson); the local file may tighten pr.\($key), never loosen it")];

# commit.pattern from the convention's preset when no layer set one; a set pattern wins. Neither set,
# no pattern: the subject goes unchecked.
def finalize: if .commit.convention != null then .commit.pattern //= commit_patterns[.commit.convention] else . end;

# resolve($inferred; $committed; $local) — {config, problems}, the problems the local loosenings; a
# layer is null when absent or invalid. With no committed layer the local one sets the pr keys freely;
# an invalid committed one is a problem the caller already holds. On any problem the caller runs
# `on_strictest`. A loosening local layer that names footprint local keeps it; a layer the schema
# refuses arrives here as null, so only the package's resolver keeps its footprint, which no guard reads.
def resolve($inferred; $committed; $local):
  (defaults($inferred) | if $committed != null then apply($committed) else . end) as $base
  | (loosenings($base.guardrails; $local.guardrails)
      + (if $committed == null then [] else pr_loosenings($base.pr; $local.pr // {}) end)) as $problems
  | {
      config: ((if $local != null and ($problems | length) == 0 then $base | apply($local) else $base end)
        | if ($problems | length) > 0 and $local.footprint == "local" then .footprint = "local" else . end
        | finalize),
      problems: $problems
    };
