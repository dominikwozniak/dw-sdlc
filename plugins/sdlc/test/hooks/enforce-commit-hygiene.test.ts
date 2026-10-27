// What enforce-commit-hygiene.sh refuses (exit 2) and lets through (exit 0) across its four checks: the
// subject pattern and the trailer the resolved config carries, a live backtick inside -m, and `git add -A`
// or `git add .`. The policies come from the config, so the cases run on repositories with known files and remotes.

import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"

import { bashPayload, commit, expectExit, git, initRepo, runHook, scratch, write, writeJson } from "../harness.ts"

const TMP = scratch("commit")

function repo(name: string, remote: string, config?: object): string {
  const dir = initRepo(join(TMP, name), { remote })
  mkdirSync(join(dir, ".ai"))
  if (config !== undefined) {
    writeJson(join(dir, ".ai", "agentic.config.json"), config)
  }
  return dir
}
const CONV = "^(build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test)(\\([^)]+\\))?!?: .+"
const TICKETS = repo("tickets", "git@github.com:acme/app.git", { commit: { convention: "ticket-key" } })
const OTHER = repo("other", "https://github.com/dominikwozniak/x.git")
const ORG = repo("org", "git@github.com:acme/y.git")
const CONVENTIONAL = repo("conventional", "git@github.com:acme/z.git", { commit: { convention: "conventional" } })
const TRAILERED = repo("trailered", "https://github.com/dominikwozniak/y.git", {
  commit: { pattern: CONV, trailer: "Co-Authored-By" }
})
const ANY = repo("any", "https://github.com/dominikwozniak/z.git", { commit: { pattern: ".+" } })
const PLAIN = join(TMP, "plain")
mkdirSync(PLAIN)
// A ticket-key layer only in the main checkout, untracked, the way `.ai/` sits in a repository that
// keeps it out of git, and a linked worktree of it in a sibling directory.
const WORKTREE_MAIN = repo("wt-main", "git@github.com:acme/w.git")
writeJson(join(WORKTREE_MAIN, ".ai", "agentic.config.local.json"), { commit: { convention: "ticket-key" } })
write(join(WORKTREE_MAIN, "README.md"), "")
git(WORKTREE_MAIN, "add", "README.md")
commit(WORKTREE_MAIN, "-m", "init")
const WORKTREE = join(TMP, "wt-main-VER-1")
git(WORKTREE_MAIN, "worktree", "add", "-q", WORKTREE, "-b", "VER-1")

function blocked(name: string, command: string, cwd = TRAILERED): void {
  it(name, () => {
    expectExit(runHook("enforce-commit-hygiene", bashPayload(command, cwd)), 2)
  })
}
function allowed(name: string, command: string, cwd = TRAILERED): void {
  it(name, () => {
    expectExit(runHook("enforce-commit-hygiene", bashPayload(command, cwd)), 0)
  })
}

const TRAILER = "Co-Authored-By: Someone <noreply@example.com>"
const GOOD_MSG = `chore(hook): add the hygiene guard\n\n${TRAILER}`

describe("pattern and trailer from the committed config — refused", () => {
  blocked("no-type-prefix", `git commit -m "added a thing\n\n${TRAILER}"`)
  blocked("no-type-prefix-absolute-git", `/usr/bin/git commit -m "added a thing\n\n${TRAILER}"`)
  blocked("no-type-prefix-escaped-git", `\\git commit -m "added a thing\n\n${TRAILER}"`)
  blocked("uppercase-type", `git commit -m "Fix: a thing\n\n${TRAILER}"`)
  blocked("unknown-type", `git commit -m "wip: a thing\n\n${TRAILER}"`)
  blocked("no-space-after-colon", `git commit -m "fix:athing\n\n${TRAILER}"`)
  blocked("empty-subject", 'git commit -m ""')
  blocked("missing-trailer", 'git commit -m "fix(hook): a thing"')
  blocked("trailer-in-subject-only", `git commit -m "${TRAILER}"`)
  blocked("body-but-no-trailer", 'git commit -m "fix(hook): a thing" -m "why it was done"')
  blocked("trailer-flag-other-key", "git commit -m 'fix: ok' --trailer 'Signed-off-by: x <y>'")
})

