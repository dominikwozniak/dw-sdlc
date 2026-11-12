// What block-env-access.sh refuses (exit 2) and lets through (exit 0), for the file tools and for Bash,
// fed the real hook payload. The verdict is the config's `guardrails.envFiles`, as the schema describes it;
// without a config, policy `git` with `.env.example`, `.env.sample` and `.env.template` allowed anywhere.

import assert from "node:assert/strict"
import { symlinkSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"

import {
  bashPayload,
  commit,
  expectExit,
  filePayload,
  git,
  initRepo,
  runHook,
  scratch,
  write,
  writeJson
} from "../harness.ts"

const TMP = scratch("env")

/**
 * A repository with tracked .env, .env.test and .env.local.example, ignored
 * .env.local and .env.development, an untracked .env.example, and nothing said about .env.production.
 */
function makeRepo(dir: string): string {
  initRepo(dir, { branch: "main" })
  write(join(dir, ".env"), "SAFE=1\n")
  write(join(dir, ".env.test"), "TEST=1\n")
  write(join(dir, ".env.local.example"), "")
  write(join(dir, ".env.example"), "")
  write(join(dir, "src", "env.ts"), "")
  write(join(dir, ".gitignore"), ".env.development\n*.local\n")
  write(join(dir, ".env.local"), "SECRET=1\n")
  write(join(dir, ".env.development"), "SECRET=2\n")
  git(dir, "add", ".gitignore", ".env", ".env.test", ".env.local.example", "src/env.ts")
  return dir
}
const REPO = makeRepo(join(TMP, "repo"))
const DENY = makeRepo(join(TMP, "deny"))
writeJson(join(DENY, ".ai", "agentic.config.json"), { guardrails: { envFiles: { policy: "deny" } } })
// The lists over git: the ignored .env.development is allowed, the tracked .env.test is denied, the
// example names keep their default; a `config/.env.test` is not the root's `.env.test`.
const LISTED = makeRepo(join(TMP, "listed"))
write(join(LISTED, "config", ".env.test"), "TEST=1\n")
git(LISTED, "add", "config/.env.test")
writeJson(join(LISTED, ".ai", "agentic.config.json"), {
  guardrails: {
    envFiles: { policy: "git", allow: [".env.development", "**/.env.example"], deny: [".env.test"] }
  }
})
// A local layer that adds an allow entry loosens, so the whole layer is dropped and every env file is refused.
const LOOSENED = makeRepo(join(TMP, "loosened"))
writeJson(join(LOOSENED, ".ai", "agentic.config.local.json"), {
  guardrails: { envFiles: { allow: ["**/.env.example", "**/.env.sample", "**/.env.template", ".env.local"] } }
})
// A local layer that adds a deny entry tightens, and applies.
const TIGHTENED = makeRepo(join(TMP, "tightened"))
writeJson(join(TIGHTENED, ".ai", "agentic.config.local.json"), { guardrails: { envFiles: { deny: [".env"] } } })
// policy deny with the allow list emptied refuses even the example names.
const DENY_ALL = makeRepo(join(TMP, "deny-all"))
writeJson(join(DENY_ALL, ".ai", "agentic.config.json"), { guardrails: { envFiles: { policy: "deny", allow: [] } } })
// A bracket in an entry is literal, as in the TypeScript twin: `.env.[ab]` names one file, not two.
const BRACKET = makeRepo(join(TMP, "bracket"))
write(join(BRACKET, ".env.a"), "A=1\n")
write(join(BRACKET, ".env.[ab]"), "B=1\n")
git(BRACKET, "add", ".env.a", ".env.[ab]")
writeJson(join(BRACKET, ".ai", "agentic.config.json"), { guardrails: { envFiles: { deny: [".env.[ab]"] } } })
// A repository reached through a symlink, with entries that carry a directory: only a path resolved
// to the root git reports can match them, and git resolves the symlink itself.
const LINKED = makeRepo(join(TMP, "linked"))
write(join(LINKED, "config", ".env.test"), "TEST=1\n")
write(join(LINKED, "config", ".env.development"), "SECRET=1\n")
git(LINKED, "add", "config/.env.test")
writeJson(join(LINKED, ".ai", "agentic.config.json"), {
  guardrails: { envFiles: { allow: ["config/.env.development"], deny: ["config/.env.test"] } }
})
const LINK = join(TMP, "link")
symlinkSync(LINKED, LINK)
// Env files outside every repository, reached from LISTED: its plain entries do not travel.
const ELSEWHERE = join(TMP, "elsewhere")
write(join(ELSEWHERE, ".env.development"), "SECRET=1\n")
write(join(ELSEWHERE, ".env.example"), "")
const PLAIN = join(TMP, "plain")
write(join(PLAIN, ".env"), "X=1\n")
write(join(PLAIN, ".env.example"), "")
// A main checkout that allows its ignored .env.test.local in an untracked config, and a linked worktree
// of it in a sibling directory: the main checkout is the same repository under the same config.
const SHARED = makeRepo(join(TMP, "shared"))
write(join(SHARED, ".env.test.local"), "DB=1\n")
writeJson(join(SHARED, ".ai", "agentic.config.json"), {
  guardrails: { envFiles: { allow: ["**/.env.example", ".env.test.local"] } }
})
git(
  SHARED,
  "-c",
  "user.email=t@example.com",
  "-c",
  "user.name=t",
  "-c",
  "commit.gpgsign=false",
  "commit",
  "-qm",
  "init"
)
const SHARED_WT = join(TMP, "shared-wt")
git(SHARED, "worktree", "add", "-q", SHARED_WT, "-b", "wt")

function blockedFile(name: string, tool: string, path: string, cwd = REPO): void {
  it(name, () => {
    expectExit(runHook("block-env-access", filePayload(tool, path, cwd)), 2)
  })
}
function allowedFile(name: string, tool: string, path: string, cwd = REPO): void {
  it(name, () => {
    expectExit(runHook("block-env-access", filePayload(tool, path, cwd)), 0)
  })
}
function blockedBash(name: string, command: string, cwd = REPO): void {
  it(name, () => {
    expectExit(runHook("block-env-access", bashPayload(command, cwd)), 2)
  })
}
function allowedBash(name: string, command: string, cwd = REPO): void {
  it(name, () => {
    expectExit(runHook("block-env-access", bashPayload(command, cwd)), 0)
  })
}

describe("file tools in the repository — git decides", () => {
  blockedFile("read-ignored-abs", "Read", join(REPO, ".env.local"))
  blockedFile("read-ignored-rel", "Read", ".env.local")
  blockedFile("edit-ignored-development", "Edit", join(REPO, ".env.development"))
  blockedFile("write-unknown-production", "Write", join(REPO, ".env.production"))
  blockedFile("read-untracked-envrc", "Read", ".envrc")
  blockedFile("read-other-repo-env", "Read", join(PLAIN, ".env"))
  allowedFile("read-tracked-abs", "Read", join(REPO, ".env"))
  allowedFile("read-tracked-rel", "Read", ".env")
  allowedFile("read-tracked-dot-slash", "Read", "./.env")
  allowedFile("edit-tracked-test", "Edit", ".env.test")
  allowedFile("read-tracked-local-example", "Read", ".env.local.example")
  allowedFile("read-example-by-name", "Read", ".env.example")
  allowedFile("write-sample-by-name", "Write", "config/.env.sample")
  allowedFile("read-env-ts", "Read", "src/env.ts")
  allowedFile("grep-the-tree", "Grep", ".")
})

describe("bash in the repository", () => {
  blockedBash("cat-ignored", "cat .env.local")
  blockedBash("cp-ignored-out", "cp .env.local /tmp/x")
  blockedBash("source-ignored", "source ./.env.development")
  blockedBash("env-file-flag", "docker run --env-file=.env.local img")
  blockedBash("cp-example-to-unknown", "cp .env.example .env.production")
  blockedBash("append-ignored", "echo FOO=1 >> .env.local")
  blockedBash("multiline-cat-ignored", "echo start\ncat .env.local")
  blockedBash("heredoc-redirect-target", "cat > .env.local <<EOF\nSECRET=1\nEOF")
  blockedBash("after-heredoc-cat", "cat <<EOF\nprose about .env.local\nEOF\ncat .env.local")
  blockedBash("quoted-heredoc-opener-hides-nothing", 'echo "see << EOF"\ncat .env.local')
  blockedBash("chained-after-safe", "cat .env && cat .env.local")
  blockedBash("dq-path", 'cat ".env.local"')
  allowedBash("grep for an env file's name", 'grep -rn ".env.local" src')
  allowedBash("rg for an env file's name", "rg '.env.local' docs/")
  allowedBash("git grep for an env file's name", 'git grep -n ".env.local"')
  allowedBash("rtk grep for an env file's name", 'rtk grep ".env.local" src')
  blockedBash("grep inside an ignored env file", "grep SECRET .env.local")
  blockedBash("a read after a grep still counts", 'grep -rn ".env" src && cat ".env.local"')
  blockedBash("sq-path", "cat '.env.local'")
  blockedBash("dq-dot-slash-path", 'source "./.env.development"')
  blockedBash("dq-redirect-target", 'echo FOO=1 >> ".env.local"')
  allowedBash("dq-tracked", 'cat ".env"')
  allowedBash("dq-example", 'cat ".env.example"')
  allowedBash("prose-ending-in-a-path", 'git commit -m "chore: stop reading config/.env.local"')
  allowedBash("cat-tracked", "cat .env")
  allowedBash("cat-tracked-test", "cat .env.test")
  allowedBash("cp-tracked-out", "cp .env /tmp/x")
  allowedBash("cat-example", "cat .env.example")
  allowedBash("cat-environment", "cat .environment")
  allowedBash("cat-foo-env", "cat foo.env")
  allowedBash("prose-in-quotes", 'git commit -m "load .env.local in prod"')
  allowedBash("prose-multiline", 'git commit -m "subject\n- mentions .envrc and ./.env.local in the body"')
  allowedBash("heredoc-commit-body", "git commit -F - <<'MSG'\nfix: mentions .env.local as prose\nMSG")
  allowedBash("plain-ls", "ls -la")
  allowedBash("empty-input", "")
})

describe("a substitution inside double quotes runs, so its paths count", () => {
  blockedBash("dq-substitution-cat", 'echo "$(cat .env.local)"')
  blockedBash("dq-backtick-cat", 'echo "`cat .env.local`"')
  blockedBash("dq-substitution-source", 'x="$(source ./.env.development; echo $X)"')
  allowedBash("dq-substitution-tracked", 'echo "$(cat .env)"')
  allowedBash("sq-substitution-is-text", "git commit -m 'docs: see $(cat .env.local)'")
  allowedBash("dq-parens-are-text", 'git commit -m "docs: never (cat .env.local)"')
  allowedBash("dq-prose-around-a-substitution", 'git commit -m "fix: read .env.local lazily $(date) and more"')
  blockedBash("nested-substitution", 'echo "$(echo "$(cat .env.local)")"')
  allowedBash("quoted-heredoc-body-is-text", "git commit -m \"$(cat <<'EOF'\nfix: x\n\nreads .env.local now\nEOF\n)\"")
  blockedBash("unquoted-heredoc-body-substitution", "cat <<EOF\n$(cat .env.local)\nEOF")
  blockedBash("unquoted-heredoc-body-backtick", "cat > notes.md <<EOF\nsee `cat .env.local`\nEOF")
  blockedBash("ansi-c-path", "cat $'.env.local'")
  blockedBash("locale-quoted-path", 'cat $".env.local"')
  blockedBash("ansi-c-hex-escaped-path", "cat $'\\x2eenv.local'")
  blockedBash("ansi-c-octal-escaped-path", "cat $'\\056env.local'")
  blockedBash("ansi-c-path-cut-at-a-nul", "cat $'.env.local\\0.example'")
  allowedBash("ansi-c-prose-with-an-escaped-quote", "printf '%s\\n' $'it\\'s $(cat .env.local) here'")
  allowedBash("quoted-heredoc-body-substitution-is-text", "cat <<'EOF'\n$(cat .env.local)\nEOF")
  allowedBash("unquoted-heredoc-body-prose", "cat <<EOF\nreads .env.local lazily, $(date)\nEOF")
  blockedBash("bash-c-sq-path", "bash -c 'cat .env.local'")
  blockedBash("sh-c-dq-path", 'sh -c "cat .env.local"')
  blockedBash("eval-sq-path", "eval 'cat .env.local'")
  blockedBash("bash-c-ansi-c-path", "bash -c $'cat .env.local'")
  blockedBash("rtk-run-sq-path", "rtk run 'cat .env.local'")
  blockedBash("bash-c-after-cd", "bash -c 'cd app && cat .env.local'")
  blockedBash("a command after a bash -c quote that ends in a backslash", "bash -c 'x\\' ; cat .env.local #'")
  blockedBash("after-a-bash-c-sq-holding-a-dq", "bash -c 'echo \"' ; cat .env.local ; echo '\"'")
  blockedBash("after-a-bash-c-dq-holding-a-sq", 'bash -c "echo \'" ; cat .env.local ; echo "\'"')
  blockedBash("after-a-bash-c-sq-holding-a-backtick", "bash -c 'echo `' ; cat .env.local ; echo '`'")
  allowedBash("bash-c-tracked", "bash -c 'cat .env'")
  allowedBash("bash-c-prose-in-quotes", "bash -c 'git commit -m \"load .env.local in prod\"'")
  it("a refusal from a substitution says so", () => {
    const verdict = runHook("block-env-access", bashPayload('gh pr create --body "reads `.env.local` now"', REPO))
    expectExit(verdict, 2)
    assert.match(verdict.stderr, /command substitution/)
  })
  it("a refusal from a quote handed to a shell says so", () => {
    const verdict = runHook("block-env-access", bashPayload("bash -c 'cat .env.local'", REPO))
    expectExit(verdict, 2)
    assert.match(verdict.stderr, /quoted command/)
  })
  it("a refusal from the command itself does not", () => {
    const verdict = runHook("block-env-access", bashPayload("cat .env.local", REPO))
    expectExit(verdict, 2)
    assert.doesNotMatch(verdict.stderr, /substitution/)
  })
})

function grepPayload(glob: string, path?: string, cwd = REPO): object {
  return {
    hook_event_name: "PreToolUse",
    tool_name: "Grep",
    cwd,
    tool_input: { pattern: "SECRET", ...(path === undefined ? {} : { path }), glob }
  }
}
function blockedGrep(name: string, glob: string, path?: string, cwd = REPO): void {
  it(name, () => {
    expectExit(runHook("block-env-access", grepPayload(glob, path, cwd)), 2)
  })
}
function allowedGrep(name: string, glob: string, path?: string, cwd = REPO): void {
  it(name, () => {
    expectExit(runHook("block-env-access", grepPayload(glob, path, cwd)), 0)
  })
}

describe("a directory Grep is judged by the env files its glob reaches", () => {
  blockedGrep("glob-env-star-on-the-repo", ".env*", REPO)
  blockedGrep("glob-env-star-without-a-path", ".env*")
  blockedGrep("glob-naming-the-ignored-file", ".env.local", ".")
  blockedGrep("glob-anywhere", "**/.env*", REPO)
  blockedGrep("glob-with-braces", ".env.{local,production}", REPO)
  blockedGrep("glob-env-star-under-deny", ".env*", DENY, DENY)
  blockedGrep("glob-env-star-outside-a-repo", ".env*", PLAIN, PLAIN)
  allowedGrep("glob-naming-the-example-outside-a-repo", ".env.example", PLAIN, PLAIN)
  allowedGrep("glob-naming-the-tracked-file", ".env", REPO)
  allowedGrep("glob-naming-the-example", ".env.example", REPO)
  allowedGrep("glob-on-sources", "*.ts", REPO)
  allowedGrep("glob-env-star-where-no-env-file-is", ".env*", "src")
  allowedGrep("glob-with-braces-naming-tracked-files", ".env.{test,example}", REPO)
})

describe("guardrails.envFiles.policy: deny refuses even a tracked one", () => {
  blockedFile("deny-read-tracked", "Read", ".env", DENY)
  blockedBash("deny-cat-tracked", "cat .env", DENY)
  allowedFile("deny-example-by-name", "Read", ".env.example", DENY)
  blockedFile("deny-all-refuses-the-example", "Read", ".env.example", DENY_ALL)
  blockedBash("deny-all-refuses-the-example-in-bash", "cat .env.example", DENY_ALL)
})

describe("the allow and deny lists decide before git", () => {
  allowedFile("allow-beats-ignored", "Read", ".env.development", LISTED)
  allowedBash("allow-beats-ignored-in-bash", "cat .env.development", LISTED)
  allowedFile("allow-beats-ignored-abs", "Read", join(LISTED, ".env.development"), LISTED)
  allowedFile("allow-beats-ignored-dot-slash", "Read", "./.env.development", LISTED)
  blockedFile("deny-beats-tracked", "Read", ".env.test", LISTED)
  blockedBash("deny-beats-tracked-in-bash", "cat .env.test", LISTED)
  blockedFile("deny-beats-tracked-abs", "Edit", join(LISTED, ".env.test"), LISTED)
  blockedBash("deny-beats-tracked-via-parent", "cat ../listed/.env.test", LISTED)
  allowedFile("deny-entry-is-root-anchored", "Read", "config/.env.test", LISTED)
  allowedFile("unlisted-tracked-still-passes", "Read", ".env", LISTED)
  blockedFile("unlisted-ignored-still-refused", "Read", ".env.local", LISTED)
  allowedFile("default-example-kept", "Read", "config/.env.example", LISTED)
  blockedFile("default-sample-dropped-by-the-list", "Write", "config/.env.sample", LISTED)
  blockedGrep("glob-reaching-the-denied-file", ".env.{test,example}", LISTED, LISTED)
  allowedGrep("glob-reaching-the-allowed-file", ".env.development", LISTED, LISTED)
  blockedFile("local-adding-allow-goes-strictest", "Read", ".env", LOOSENED)
  blockedFile("local-adding-allow-refuses-the-example-too", "Read", ".env.example", LOOSENED)
  blockedFile("local-adding-deny-applies", "Read", ".env", TIGHTENED)
  allowedFile("local-adding-deny-keeps-the-rest", "Read", ".env.test", TIGHTENED)
  blockedFile("deny-through-a-symlinked-path", "Read", join(LINK, "config", ".env.test"), LINKED)
  allowedFile("allow-through-a-symlinked-path", "Read", join(LINK, "config", ".env.development"), LINKED)
  blockedFile("deny-from-a-symlinked-cwd", "Read", "config/.env.test", LINK)
  allowedFile("allow-from-a-symlinked-cwd", "Read", "config/.env.development", LINK)
  blockedBash("deny-from-a-symlinked-cwd-in-bash", "cat config/.env.test", LINK)
  blockedGrep("glob-from-a-symlinked-cwd", ".env.test", "config", LINK)
  allowedGrep("glob-allowed-from-a-symlinked-cwd", ".env.development", "config", LINK)
  blockedFile("plain-allow-stops-at-the-root", "Read", "../elsewhere/.env.development", LISTED)
  blockedFile("plain-allow-stops-at-the-root-abs", "Read", join(ELSEWHERE, ".env.development"), LISTED)
  blockedBash("plain-allow-stops-at-the-root-in-bash", "cat ../elsewhere/.env.development", LISTED)
  allowedFile("any-depth-allow-reaches-outside", "Read", "../elsewhere/.env.example", LISTED)
  blockedGrep("grep-outside-the-root-ignores-plain-allow", ".env.development", ELSEWHERE, LISTED)
  blockedFile("bracket-is-literal-and-names-the-file", "Read", ".env.[ab]", BRACKET)
  allowedFile("bracket-is-not-a-class", "Read", ".env.a", BRACKET)
})

describe("from a linked worktree, its main checkout's files are judged as the repository's", () => {
  allowedBash("copy-an-allowed-file-in", `cp ${SHARED}/.env.test.local .env.test.local`, SHARED_WT)
  allowedFile("read-an-allowed-file-there", "Read", join(SHARED, ".env.test.local"), SHARED_WT)
  allowedFile("read-a-tracked-file-there", "Read", join(SHARED, ".env"), SHARED_WT)
  blockedBash("copy-an-ignored-file-in", `cp ${SHARED}/.env.local .env.local`, SHARED_WT)
  blockedFile("read-an-untracked-file-there", "Read", join(SHARED, ".env.production"), SHARED_WT)
})

describe("outside a repository the name decides", () => {
  blockedFile("plain-read-env", "Read", join(PLAIN, ".env"), PLAIN)
  blockedBash("plain-cat-env", "cat .env", PLAIN)
  blockedBash("plain-dq-substitution-cat-env", 'echo "$(cat .env)"', PLAIN)
  allowedFile("plain-read-example", "Read", ".env.example", PLAIN)
  allowedBash("plain-cat-example", "cat .env.example", PLAIN)
})

// The repositories of the #318 pass. FEAT tracks .env.example and ignores .env.local and
// .env.production; TRACKED_ROOT tracks its root .env and ignores sub/.env; DENIED tracks .env,
// apps/api/.env and .env.production and denies the last two by name.
const FEAT = join(TMP, "feat")
initRepo(FEAT, { branch: "feat" })
write(join(FEAT, ".gitignore"), ".env.local\n.env.production\n")
write(join(FEAT, ".env.example"), "")
write(join(FEAT, ".env.local"), "SECRET=1\n")
write(join(FEAT, ".env.production"), "SECRET=2\n")
write(join(FEAT, ".eslintrc"), "{}\n")
write(join(FEAT, "src", "env.ts"), "")
git(FEAT, "add", ".gitignore", ".env.example", ".eslintrc", "src/env.ts")
commit(FEAT, "-qm", "init")
const TRACKED_ROOT = join(TMP, "tracked-root")
initRepo(TRACKED_ROOT, { branch: "main" })
write(join(TRACKED_ROOT, ".gitignore"), "sub/.env\n")
write(join(TRACKED_ROOT, ".env"), "SAFE=1\n")
write(join(TRACKED_ROOT, "sub", ".env"), "SECRET=1\n")
write(join(TRACKED_ROOT, "sub", "notes.md"), "")
git(TRACKED_ROOT, "add", ".gitignore", ".env", "sub/notes.md")
const DENIED = join(TMP, "denied")
initRepo(DENIED, { branch: "main" })
write(join(DENIED, ".env"), "SAFE=1\n")
write(join(DENIED, ".env.production"), "SECRET=1\n")
write(join(DENIED, "apps", "api", ".env"), "SECRET=2\n")
writeJson(join(DENIED, ".ai", "agentic.config.json"), {
  guardrails: { envFiles: { deny: ["apps/api/.env", ".env.production"] } }
})
git(DENIED, "add", ".env", ".env.production", "apps/api/.env", ".ai/agentic.config.json")
commit(DENIED, "-qm", "init")

describe("a glob is judged by the env files the shell expands it to", () => {
  // F02-env-pathspec-glob: the tracked .env.example no longer vouches for the files beside it.
  blockedBash("env-glob-dot-star", "cat .env.*", FEAT)
  blockedBash("env-glob-source", "source .env.*", FEAT)
  blockedBash("env-glob-dotslash", "cat ./.env.*", FEAT)
  // F03-env-glob-name: a glob that is no env name expands to them.
  blockedBash("env-glob-star", "cat .env*", FEAT)
  blockedBash("env-glob-head", "head -n 5 .env*", FEAT)
  blockedBash("env-glob-qmark", "cat .en?.local", FEAT)
  blockedBash("env-glob-bracket", "cat .en[v].local", FEAT)
  blockedBash("env-glob-e-star", "cat .e*", FEAT)
  blockedBash("a glob in a directory part", "cat */.env", TRACKED_ROOT)
  allowedBash("a glob reaching only the tracked file", "cat .env*", TRACKED_ROOT)
  allowedBash("a glob reaching only the example", "cat .env.ex*", FEAT)
  allowedBash("a glob reaching no env file", "cat .esl*", FEAT)
  allowedBash("a glob matching nothing", "cat .env.nothing*", FEAT)
  allowedBash("a glob on sources", "cat src/*.ts", FEAT)
  allowedBash("a quoted glob the shell does not expand", "find . -name '.env*'", FEAT)
  allowedBash("a double-quoted glob the shell does not expand", 'find . -name ".env*" -type f', FEAT)
  blockedFile("a file tool's path is a name, not a pathspec", "Read", ".env.*", FEAT)
})

describe("a cd or pushd earlier in the command moves where a path is read from", () => {
  // F04-env-ignores-cd
  blockedBash("env-cd-tracked-root", "cd sub && cat .env", TRACKED_ROOT)
  blockedBash("env-cd-subshell", "(cd sub; cat .env)", TRACKED_ROOT)
  blockedBash("env-pushd", "pushd sub && cat .env", TRACKED_ROOT)
  blockedBash("env-cd-denied", "cd apps/api && cat .env", DENIED)
  allowedBash("a cd back up to the tracked file", "cd sub && cat ../.env", TRACKED_ROOT)
  allowedBash("a subshell's cd ends with it", "(cd sub; ls); cat .env", TRACKED_ROOT)
  allowedBash("a popd goes back", "pushd sub && popd && cat .env", TRACKED_ROOT)
  allowedBash("a cd into a directory that is not there stays", "cd nowhere && cat .env", TRACKED_ROOT)
})

describe("a <rev>:<path> names the env file at the path", () => {
  // F05-env-rev-path
  blockedBash("env-git-show", "git show HEAD:.env.production", DENIED)
  blockedBash("env-git-cat-file", "git cat-file -p HEAD:.env.production", DENIED)
  blockedBash("a path below the root", "git show main:apps/api/.env", DENIED)
  blockedBash("a path from the index", "git show :.env.production", DENIED)
  allowedBash("a tracked file", "git show HEAD:.env", DENIED)
  allowedBash("the example", "git show HEAD:.env.example", FEAT)
  allowedBash("a source file", "git show HEAD:src/env.ts", FEAT)
})

describe("a Grep glob reaching any env file is judged", () => {
  // F06-grep-glob-probes
  blockedGrep("grep-production", "*.production", ".", FEAT)
  blockedGrep("grep-deep-production", "**/*.production", ".", FEAT)
  blockedGrep("grep-brace-env-local", "*.{env,local}", ".", FEAT)
  blockedGrep("grep-brace-local-prod", "*.{local,production}", ".", FEAT)
  for (const glob of ["*.example", "*.ts", "*.{ts,md}", "*rc"]) {
    allowedGrep(`a glob reaching no refused env file [${glob}]`, glob, ".", FEAT)
  }
})

describe("the fast path takes the command and the cwd from argv", () => {
  it("fast-path-refuses-ignored", () => {
    expectExit(runHook("block-env-access", "cat .env.local", { args: ["--bash-command", REPO] }), 2)
  })
  it("fast-path-allows-tracked", () => {
    expectExit(runHook("block-env-access", "cat .env", { args: ["--bash-command", REPO] }), 0)
  })
  it("stray-env-var-cannot-skip-the-file-leg", () => {
    const payload = { tool_name: "Read", cwd: REPO, tool_input: { file_path: ".env.local" } }
    expectExit(runHook("block-env-access", payload, { env: { GUARD_COMMAND: "echo hi" } }), 2)
  })
})

describe("a payload the guard cannot read is refused, naming why", () => {
  // U+0001 is the byte the reader closes each field with, so a field holding it cannot be split.
  for (const tool of ["Read", "Edit", "Write", "MultiEdit"]) {
    it(`${tool} with U+0001 in file_path`, () => {
      const verdict = runHook("block-env-access", filePayload(tool, ".env.local\u0001", REPO))
      expectExit(verdict, 2)
      assert.match(verdict.stderr, /payload cannot be read.*U\+0001/)
    })
  }
  it("NotebookEdit with U+0001 in notebook_path", () => {
    const payload = {
      hook_event_name: "PreToolUse",
      tool_name: "NotebookEdit",
      cwd: REPO,
      tool_input: { notebook_path: ".env.local\u0001" }
    }
    const verdict = runHook("block-env-access", payload)
    expectExit(verdict, 2)
    assert.match(verdict.stderr, /payload cannot be read.*U\+0001/)
  })
  it("Grep with U+0001 in path", () => {
    const payload = { hook_event_name: "PreToolUse", tool_name: "Grep", cwd: REPO, tool_input: { path: ".\u0001" } }
    const verdict = runHook("block-env-access", payload)
    expectExit(verdict, 2)
    assert.match(verdict.stderr, /payload cannot be read.*U\+0001/)
  })
  it("a byte in the cwd", () => {
    expectExit(runHook("block-env-access", filePayload("Read", "src/env.ts", `${REPO}\u0001`)), 2)
  })
  it("malformed payload", () => {
    const verdict = runHook("block-env-access", "not json")
    expectExit(verdict, 2)
    assert.match(verdict.stderr, /payload cannot be read/)
  })
  it("an empty payload carries nothing to judge and passes", () => {
    expectExit(runHook("block-env-access", ""), 0)
  })
  it("the fast path never reads JSON, so a byte in the command is the Bash dispatcher's to judge", () => {
    expectExit(runHook("block-env-access", "echo \u0001", { args: ["--bash-command", REPO] }), 0)
  })
})

describe("without jq every call passes", () => {
  const NOJQ = { env: { PATH: scratch("env-nojq") } }
  it("a call the guard would refuse", () => {
    expectExit(runHook("block-env-access", filePayload("Read", ".env.local", REPO), NOJQ), 0)
  })
  it("a payload with the byte", () => {
    expectExit(runHook("block-env-access", filePayload("Read", ".env.local\u0001", REPO), NOJQ), 0)
  })
})