describe("pattern and trailer from the committed config — allowed", () => {
  allowed("single-m-with-trailer", `git commit -m "${GOOD_MSG}"`)
  allowed("repeated-m-trailer-last", `git commit -m "feat(x): a thing" -m "why" -m "${TRAILER}"`)
  allowed("scopeless-type", `git commit -m "docs: a thing\n\n${TRAILER}"`)
  allowed("breaking-bang", `git commit -m "feat(x)!: a thing\n\n${TRAILER}"`)
  allowed("trailer-case-insensitive", 'git commit -m "fix: a thing\n\nco-authored-by: Someone <noreply@example.com>"')
  allowed("glued-m-value", `git commit -m"fix: a thing\n\n${TRAILER}"`)
  allowed("long-message-flag", `git commit --message="fix: a thing\n\n${TRAILER}"`)
  allowed("clustered-am", `git commit -am "fix: a thing\n\n${TRAILER}"`)
  allowed("trailer-flag", "git commit -m 'fix: ok' --trailer 'Co-Authored-By: x <y>'")
  allowed("trailer-flag-glued", "git commit -m 'fix: ok' --trailer='Co-Authored-By: x <y>'")
  // git renders `token=value` on the command line as `token: value`.
  allowed("trailer-flag-equals", "git commit --trailer 'Co-Authored-By=x <y>' -m 'fix: ok'")
})

describe("wrappers and other repositories resolve to the same commit", () => {
  blocked("rtk-wrapper", 'rtk git commit -m "nope, no type prefix"')
  blocked("rtk-proxy-wrapper", 'rtk proxy git commit -m "nope, no type prefix"')
  blocked("sudo-wrapper", 'sudo git commit -m "nope, no type prefix"')
  blocked("dash-C-other-repo", 'git -C ../other commit -m "nope, no type prefix"')
  blocked("after-chain", 'pnpm test && git commit -m "nope, no type prefix"')
  blocked("second-of-two-commits", `git commit -m "${GOOD_MSG}" && git commit -m "nope"`)
  blocked("subshell-commit", '(git commit -m "nope, no type prefix")')
  blocked("git-c-commit", 'git -c commit.gpgsign=false commit -m "nope, no type prefix"')
})

describe("a message the guard cannot read passes", () => {
  allowed("editor-commit", "git commit")
  allowed("amend-no-edit", "git commit --amend --no-edit")
  allowed("message-from-file", "git commit -F /tmp/msg.txt")
  allowed("message-from-file-long", "git commit --file=/tmp/msg.txt")
  allowed("message-piped-to-stdin", "printf 'whatever shape this is' | git commit -F -")
  allowed("shell-assembled-message", 'git commit -m "$MSG"')
  allowed("command-substituted", 'git commit -m "fix: $(date)"')
  allowed("merge-subject", 'git commit -m "Merge branch main into topic"')
  allowed("revert-subject", 'git commit -m "Revert \\"feat: a thing\\""')
  allowed("fixup-subject", 'git commit -m "fixup! feat: a thing"')
  allowed("squash-subject", 'git commit -m "squash! feat: a thing"')
  allowed("not-a-commit-at-all", "git status --short")
  allowed("no-git-token", "pnpm test")
  allowed("empty-input", "")
  blocked("dollar-amount-still-checked", `git commit -m "nope, costs \\$5\n\n${TRAILER}"`)
  blocked("sq-dollar-is-literal-and-checked", `git commit -m 'nope, $HOME\n\n${TRAILER}'`)
  allowed("sq-dollar-good-and-checked", `git commit -m 'fix: handle $HOME\n\n${TRAILER}'`)
  blocked("dq-escaped-dollar-is-literal-and-checked", `git commit -m "nope, \\$HOME\n\n${TRAILER}"`)
  allowed("dq-brace-expansion-unreadable", 'git commit -m "${MSG}"')
  allowed("sq-then-dq-expansion-unreadable", `git commit -m 'fix: a thing'"$SUFFIX"`)
})

/** A commit whose -m is a heredoc substitution, the shape a multi-line message usually takes. */
function substituted(body: string): string {
  return `git commit -m "$(cat <<'EOF'\n${body}\nEOF\n)"`
}

describe("a message written in a heredoc is read and checked", () => {
  blocked("substitution-bad-subject", substituted(`whatever shape this is\n\n${TRAILER}`))
  blocked("substitution-no-trailer", substituted("fix: a thing\n\nwhy it was done"))
  allowed("substitution-good", substituted(GOOD_MSG))
  allowed("substitution-then-trailer-m", `${substituted("fix: a thing")} -m "${TRAILER}"`)
  blocked("stdin-bad-subject", "git commit -F - <<'MSG'\nwhatever shape this is\nMSG")
  allowed("stdin-good", `git commit -F - <<'MSG'\n${GOOD_MSG}\nMSG`)
  allowed("stdin-long-flag", `git commit --file=- <<'MSG'\n${GOOD_MSG}\nMSG`)
  allowed("stdin-dash-strips-tabs", `git commit -F - <<-MSG\n\tfix: a thing\n\n\t${TRAILER}\n\tMSG`)
  blocked("quoted-delimiter-dollar-is-literal", `git commit -F - <<'MSG'\nnope, $HOME\n\n${TRAILER}\nMSG`)
  allowed("quoted-delimiter-dollar-checked-and-fine", `git commit -F - <<'MSG'\nfix: handle $HOME\n\n${TRAILER}\nMSG`)
  allowed("unquoted-delimiter-expansion-unreadable", "git commit -F - <<MSG\nnope $(date)\nMSG")
  blocked(
    "unquoted-delimiter-live-backtick",
    `git commit -F - <<MSG\nfix: stop reading \`CHANGE.md\`\n\n${TRAILER}\nMSG`
  )
  allowed(
    "a heredoc writing a file is not a message",
    `cat > notes.md <<'EOF'\ngit add -A\nEOF\ngit commit -m "${GOOD_MSG}"`
  )
  allowed(
    "an earlier heredoc with the same delimiter is not the -F - message",
    `cat > notes.md <<'EOF'\nnot a subject\nEOF\ngit commit -F - <<'EOF'\n${GOOD_MSG}\nEOF`
  )
  blocked(
    "the commit's own heredoc is read, not an earlier one",
    `cat > notes.md <<'EOF'\n${GOOD_MSG}\nEOF\ngit commit -F - <<'EOF'\nnot a subject\nEOF`
  )
  allowed(
    "an earlier heredoc with the same delimiter is not the substituted message",
    `cat > notes.md <<'EOF'\nnot a subject\nEOF\ngit add notes.md && ${substituted(GOOD_MSG)}`
  )
  allowed(
    "a << inside the -m string is prose, the subject stays whole",
    `git commit -m "docs: use <<EOF heredocs\n\n${TRAILER}"`
  )
  allowed(
    "a << on a later line of the -m string is prose too",
    `git commit -m "docs: a thing\n\nsee cat << EOF in the readme\n\n${TRAILER}"`
  )
  blocked(
    "a << inside the -m string does not skip the subject check",
    `git commit -m "use <<EOF heredocs\n\n${TRAILER}"`
  )
})

describe("a live backtick inside -m is refused, an inert one passes", () => {
  blocked("backtick-in-double-quotes", `git commit -m "fix(hook): stop reading \`CHANGE.md\`\n\n${TRAILER}"`)
  blocked("backtick-unquoted", "git commit -m fix:`pwd`")
  blocked("backtick-in-body-m", `git commit -m "fix(hook): a thing" -m "it touches \`AGENTS.md\`" -m "${TRAILER}"`)
  allowed("backtick-single-quoted", `git commit -m 'fix(hook): stop reading \`CHANGE.md\`\n\n${TRAILER}'`)
  allowed("backtick-escaped", `git commit -m "fix(hook): stop reading \\\`CHANGE.md\\\`\n\n${TRAILER}"`)
})

describe("git add — the whole tree is refused, names pass", () => {
  blocked("add-dash-A", "git add -A")
  blocked("add-dash-A-clustered", "git add -Av")
  blocked("add-dash-A-in-cluster", "git add -uA")
  blocked("add-all-long", "git add --all")
  blocked("add-dot", "git add .")
  blocked("add-dot-slash", "git add ./")
  blocked("add-dot-after-separator", "git add -- .")
  blocked("add-dash-A-wrapped", "rtk git add -A")
  blocked("add-dash-A-subshell", "(cd app && git add -A)")
  blocked("add-dash-A-dot", "git add -A .")
  blocked("add-dash-A-root-pathspec", "git add -A :/")
  blocked("add-root-pathspec", "git add :/")
  allowed("add-dash-A-paths", "git add -A docs store README.md")
  allowed("add-all-after-separator", "git add --all -- src")
  allowed("add-dash-A-dry-run", "git add -A --dry-run")
  allowed("add-dash-An", "git add -An")
  allowed("add-dot-dry-run", "git add -n .")
  blocked("add-then-commit-chain", `git add -A && git commit -m "${GOOD_MSG}"`)
  allowed("add-by-name", "git add AGENTS.md scripts/lint.sh")
  allowed("add-patch", "git add -p AGENTS.md")
  allowed("add-dotted-path", "git add .ai/work/slug/CHANGE.md")
  allowed("add-update-only", "git add -u AGENTS.md")
  allowed("commit-a-is-not-add", `git commit -a -m "${GOOD_MSG}"`)
})

describe("commit.convention ticket-key asks for a ticket key and no trailer", () => {
  allowed("ticket-key-good", 'git commit -m "[ABC-12] docs: x"', TICKETS)
  allowed("ticket-key-long-key", 'git commit -m "[PROJECT-2508] feat: y"', TICKETS)
  allowed("ticket-key-no-trailer-needed", 'git commit -m "[ABC-12] fix: x"', TICKETS)
  blocked("ticket-key-no-ticket", 'git commit -m "docs: x"', TICKETS)
  allowed("ticket-key-revert", 'git commit -m "[ABC-12] revert: x"', TICKETS)
  blocked("ticket-key-unknown-type", 'git commit -m "[ABC-12] build: x"', TICKETS)
  blocked("ticket-key-scope", 'git commit -m "[ABC-12] fix(api): x"', TICKETS)
  blocked("ticket-key-add-A", "git add -A", TICKETS)
})

describe("a linked worktree judges by the main checkout's layer it lacks", () => {
  allowed("worktree-ticket-key", 'git commit -m "[VER-1] fix: x"', WORKTREE)
  blocked("worktree-conventional", 'git commit -m "fix: x"', WORKTREE)
})

describe("a literal cd or git -C moves a commit to that repository's config", () => {
  allowed("dash-C-ticket-repo", `git -C ${TICKETS} commit -m "[ABC-1] fix: x"`)
  allowed("dash-C-worktree-of-a-ticket-repo", `git -C ${WORKTREE} commit -m "[VER-1] fix: x"`)
  allowed("cd-ticket-repo", `cd ${TICKETS} && git commit -m "[ABC-1] fix: x"`)
  allowed("cd-relative", 'cd ../tickets && git commit -m "[ABC-1] fix: x"')
  blocked("cd-ticket-repo-conventional-subject", `cd ${TICKETS} && git commit -m "fix: x"`)
  blocked("cd-in-a-subshell-ends-with-it", `(cd ${TICKETS} && git status); git commit -m "[ABC-1] fix: x"`)
  blocked("dash-C-computed-at-runtime", 'git -C "$REPO" commit -m "[ABC-1] fix: x"')
  blocked("cd-computed-at-runtime", 'cd "$REPO" && git commit -m "[ABC-1] fix: x"')
  blocked("cd-to-a-missing-directory", 'cd /nonexistent/x; git commit -m "[ABC-1] fix: x"')
})

describe("with no convention set, Conventional Commits under any remote", () => {
  allowed("conventional-good", 'git commit -m "fix(hook): a thing"', OTHER)
  blocked("conventional-no-type", 'git commit -m "a thing with no type prefix"', OTHER)
  blocked("conventional-ticket-style", 'git commit -m "[ABC-12] docs: x"', OTHER)
  allowed("org-remote-conventional", 'git commit -m "fix(hook): a thing"', ORG)
  blocked("org-remote-ticket-style", 'git commit -m "[ABC-12] docs: x"', ORG)
})

describe("commit.convention conventional names the default outright", () => {
  allowed("convention-set-good", 'git commit -m "fix(hook): a thing"', CONVENTIONAL)
  blocked("convention-set-ticket", 'git commit -m "[ABC-12] docs: x"', CONVENTIONAL)
})

describe("commit.pattern .+ accepts any subject, the other checks stay", () => {
  allowed("any-shape", 'git commit -m "whatever shape, no trailer"', ANY)
  blocked("any-still-catches-backtick", 'git commit -m "whatever `pwd` shape"', ANY)
  blocked("any-still-catches-add-A", "git add -A", ANY)
})

describe("outside a repository the inferred defaults apply", () => {
  allowed("plain-conventional", 'git commit -m "fix(hook): a thing"', PLAIN)
  blocked("plain-no-type", 'git commit -m "a thing with no type prefix"', PLAIN)
})
