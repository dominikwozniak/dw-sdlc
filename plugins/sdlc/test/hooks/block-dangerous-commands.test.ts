// What block-dangerous-commands.sh refuses (exit 2) and lets through (exit 0), fed the real hook payload.
// A regex arm regresses silently, blocking legitimate work or letting a destructive command through, and
// the push policy reads the config, so the cases run against throwaway repositories with known files.

import assert from "node:assert/strict"
import { mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"

import {
  bashPayload,
  commit,
  expectExit,
  git,
  hookPath,
  initRepo,
  runHook,
  scratch,
  verdictOf,
  write,
  writeJson
} from "../harness.ts"
import { buildLandedRepo, LANDED_SCENARIOS } from "../landed-scenarios.ts"

const TMP = scratch("git")
const FEAT = initRepo(join(TMP, "feat"), { branch: "feat" })
const ON_MASTER = initRepo(join(TMP, "on-master"), { branch: "master" })
const DENY = initRepo(join(TMP, "deny"), { branch: "feat" })
writeJson(join(DENY, ".ai", "agentic.config.json"), { guardrails: { forcePush: "deny" } })
const ASK = initRepo(join(TMP, "ask"), { branch: "feat" })
writeJson(join(ASK, ".ai", "agentic.config.json"), { guardrails: { forcePush: "ask" } })
const STAGING = initRepo(join(TMP, "staging"), { branch: "feat" })
writeJson(join(STAGING, ".ai", "agentic.config.local.json"), {
  guardrails: { protectedBranches: ["master", "main", "production", "staging"] }
})
initRepo(join(FEAT, "sub"), { branch: "main" })
// Real branches for the pushes that name no refspec but every branch: a local master beside feat.
const BRANCHES = initRepo(join(TMP, "branches"), { branch: "master" })
write(join(BRANCHES, "a.txt"), "a\n")
git(BRANCHES, "add", "a.txt")
commit(BRANCHES, "-m", "init")
git(BRANCHES, "switch", "-q", "-c", "feat")
const FEATURES_ONLY = initRepo(join(TMP, "features-only"), { branch: "feat" })
write(join(FEATURES_ONLY, "a.txt"), "a\n")
git(FEATURES_ONLY, "add", "a.txt")
commit(FEATURES_ONLY, "-m", "init")
// A matching push reads the remote side from the remote-tracking refs: local master and feat, with
// origin tracking both in one repository and feat alone in the other.
function tracked(name: string, remoteBranches: string[]): string {
  const dir = initRepo(join(TMP, name), { branch: "master" })
  write(join(dir, "a.txt"), "a\n")
  git(dir, "add", "a.txt")
  commit(dir, "-m", "init")
  git(dir, "switch", "-q", "-c", "feat")
  for (const branch of remoteBranches) {
    git(dir, "update-ref", `refs/remotes/origin/${branch}`, "HEAD")
  }
  return dir
}
const TRACKS_MASTER = tracked("tracks-master", ["master", "feat"])
const TRACKS_FEAT = tracked("tracks-feat", ["feat"])
// A main checkout on main and a linked worktree of it on a feature branch, each a session's cwd that
// reaches the other; and a repository whose committed config protects only `release`.
const ON_MAIN = initRepo(join(TMP, "on-main"), { branch: "main" })
write(join(ON_MAIN, "a.txt"), "a\n")
git(ON_MAIN, "add", "a.txt")
commit(ON_MAIN, "-m", "init")
const SIBLING = join(TMP, "on-main-topic")
git(ON_MAIN, "worktree", "add", "-q", SIBLING, "-b", "topic")
const RELEASE = initRepo(join(TMP, "release"), { branch: "feat" })
writeJson(join(RELEASE, ".ai", "agentic.config.json"), { guardrails: { protectedBranches: ["release"] } })
// Repositories that take no commit on a protected branch: one on main, one on a feature branch, and
// one whose local layer is invalid, so the strictest set applies.
function commitDeny(name: string, branch: string, config: object): string {
  const dir = initRepo(join(TMP, name), { branch: "main" })
  write(join(dir, "a.txt"), "a\n")
  git(dir, "add", "a.txt")
  commit(dir, "-m", "init")
  if (branch !== "main") {
    git(dir, "switch", "-q", "-c", branch)
  }
  writeJson(join(dir, ".ai", "agentic.config.local.json"), config)
  return dir
}
// A repository with one committed file, then the state a `reset --hard` meets: nothing changed, a staged
// change, an unstaged change, an untracked file alone, and both changes at once with a dirty `sub`.
function withFile(name: string, edit?: (dir: string) => void): string {
  const dir = initRepo(join(TMP, name), { branch: "feat" })
  change(dir, "a.txt", "a\n")
  edit?.(dir)
  return dir
}
const CLEAN = withFile("reset-clean")
const STAGED = withFile("reset-staged", (dir) => {
  write(join(dir, "a.txt"), "b\n")
  git(dir, "add", "a.txt")
})
const UNSTAGED = withFile("reset-unstaged", (dir) => write(join(dir, "a.txt"), "b\n"))
const NEW_STAGED = withFile("reset-new-staged", (dir) => {
  write(join(dir, "b.txt"), "b\n")
  git(dir, "add", "b.txt")
})
const DELETED = withFile("reset-deleted", (dir) => rmSync(join(dir, "a.txt")))
// A change git is told not to see: diff reports nothing, yet a reset --hard loses it.
const ASSUME_UNCHANGED = withFile("reset-assume-unchanged", (dir) => {
  mkdirSync(join(dir, "dir"))
  git(dir, "update-index", "--assume-unchanged", "a.txt")
  write(join(dir, "a.txt"), "b\n")
})
const SKIP_WORKTREE = withFile("reset-skip-worktree", (dir) => {
  git(dir, "update-index", "--skip-worktree", "a.txt")
  write(join(dir, "a.txt"), "b\n")
})
const UNTRACKED = withFile("reset-untracked", (dir) => write(join(dir, "scratch.txt"), "x\n"))
const DIRTY = withFile("reset-dirty", (dir) => {
  write(join(dir, "a.txt"), "b\n")
  const sub = initRepo(join(dir, "sub"), { branch: "main" })
  change(sub, "a.txt", "a\n")
  write(join(sub, "a.txt"), "b\n")
})
const NO_REPO = scratch("reset-no-repo")
const DENY_ON_MAIN = commitDeny("deny-on-main", "main", { guardrails: { commitOnProtected: "deny" } })
const DENY_ON_FEAT = commitDeny("deny-on-feat", "feat", { guardrails: { commitOnProtected: "deny" } })
const BROKEN_ON_MAIN = commitDeny("broken-on-main", "main", { guardrails: { forcePush: "nope" } })
function change(dir: string, file: string, text: string): void {
  write(join(dir, file), text)
  git(dir, "add", file)
  commit(dir, "-m", `edit ${file}`)
}
// A clone of a bare origin with a branch for each row of the shared table of Landed scenarios.
const ORIGIN = join(TMP, "origin.git")
const SQUASHED = buildLandedRepo(join(TMP, "squashed"), ORIGIN)
// `>never`, a name git allows, points where `never` does.
git(SQUASHED, "branch", ">never", "never")
// A blobless clone of the origin has `never` without its blobs.
const BLOBLESS = join(TMP, "blobless")
git(TMP, "clone", "-q", "--filter=blob:none", "--no-checkout", `file://${ORIGIN}`, BLOBLESS)
git(BLOBLESS, "branch", "never", "origin/never")
// A branch on main, with origin's main tracked but not its HEAD: the base comes from baseBranch alone.
function baseRepo(name: string, config?: object): string {
  const dir = initRepo(join(TMP, name), { branch: "main" })
  change(dir, "a.txt", "a\n")
  git(dir, "branch", "merged")
  git(dir, "update-ref", "refs/remotes/origin/main", "HEAD")
  if (config !== undefined) {
    writeJson(join(dir, ".ai", "agentic.config.json"), config)
  }
  return dir
}
const NO_ORIGIN_HEAD = baseRepo("no-origin-head")
const NAMED_BASE = baseRepo("named-base", { baseBranch: "main" })
const MISSING_BASE = baseRepo("missing-base", { baseBranch: "develop" })
const FORGED_HEAD = baseRepo("forged-head")
git(FORGED_HEAD, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/heads/merged")

function blocked(name: string, command: string, cwd = FEAT): void {
  it(name, () => {
    expectExit(runHook("block-dangerous-commands", bashPayload(command, cwd)), 2)
  })
}
function allowed(name: string, command: string, cwd = FEAT): void {
  it(name, () => {
    expectExit(runHook("block-dangerous-commands", bashPayload(command, cwd)), 0)
  })
}
function asked(name: string, command: string, cwd = FEAT): void {
  it(name, () => {
    assert.equal(verdictOf(runHook("block-dangerous-commands", bashPayload(command, cwd))), "ask")
  })
}
function refused(name: string, command: string, cwd: string, reason: RegExp): void {
  it(name, () => {
    const verdict = runHook("block-dangerous-commands", bashPayload(command, cwd))
    expectExit(verdict, 2)
    assert.match(verdict.stderr, reason)
  })
}

describe("force pushes — the lease policy (defaults: lease, master/main/production protected)", () => {
  blocked("push-force", "git push --force")
  blocked("push-f", "git push -f")
  blocked("push-f-reordered", "git push origin main -f")
  blocked("push-f-cluster", "git push -uf origin feat")
  blocked("push-plus-refspec", "git push origin +feat")
  blocked("push-force-dash-C", "git -C sub push -f")
  blocked("push-force-rtk-disabled", "RTK_DISABLED=1 git push --force")
  blocked("lease-to-master", "git push --force-with-lease origin master")
  blocked("lease-to-main-refspec", "git push --force-with-lease origin feat:main")
  blocked("lease-to-refs-heads", "git push --force-with-lease=production:abc origin HEAD:refs/heads/production")
  blocked("lease-on-master-no-refspec", "git push --force-with-lease", ON_MASTER)
  allowed("lease-to-feature", "git push --force-with-lease origin feat")
  allowed("lease-and-includes", "git push --force-with-lease --force-if-includes origin feat")
  allowed("lease-no-refspec-on-feat", "git push --force-with-lease")
  allowed("lease-head-on-feat", "git push --force-with-lease origin HEAD")
  allowed("lease-dash-C-sub-on-main", "git -C sub push --force-with-lease origin topic")
  allowed("rtk-lease-to-feature", "rtk git push --force-with-lease origin feat")
  blocked("lease-dash-C-sub-to-main", "git -C sub push --force-with-lease")
  blocked("lease-unknown-location", "git -C nowhere push --force-with-lease")
  blocked("mirror", "git push --mirror origin")
  blocked("mirror-no-remote", "git push --mirror")
  blocked("lease-all-with-a-local-master", "git push --force-with-lease origin --all", BRANCHES)
  blocked("lease-branches-with-a-local-master", "git push --force-with-lease --branches", BRANCHES)
  allowed("lease-all-features-only", "git push --force-with-lease --all", FEATURES_ONLY)
})

describe("force pushes — configured repositories", () => {
  blocked("deny-refuses-lease", "git push --force-with-lease origin feat", DENY)
  blocked("deny-refuses-includes", "git push --force-with-lease --force-if-includes origin feat", DENY)
  allowed("deny-plain-push", "git push origin feat", DENY)
  blocked("local-adds-staging", "git push --force-with-lease origin staging", STAGING)
  allowed("local-keeps-feature", "git push --force-with-lease origin feat", STAGING)
  asked("ask-asks-for-a-lease", "git push --force-with-lease origin feat", ASK)
  asked("ask-asks-for-a-lease-with-its-ref", "git push -q --force-with-lease=feat:abc123 origin feat", ASK)
  blocked("ask-refuses-a-lease-to-protected", "git push --force-with-lease origin main", ASK)
  blocked("ask-refuses-bare-force", "git push --force origin feat", ASK)
  blocked("ask-then-a-protected-push", "git push --force-with-lease origin feat; git push origin main", ASK)
  allowed("ask-plain-push", "git push origin feat", ASK)
})

describe("plain pushes — a protected branch takes pull requests", () => {
  blocked("plain-to-master", "git push origin master")
  blocked("plain-to-main-refspec", "git push origin HEAD:main")
  blocked("plain-to-production-refs-heads", "git push -u origin feat:refs/heads/production")
  blocked("plain-on-master-no-refspec", "git push", ON_MASTER)
  blocked("plain-dash-C-sub-on-main", "git -C sub push")
  blocked("rtk-plain-to-main", "rtk git push -u origin feat:main")
  blocked("local-adds-staging-plain", "git push origin staging", STAGING)
  allowed("plain-to-feature", "git push origin feat")
  allowed("plain-no-refspec-on-feat", "git push")
  allowed("plain-u-feature", "git push -u origin feat")
  allowed("plain-to-feature-under-deny", "git push origin feat", DENY)
  allowed("plain-dash-C-sub-to-topic", "git -C sub push origin topic")
  allowed("plain-unknown-location", "git -C nowhere push")
  allowed("tags-alone-on-master", "git push --tags", ON_MASTER)
  allowed("tags-alone-with-remote-on-master", "git push origin --tags", ON_MASTER)
  blocked("tags-with-a-protected-refspec", "git push origin master --tags", ON_MASTER)
  allowed("dry-run-on-master", "git push --dry-run", ON_MASTER)
  allowed("dry-run-short-to-main", "git push -n origin main")
  blocked("matching-reaches-master", "git push origin :", TRACKS_MASTER)
  allowed("matching-without-master-on-the-remote", "git push origin :", TRACKS_FEAT)
  // No remote-tracking refs to read the remote side from: every local branch counts.
  blocked("matching-to-a-url", "git push git@example.com:acme/x.git :", TRACKS_FEAT)
})

describe("a literal cd or git -C moves a push to that repository, its branch and its config", () => {
  allowed("cd-into-a-feature-worktree", `cd ${SIBLING} && git push`, ON_MAIN)
  allowed("cd-into-a-feature-worktree-HEAD", `cd ${SIBLING} && git push -u origin HEAD`, ON_MAIN)
  allowed("cd-relative", "cd ../on-main-topic && git push", ON_MAIN)
  blocked("cd-into-the-main-checkout", `cd ${ON_MAIN} && git push`, SIBLING)
  blocked("cd-in-a-subshell-ends-with-it", `(cd ${SIBLING} && git status); git push`, ON_MAIN)
  blocked("cd-computed-at-runtime", 'cd "$WT" && git push', ON_MAIN)
  blocked("cd-to-a-missing-directory", "cd /nonexistent/x; git push", ON_MAIN)
  blocked("cd-back", `cd ${SIBLING} && cd - && git push`, ON_MAIN)
  blocked("dash-C-computed-at-runtime", 'git -C "$WT" push', ON_MAIN)
  blocked("dash-C-reads-that-config", `git -C ${RELEASE} push origin release`)
  blocked("cd-reads-that-config", `cd ${RELEASE} && git push origin release`)
  allowed("dash-C-protects-only-what-that-config-lists", `git -C ${RELEASE} push origin main`)
})

describe("reset --hard — passes when no tracked file has a change, since nothing is lost", () => {
  allowed("clean-tree", "git reset --hard", CLEAN)
  allowed("clean-tree-ref", "git reset --hard HEAD~0", CLEAN)
  allowed("clean-tree-branch", "git reset --hard feat", CLEAN)
  allowed("clean-tree-quiet", "git reset -q --hard HEAD", CLEAN)
  allowed("clean-tree-dash-C", `git -C ${CLEAN} reset --hard`, FEAT)
  allowed("clean-tree-after-cd", `cd ${CLEAN} && git reset --hard`, FEAT)
  allowed("clean-tree-rtk", "rtk git reset --hard", CLEAN)
  allowed("untracked-file-alone", "git reset --hard", UNTRACKED)
  blocked("staged-change", "git reset --hard", STAGED)
  blocked("staged-change-ref", "git reset --hard HEAD~1", STAGED)
  blocked("unstaged-change", "git reset --hard", UNSTAGED)
  blocked("unstaged-change-ref", "git reset --hard origin/main", UNSTAGED)
  blocked("staged-new-file", "git reset --hard", NEW_STAGED)
  blocked("deleted-tracked-file", "git reset --hard", DELETED)
  blocked("assume-unchanged-edit", "git reset --hard", ASSUME_UNCHANGED)
  blocked("skip-worktree-edit", "git reset --hard", SKIP_WORKTREE)
  blocked("assume-unchanged-edit-from-a-subdirectory", "git reset --hard", join(ASSUME_UNCHANGED, "dir"))
  blocked("assume-unchanged-edit-dash-C-a-subdirectory", `git -C ${join(ASSUME_UNCHANGED, "dir")} reset --hard`, CLEAN)
  blocked("dash-C-to-a-dirty-tree", `git -C ${UNSTAGED} reset --hard`, CLEAN)
  blocked("cd-to-a-dirty-tree", `cd ${UNSTAGED} && git reset --hard`, CLEAN)
  blocked("dirty-sub-below-a-clean-cwd", "git -C sub reset --hard", DIRTY)
  blocked("outside-a-repository", "git reset --hard", NO_REPO)
  blocked("unborn-head", "git reset --hard", FEAT)
  blocked("unknown-dash-C", "git -C nowhere reset --hard", CLEAN)
  blocked("dash-C-computed-at-runtime", 'git -C "$WT" reset --hard', CLEAN)
  blocked("cd-computed-at-runtime", 'cd "$WT" && git reset --hard', CLEAN)
  blocked("cd-back", "cd - && git reset --hard", CLEAN)
  // A command that may change the tree before the reset runs makes the reset refused; a cd, a fetch or a switch does not.
  blocked("after-a-write", "echo x >> a.txt && git reset --hard", CLEAN)
  allowed("after-a-fetch", "git fetch origin && git reset --hard origin/main", CLEAN)
  allowed("after-a-fetch-with-a-global-option", "git -c color.ui=false -C . fetch && git reset --hard", CLEAN)
  allowed("after-a-switch", "git switch -c topic && git reset --hard HEAD~0", CLEAN)
  allowed("after-a-cd-and-a-status", `cd ${CLEAN} && git status && git reset --hard`, FEAT)
  blocked("after-a-checkout-of-a-path", "git checkout HEAD~0 -- a.txt && git reset --hard", CLEAN)
  blocked("after-a-stash-pop", "git stash pop && git reset --hard", CLEAN)
  blocked("after-a-merge", "git merge --no-commit topic && git reset --hard", CLEAN)
  blocked("after-git-add", "git add -A; git reset --hard", CLEAN)
  blocked("after-a-substitution", "echo $(sed -i s/a/b/ a.txt) && git reset --hard", CLEAN)
  blocked("piped-into", "echo x | git reset --hard", CLEAN)
  blocked("git-dir-assignment", "GIT_DIR=x git reset --hard", CLEAN)
  blocked("git-work-tree-assignment", `GIT_WORK_TREE=${UNSTAGED} git reset --hard`, CLEAN)
  allowed("reset-then-more", "git reset --hard && git status", CLEAN)
  allowed("soft-after-a-write", "echo x >> a.txt && git reset --soft HEAD", CLEAN)
  blocked("bash-c-on-a-dirty-tree", "bash -c 'git reset --hard'", UNSTAGED)
  allowed("bash-c-on-a-clean-tree", "bash -c 'git reset --hard'", CLEAN)
})

describe("the rest of the destructive set", () => {
  blocked("push-d", "git push origin -d old-branch")
  // Both spellings of a remote deletion get the push parser's reason, not a regex arm's.
  const deletions: [string, string][] = [
    ["push-delete", "git push origin --delete old-branch"],
    ["push-colon-delete", "git push origin :old-branch"],
    ["push-plus-colon-delete", "git push origin +:old-branch"],
    ["push-colon-delete-among-refspecs", "git push origin feat :old-branch"],
    ["rtk-run-colon-delete", 'rtk run "git push origin :old-branch"'],
    ["push-repo-colon-delete", "git push --repo origin :old-branch"],
    ["push-repo-glued-colon-delete", "git push --repo=origin :old-branch"]
  ]
  for (const [name, command] of deletions) {
    it(name, () => {
      const verdict = runHook("block-dangerous-commands", bashPayload(command, FEAT))
      expectExit(verdict, 2)
      assert.match(verdict.stderr, /deletes a remote branch/)
    })
  }
  blocked("reset-hard", "git reset --hard", DIRTY)
  blocked("reset-hard-ref", "git reset --hard HEAD~1", DIRTY)
  blocked("clean-fd", "git clean -fd")
  blocked("clean-f-d", "git clean -f -d")
  blocked("clean-xdf", "git clean -xdf")
  blocked("clean-d", "git clean -d")
  blocked("branch-f-repoint", "git branch -f master HEAD~3", BRANCHES)
  // Git's own merge check keeps a plain -d from deleting unmerged work; every form that skips it is refused.
  blocked("branch-D", "git branch -D feature")
  blocked("branch-D-after-the-name", "git branch feature -D")
  blocked("branch-df-cluster", "git branch -df feature")
  blocked("branch-fd-cluster", "git branch -fd feature")
  blocked("branch-delete-force-long", "git branch --delete --force feature")
  blocked("branch-d-f", "git branch -d -f feature")
  allowed("branch-delete-long", "git branch --delete merged")
  allowed("branch-name-holding-D", "git branch -d fix-Dates")
  blocked("branch-move-force", "git branch -M main")
  blocked("branch-copy-force", "git branch -C a b")
  blocked("branch-force-an-existing-branch", "git branch -f master HEAD", BRANCHES)
  blocked("branch-force-delete-long", "git branch -d -f feature")
  allowed("branch-force-a-new-branch", "git branch -f newbranch HEAD", BRANCHES)
  allowed("branch-list-verbose", "git branch -vv")
  allowed("branch-set-upstream", "git branch -u origin/feat")
  allowed("branch-sort-descending", "git branch --sort=-refname")
  // `worktree remove` keeps a worktree with modified or untracked files unless it is forced.
  blocked("worktree-remove-force", "git worktree remove --force ../wt")
  blocked("worktree-remove-f", "git worktree remove -f ../wt")
  blocked("worktree-remove-f-twice", "git worktree remove -f -f ../wt")
  blocked("worktree-remove-force-after-the-path", "git worktree remove ../wt --force")
  allowed("worktree-remove", "git worktree remove ../wt")
  allowed("worktree-remove-path-ending-in-f", "git worktree remove ../wt-f")
  allowed("worktree-prune", "git worktree prune")
  // A stash lives only in the stash reflog; `pop` drops the entry only once the apply succeeds.
  blocked("stash-drop", "git stash drop")
  blocked("stash-drop-named", "git stash drop stash@{1}")
  blocked("stash-drop-quiet", "git stash drop -q")
  allowed("stash-pop", "git stash pop")
  allowed("stash-list", "git stash list")
  blocked("checkout-dot", "git checkout .")
  blocked("checkout-dashes-dot", "git checkout -- .")
  blocked("restore-dot", "git restore .")
  blocked("restore-dashes-dot", "git restore -- .")
  blocked("restore-dot-slash", "git restore ./")
  blocked("restore-dot-chained", "git restore . && echo done")
  blocked("rtk-run-restore-dot", 'rtk run "git restore ."')
  blocked("restore-quoted-dot", 'git restore "."')
  blocked("restore-sq-dot", "git restore '.'")
  blocked("restore-dash-C-dot", "git -C sub restore .")
  blocked("checkout-dash-C-dot", "git -C ../other checkout -- .")
  blocked("checkout-head-dashes-dot", "git checkout HEAD -- .")
  blocked("checkout-treeish-dot", "git checkout main .")
  blocked("checkout-force", "git checkout -f master")
  blocked("checkout-force-long", "git checkout --force")
  blocked("switch-force", "git switch -f main")
  blocked("switch-discard-changes", "git switch --discard-changes main")
  blocked("restore-worktree-dot", "git restore --worktree .")
  blocked("restore-W-S-dot", "git restore -W -S .")
  blocked("restore-SW-dot", "git restore -SW .")
  blocked("restore-source-dot", "git restore --source=HEAD~1 .")
  blocked("restore-s-treeish-dot", "git restore -s HEAD .")
  blocked("restore-staged-worktree-dot", "git restore --staged --worktree .")
  allowed("restore-staged-dot", "git restore --staged .")
  allowed("restore-S-dot", "git restore -S .")
  allowed("restore-staged-dashes-dot", "git restore --staged -- .")
  allowed("restore-worktree-one-path", "git restore --worktree src/a.ts")
  allowed("checkout-branch", "git checkout feat")
  allowed("checkout-new-branch", "git checkout -b topic")
  allowed("checkout-one-path-in-dotdir", "git checkout -- .github/workflows/x.yml")
  allowed("switch-create", "git switch -c topic")
  blocked("push-delete-dash-C", "git -C sub push origin --delete old-branch")
  blocked("reset-hard-dash-C", "git -C sub reset --hard HEAD~1", DIRTY)
  blocked("clean-fd-dash-C", "git -C sub clean -fd")
  blocked("stash-clear-dash-C", "git -C sub stash clear")
  blocked("branch-D-dash-C", "git -C sub branch -D feature")
  blocked("worktree-remove-force-dash-C", "git -C sub worktree remove --force ../wt")
  blocked("stash-drop-dash-C", "git -C sub stash drop")
  blocked("rtk-dash-C-push", "rtk git -C sub push --force")
  blocked("dash-C-abs-path", "git -C /Users/someone/repo push --force")
  blocked("dash-C-worktree", "git -C .claude/worktrees/other push --force")
  blocked("dash-C-chained", "pnpm test && git -C sub reset --hard", DIRTY)
  blocked("dash-C-quoted-path", "git -C 'my repo' push --force")
  blocked("dash-C-dq-path", 'git -C "my repo" reset --hard', DIRTY)
  blocked("stash-clear", "git stash clear")
  blocked("rm-root", "rm -rf /")
  blocked("rm-home-tilde", "rm -rf ~")
  blocked("rm-home-var", "rm -rf $HOME")
  blocked("rm-cwd", "rm -rf .")
  blocked("rm-home-dq", 'rm -rf "$HOME"')
  blocked("rm-home-dq-slash", 'rm -rf "$HOME/"')
  blocked("rm-home-dq-then-slash", 'rm -rf "$HOME"/')
  blocked("rm-home-braced-dq", 'rm -rf "${HOME}"')
  blocked("rm-root-dq", 'rm -rf "/"')
  blocked("rm-cwd-sq", "rm -rf '.'")
  blocked("rm-parent-dq", 'rm -rf ".."')
  allowed("rm-home-subdir-dq", 'rm -rf "$HOME/old-dir"')
  allowed("rm-literal-tilde-sq", "rm -rf '~'")
  allowed("rm-literal-tilde-dq", 'rm -rf "~"')
  allowed("rm-literal-home-sq", "rm -rf '$HOME'")
  allowed("rm-relative-dir-dq", 'rm -rf "./dist"')
  allowed("rm-dotfile-dq", 'rm -f ".eslintcache"')
  blocked("rm-cwd-glob", "rm -rf ./*")
  blocked("rm-parent-glob", "rm -rf ../*")
  blocked("rm-home-tilde-glob", "rm -rf ~/*")
  blocked("rm-home-var-glob", "rm -rf $HOME/*")
  blocked("rm-home-dq-glob", 'rm -rf "$HOME"/*')
  blocked("rm-bare-glob", "rm -rf *")
  blocked("rm-bare-glob-first", "rm -rf * build")
  allowed("rm-glob-suffix", "rm -rf *.log")
  allowed("rm-subdir-glob", "rm -rf tmp/*")
  allowed("rm-relative-subdir-glob", "rm -rf ./dist/*")
  blocked("find-delete", "find . -name '*.pyc' -delete")
  blocked("shred", "shred secrets.txt")
  blocked("chained", "cd subdir && git push --force")
  blocked("sudo-rm-root", "sudo rm -rf /")
  blocked("rtk-push-force", "rtk git push --force")
  blocked("rtk-push-f", "rtk git push -f origin main")
  blocked("rtk-stash-clear", "rtk git stash clear")
  blocked("rtk-branch-D", "rtk git branch -D feature")
  blocked("rtk-worktree-remove-force", "rtk git worktree remove --force ../wt")
  blocked("rtk-stash-drop", "rtk git stash drop")
  blocked("rtk-proxy-push", "rtk proxy git push --force")
  blocked("rtk-chained", "cd subdir && rtk git push --force")
  blocked("rtk-run-push", "rtk run git push --force")
  blocked("rtk-run-quoted", 'rtk run "git push --force"')
  blocked("rtk-err-push", "rtk err git push --force")
  blocked("rtk-summary-push", "rtk summary git push --force")
  blocked("sudo-rtk-run-push", "sudo rtk run git push --force")
  blocked("rtk-run-rm-home", "rtk run rm -rf ~")
  blocked("assign-push-force", "FOO=1 git push --force")
  blocked("assign-reset-hard", "GIT_DIR=x git reset --hard", DIRTY)
  blocked("assign-empty-value", "FOO= git push --force")
  blocked("assign-multi", "A=1 B=2 git clean -fd")
  blocked("assign-rtk-push", "NODE_ENV=x rtk git push --force")
  blocked("assign-sudo-rm-root", "FOO=1 sudo rm -rf /")
  blocked("assign-chained", "cd sub && FOO=1 git clean -fd")
})

describe("a forced branch delete passes once the branch is landed: its work is on the base branch", () => {
  for (const { name, branch, landed } of LANDED_SCENARIOS) {
    if (landed) {
      allowed(name, `git branch -D ${branch}`, SQUASHED)
    } else {
      refused(name, `git branch -D ${branch}`, SQUASHED, new RegExp(`'${branch}'.*git fetch`))
    }
  }
  allowed("several-merged", "git branch -D fresh moved behind ff", SQUASHED)
  allowed("d-f", "git branch -d -f behind", SQUASHED)
  allowed("delete-force-long", "git branch --delete --force behind", SQUASHED)
  allowed("df-cluster", "git branch -df behind", SQUASHED)
  allowed("after-the-name", "git branch behind -D", SQUASHED)
  allowed("after-a-double-dash", "git branch -D -- behind", SQUASHED)
  allowed("rtk", "rtk git branch -D behind", SQUASHED)
  allowed("dash-C", `git -C ${SQUASHED} branch -D behind`, TMP)
  allowed("both-streams-redirected", "git branch -D behind 2>&1", SQUASHED)
  allowed("both-streams-to-a-file", "git branch -D behind &>/dev/null", SQUASHED)
  allowed("output-discarded", "git branch -D behind >/dev/null", SQUASHED)
  allowed("errors-discarded-apart", "git branch -D behind 2> /dev/null", SQUASHED)
  allowed("base-branch-from-the-config", "git branch -D merged", NAMED_BASE)
  refused("one-unmerged-among-merged", "git branch -D fresh never behind", SQUASHED, /'never'/)
  refused("a-missing-branch", "git branch -D gone", SQUASHED, /'gone'/)
  refused("a-variable", 'git branch -D "$b"', SQUASHED, /does not write out/)
  refused("a-glob", "git branch -D 'fre*'", SQUASHED, /does not write out/)
  refused("a-quoted-name-that-reads-as-a-redirect", 'git branch -D fresh ">never"', SQUASHED, /reads as a redirect/)
  refused("no-branch-named", "git branch -D", SQUASHED, /no branch it names/)
  refused("remote-tracking", "git branch -D -r origin/late", SQUASHED, /remote-tracking/)
  refused("no-origin-head", "git branch -D merged", NO_ORIGIN_HEAD, /base branch/)
  refused("origin-head-outside-origin", "git branch -D merged", FORGED_HEAD, /base branch/)
  refused("a-base-branch-origin-lacks", "git branch -D merged", MISSING_BASE, /origin\/develop/)
  it("a-partial-clone-fetches-nothing", () => {
    const packs = (): number => readdirSync(join(BLOBLESS, ".git", "objects", "pack")).length
    const before = packs()
    const verdict = runHook("block-dangerous-commands", bashPayload("git branch -D never", BLOBLESS))
    expectExit(verdict, 2)
    assert.equal(packs(), before, "no blob fetched from the promisor remote")
  })
  // Only as a command of its own: anything else could point git at another repository or other
  // branches than the guard checks.
  const longer: [string, string][] = [
    ["cd-first", `cd ${SQUASHED} && git branch -D behind`],
    ["pushd-first", `pushd ${SQUASHED} && git branch -D behind`],
    ["cd-in-a-child-shell", `bash -c 'cd ${SQUASHED}'; git branch -D behind`],
    ["git-dir-assigned", `GIT_DIR=${SQUASHED}/.git git branch -D behind`],
    ["env-chdir", `env -C ${SQUASHED} git branch -D behind`],
    ["git-dir-option", `git --git-dir ${SQUASHED}/.git branch -D behind`],
    ["dash-C-twice", `git -C ${SQUASHED} -C . branch -D behind`],
    ["dash-C-variable", 'git -C "$R" branch -D behind'],
    ["after-a-fetch", `git -C ${SQUASHED} fetch && git -C ${SQUASHED} branch -D behind`],
    ["in-a-pipeline", `git -C ${SQUASHED} branch -D behind | cat`],
    ["a-substitution", `git -C ${SQUASHED} branch -D $(git branch --merged)`],
    ["a-backtick-adds-branches", `git -C ${SQUASHED} branch -D fresh \`echo never\``],
    ["a-glued-backtick", `git -C ${SQUASHED} branch -D fresh\`echo -v2\``],
    ["xargs-adds-branches", `echo never | xargs git -C ${SQUASHED} branch -D fresh`],
    ["find-exec-adds-branches", `find . -exec git -C ${SQUASHED} branch -D fresh {} +`]
  ]
  for (const [name, command] of longer) {
    refused(name, command, TMP, /a command of its own/)
  }
})

describe("the wrappers and global options a shell or git accepts before the verb", () => {
  blocked("command-reset", "command git reset --hard", DIRTY)
  blocked("env-assign-reset", "env FOO=1 git reset --hard", DIRTY)
  blocked("env-option-reset", "env -i git reset --hard", DIRTY)
  blocked("subshell-reset", "(git reset --hard)", DIRTY)
  blocked("subshell-after-cd", "(cd sub; git reset --hard)", DIRTY)
  blocked("substitution-reset", "echo $(git reset --hard)", DIRTY)
  blocked("subshell-rm-root", "(rm -rf /)")
  blocked("subshell-rm-cwd", "(rm -rf .)")
  blocked("subshell-rm-cwd-glob", "(rm -rf ./*)")
  blocked("subshell-rm-home", "(rm -rf ~)")
  blocked("substitution-rm-cwd", "echo $(rm -rf .)")
  blocked("subshell-find-delete", "(find . -name '*.pyc' -delete)")
  blocked("subshell-checkout-dot", "(git checkout .)")
  blocked("subshell-restore-dot", "(git restore .)")
  blocked("subshell-after-cd-restore-dot", "(cd sub; git restore .)")
  blocked("git-c-reset", "git -c color.ui=false reset --hard", DIRTY)
  blocked("git-no-pager-reset", "git --no-pager reset --hard", DIRTY)
  blocked("git-git-dir-clean", "git --git-dir .git clean -fd")
  blocked("git-two-C-reset", "git -C sub -C . reset --hard", DIRTY)
  blocked("command-push-force", "command git push --force")
  blocked("env-push-f", "env GIT_TRACE=1 git push -f")
  blocked("subshell-push-force", "(git push --force)")
  blocked("git-c-push-force", "git -c push.default=current push --force")
  allowed("command-lookup", "command -v git")
  allowed("env-dump-sorted", "env | sort")
  allowed("git-c-log", "git -c color.ui=always log --oneline")
  allowed("subshell-status", "(cd sub && git status)")
  allowed("prose-subshell", 'git commit -m "docs: never (git reset --hard)"')
})

describe("a shell, eval or a backtick runs the command it is handed", () => {
  blocked("bash-c-reset", "bash -c 'git reset --hard'", DIRTY)
  blocked("sh-c-reset-double-quoted", 'sh -c "git reset --hard"', DIRTY)
  blocked("bash-lc-reset", "bash -lc 'git reset --hard'", DIRTY)
  blocked("zsh-e-c-reset", "zsh -e -c 'git clean -fd'")
  blocked("sudo-bash-c-rm-home", "sudo bash -c 'rm -rf ~'")
  blocked("eval-quoted-reset", "eval 'git reset --hard'", DIRTY)
  blocked("eval-bare-reset", "eval git reset --hard", DIRTY)
  blocked("backtick-reset", "echo `git reset --hard`", DIRTY)
  blocked("backtick-after-assign", "x=`git clean -fd`")
  blocked("bash-c-push-force", "bash -c 'git push --force'")
  blocked("eval-push-to-main", "eval 'git push origin HEAD:main'")
  blocked("backtick-push-force", "x=`git push --force`")
  blocked("bash-c-restore-dot", "bash -c 'git restore .'")
  blocked("bash-o-pipefail-c-reset", "bash -o pipefail -c 'git reset --hard'", DIRTY)
  blocked("bash-norc-c-reset", "bash --norc -c 'git reset --hard'", DIRTY)
  blocked("bash-c-chained-reset", 'bash -c "cd sub && git reset --hard"', DIRTY)
  blocked("bash-c-chained-push-force", "bash -c 'cd sub; git push --force'")
  blocked("eval-chained-clean", "eval 'cd sub && git clean -fd'")
  blocked("bash-c-ansi-c-reset", "bash -c $'git reset --hard'", DIRTY)
  blocked("bash-c-ansi-c-chained-clean", "bash -c $'cd sub && git clean -fd'")
  blocked("bash-c-ansi-c-newline-reset", "bash -c $'cd sub\\ngit reset --hard'", DIRTY)
  blocked("eval-ansi-c-push-force", "eval $'git push --force'")
  blocked("bash-c-ansi-c-hex-semicolon-reset", "bash -c $'echo x\\x3b git reset --hard'", DIRTY)
  blocked("bash-c-ansi-c-octal-newline-reset", "bash -c $'cd sub\\012git reset --hard'", DIRTY)
  blocked("bash-c-ansi-c-hex-ampersands-reset", "bash -c $'cd sub \\x26\\x26 git reset --hard'", DIRTY)
  blocked("bash-c-ansi-c-hex-space-reset", "bash -c $'git\\x20reset --hard'", DIRTY)
  blocked("bash-c-locale-chained-reset", 'bash -c $"cd sub && git reset --hard"', DIRTY)
  blocked("rm-ansi-c-root", "rm -rf $'/'")
  blocked("rm-locale-root", 'rm -rf $"/"')
  blocked("checkout-ansi-c-dot", "git checkout -- $'.'")
  allowed("echo-ansi-c-hex-semicolon", "echo $'x\\x3b git reset --hard'")
  allowed("sh-c-ansi-c-echo", "sh -c $'echo reset --hard'")
  allowed("prose-ansi-c", "git commit -m $'docs: never; git reset --hard'")
  allowed("bash-script", "bash scripts/build.sh")
  allowed("bash-c-tests", "bash -c 'pnpm test'")
  allowed("sh-c-echo", "sh -c 'echo reset --hard'")
  allowed("eval-status", "eval git status")
  allowed("backtick-status", "echo `git status`")
  // Single quotes keep a backtick inert: this is a message, not a substitution.
  allowed("prose-backtick", "git commit -m 'docs: never `git reset --hard`'")
  allowed("heredoc-commit-backtick", "git commit -F - <<'EOF'\nfix: x\n\nnever run `git reset --hard`\nEOF")
  allowed("heredoc-pr-body-backtick", "gh pr create --body-file - <<'EOF'\nno `git push --force` here\nEOF")
  allowed("heredoc-file-backtick", "cat > notes.md <<'EOF'\nuse `git clean -fd` with care\nEOF")
  allowed("grep-c-pattern", "grep -c 'a; git reset --hard' notes.md")
  blocked("after-a-bash-c-with-no-script", "bash -c ; git reset --hard", DIRTY)
  blocked("after-an-eval-with-nothing", "eval ; git push --force")
  allowed("bash-c-with-no-script", "bash -c")
  allowed("eval-with-nothing", "eval")
  blocked("after-a-bash-c-sq-holding-a-dq", "bash -c 'echo \"' ; git reset --hard ; echo '\"'", DIRTY)
  blocked("after-a-bash-c-dq-holding-a-sq", 'bash -c "echo \'" ; git reset --hard ; echo "\'"', DIRTY)
  blocked("after-a-bash-c-sq-holding-a-backtick", "bash -c 'echo `' ; git reset --hard ; echo '`'", DIRTY)
  blocked("after-an-eval-dq-holding-an-ansi-c", 'eval "echo $\'" && git clean -fd && echo "\'"')
  blocked("after-an-expansion-default-in-a-bash-c-dq", 'bash -c "${x:-"a"} ; git reset --hard"', DIRTY)
  blocked("ansi-c-expansion-default-in-a-bash-c-dq", "bash -c \"${x:-$'a; git reset --hard'}\"", DIRTY)
  blocked("sq-expansion-replacement-in-a-bash-c-dq", "bash -c \"${PWD/*/'a; git reset --hard'}\"", DIRTY)
  allowed("dq-expansion-default-prose", 'echo "${x:-"a; git reset --hard"}"')
  allowed("bash-c-prose-in-nested-quotes", "bash -c 'git commit -m \"docs: never; git reset --hard\"'")
  allowed("bash-c-dq-prose-in-nested-quotes", "bash -c \"git commit -m 'docs: never; git reset --hard'\"")
})

describe("a command at any command position: indented, behind a keyword or a launcher", () => {
  blocked("indented-after-and", "cd /tmp &&\n  git reset --hard", DIRTY)
  blocked("indented-in-if", "if true; then\n  rm -rf ~\nfi")
  blocked("then-reset", "if true; then git reset --hard; fi", DIRTY)
  blocked("if-condition-reset", "if git reset --hard; then echo done; fi", DIRTY)
  blocked("do-branch-D", "for b in a b; do git branch -D $b; done")
  blocked("do-push-force", "for x in 1; do git push --force; done")
  blocked("while-read-branch-D", 'git branch | while read b; do git branch -D "$b"; done')
  blocked("bang-reset", "! git reset --hard", DIRTY)
  blocked("brace-group-branch-D", "{ git branch -D x; }")
  blocked("brace-group-restore-dot", "{ git restore .; }")
  blocked("xargs-branch-D", "git branch --merged | xargs git branch -D")
  blocked("xargs-n1-push-delete", "echo a | xargs -n1 git push origin --delete")
  blocked("xargs-replace-branch-D", "echo a | xargs -I{} git branch -D {}")
  blocked("xargs-restore-dot", "echo | xargs git restore .")
  blocked("xargs-rm-home", "echo x | xargs rm -rf ~")
  blocked("find-exec-reset", "find . -name x -exec git reset --hard \\;", DIRTY)
  blocked("find-exec-rm-home", "find . -exec rm -rf ~ \\;")
  blocked("timeout-push-force", "timeout 10 git push --force")
  blocked("timeout-rm-home", "timeout 5 rm -rf ~")
  blocked("time-reset", "time git reset --hard", DIRTY)
  blocked("time-p-reset", "time -p git reset --hard", DIRTY)
  blocked("nohup-reset", "nohup git reset --hard", DIRTY)
  blocked("nice-reset", "nice -n 10 git reset --hard", DIRTY)
  blocked("exec-reset", "exec git reset --hard", DIRTY)
  blocked("stdbuf-reset", "stdbuf -oL git reset --hard", DIRTY)
  blocked("sudo-user-reset", "sudo -u me git reset --hard", DIRTY)
  blocked("sudo-user-push-force", "sudo -u me git push --force")
  blocked("env-unset-reset", "env -u X git reset --hard", DIRTY)
  blocked("command-p-reset", "command -p git reset --hard", DIRTY)
  blocked("absolute-git-reset", "/usr/bin/git reset --hard", DIRTY)
  blocked("absolute-git-push-force", "/usr/bin/git push --force")
  blocked("escaped-git-push-force", "\\git push --force")
  blocked("absolute-rm-home", "/bin/rm -rf ~")
  blocked("escaped-rm-home", "\\rm -rf ~")
  blocked("bash-c-assignment-reset", "bash -c 'X=1 git reset --hard'", DIRTY)
  blocked("eval-assignment-reset", "eval 'X=1 git reset --hard'", DIRTY)
  blocked("rtk-run-assignment-reset", "rtk run 'GIT_DIR=.git git reset --hard'", DIRTY)
  blocked("sh-c-assignment-branch-D", 'sh -c "FOO=1 git branch -D x"')
  blocked("bash-c-assignment-rm-root", "bash -c 'X=1 rm -rf /'")
  blocked("bash-c-timeout-rm-home", "bash -c 'timeout 5 rm -rf ~'")
  blocked("bash-euo-pipefail-c-reset", "bash -euo pipefail -c 'git reset --hard'", DIRTY)
  blocked("bash-euo-pipefail-c-rm-home", "bash -euo pipefail -c 'rm -rf ~'")
  allowed("xargs-add", "git ls-files -m | xargs git add")
  allowed("command-v-git", "command -v git reset --hard")
  allowed("time-status", "time git status")
  allowed("for-echo", "for b in a b; do echo $b; done")
})

describe("git verbs are read as words: spacing, clusters, option values", () => {
  blocked("double-space-reset", "git  reset --hard", DIRTY)
  blocked("tab-reset", "git\treset --hard", DIRTY)
  blocked("double-space-branch-D", "git  branch -D x")
  blocked("checkout-force-cluster", "git checkout -fb x")
  blocked("checkout-quiet-force-cluster", "git checkout -qf main")
  blocked("clean-exclude-first", "git clean -e foo -fd")
  blocked("checkout-top-pathspec", "git checkout -- :/")
  blocked("restore-top-pathspec", "git restore :/")
  allowed("branch-sort-separate-value", "git branch --sort -refname")
  allowed("branch-sort-head", "git branch --sort -HEAD")
  allowed("branch-format-quoted-D", "git branch --format '%(refname:short) -D'")
  allowed("branch-list-pattern-f", 'git branch --list "x -f"')
  allowed("checkout-create-force", "git checkout -B topic")
  allowed("switch-force-create", "git switch -C topic")
  allowed("clean-dry-run-cluster", "git clean -nfd")
  allowed("checkout-branch-named-f", "git checkout -bf topic")
})

describe("the history a reflog cannot bring back", () => {
  blocked("reflog-expire", "git reflog expire --expire=now --all")
  blocked("reflog-delete", "git reflog delete HEAD@{1}")
  blocked("gc-prune-now", "git gc --prune=now")
  blocked("gc-prune-all", "git gc --aggressive --prune=all")
  blocked("prune", "git prune")
  blocked("update-ref-delete", "git update-ref -d refs/heads/x")
  blocked("update-ref-delete-long", "git update-ref --delete refs/heads/x")
  allowed("reflog-show", "git reflog")
  allowed("gc", "git gc")
  allowed("prune-dry-run", "git prune -n")
  allowed("update-ref-set", "git update-ref refs/heads/x HEAD")
  allowed("rm-force-one-file", "git rm -f a.txt")
  allowed("tag-delete", "git tag -d v1")
  allowed("merge-abort", "git merge --abort")
})

describe("rm aimed at the root, the home, the working directory or the repository", () => {
  blocked("rm-home-then-more", "rm -rf ~ /tmp")
  blocked("rm-root-no-preserve", "rm -rf / --no-preserve-root")
  blocked("rm-pwd", 'rm -rf "$PWD"')
  blocked("rm-pwd-braced", "rm -rf ${PWD}")
  blocked("rm-pwd-substitution", "rm -rf $(pwd)")
  blocked("rm-pwd-backtick", "rm -rf `pwd`")
  blocked("rm-toplevel", 'rm -rf "$(git rev-parse --show-toplevel)"')
  blocked("rm-parent-of-parent", "rm -rf ../..")
  blocked("rm-dot-git", "rm -rf .git")
  blocked("rm-dot-slash-dot-git", "rm -rf ./.git/")
  blocked("rm-tab-home", "rm\t-rf ~")
  blocked("rm-home-in-backticks", "echo `rm -rf ~`")
  allowed("rm-sibling", "rm -rf ../sibling")
  allowed("rm-dot-github", "rm -rf .github")
  allowed("rm-pwd-subdir", 'rm -rf "$PWD/dist"')
  allowed("rm-git-hook", "rm -f .git/hooks/pre-commit")
  blocked("rm-pwd-dot-git", "rm -rf $PWD/.git")
  blocked("rm-pwd-substitution-dot-git", "rm -rf $(pwd)/.git")
  blocked("rm-pwd-parent", 'rm -rf "$(pwd)"/..')
  blocked("rm-pwd-parent-slash", "rm -rf $PWD/../")
  blocked("rm-parent-dot-git", "rm -rf ../.git")
  blocked("rm-dot-git-contents", "rm -rf .git/*")
  blocked("rm-dot-git-objects", "rm -rf .git/objects")
  blocked("rm-absolute-dot-git", "rm -rf /Users/someone/repo/.git")
  blocked("rm-parent-after-cd", "cd dist && rm -rf ..")
  blocked("rm-star-after-cd-outside", "cd .. && rm -rf *")
  allowed("rm-star-after-cd-into-a-subdirectory", "cd sub && rm -rf *")
  allowed("rm-dot-slash-star-in-a-subshell-after-cd", "(cd sub && rm -rf ./*)")
  allowed("message-line-rm-root", 'git commit -m "fix: x\n\nrm -rf / was the bug"')
  allowed("message-line-shred", 'git commit -m "fix: x\n\nshred was the bug"')
})

// The payloads of #318 for an rm target, a whole-tree pathspec and a push target, named as #318 names
// them, run from a feature branch beside a checkout on main. Each allowed case is ordinary work in
// the same spelling, which the guard must not refuse.
describe("the rm, whole-tree and push spellings of #318", () => {
  blocked("rm-var-dot-git", 'rm -rf "$dir"/.git')
  blocked("rm-bvar-dot-git", 'rm -rf "${dir}"/.git')
  blocked("rm-home-dot-git", 'rm -rf "$HOME"/repo/.git')
  blocked("rm-home-guard-exp", 'rm -rf "${HOME:?}"')
  blocked("rm-home-guard-exp-glob", 'rm -rf "${HOME:?}"/*')
  blocked("rm-pwd-guard-exp", 'rm -rf "${PWD:?}"')
  blocked("rm-dot-git-objects-glob", "rm -rf .git/objects/*")
  blocked("rm-dot-git-refs-glob", "rm -rf .git/refs/*")
  blocked("rm-home-guard-exp-message", 'rm -rf "${HOME:?not set}"')
  blocked("rm-pwd-guard-exp-dot-git", 'rm -rf "${PWD:?}"/.git')
  allowed("rm-var-subdir", 'rm -rf "$dir"/build')
  allowed("rm-var-dot-github", 'rm -rf "$dir"/.github')
  allowed("rm-home-guard-exp-subdir", 'rm -rf "${HOME:?}"/old-dir')
  allowed("rm-pwd-guard-exp-subdir", 'rm -rf "${PWD:?}/dist"')
  allowed("rm-git-hooks-glob", "rm -f .git/hooks/*")

  blocked("tree-restore-dotstar", "git restore ./*")
  blocked("tree-checkout-dotstar", "git checkout -- ./*")
  blocked("tree-restore-top-star", "git restore ':(top)*'")
  blocked("tree-restore-root-star", "git restore ':/*'")
  blocked("tree-restore-dstar", "git restore '**'")
  blocked("tree-restore-glob-dstar", "git restore ':(glob)**'")
  blocked("tree-top-ctl", "git checkout -- ':(top)'")
  blocked("tree-restore-top-glob-dstar", "git restore ':(top,glob)**'")
  allowed("tree-restore-glob-star", "git restore ':(glob)*'")
  blocked("tree-restore-glob-dstar-star", "git restore ':(glob)**/*'")
  allowed("tree-restore-dstar-star", "git restore '**/*'")
  allowed("tree-restore-staged-dotstar", "git restore --staged ./*")
  allowed("tree-restore-subdir-glob", "git restore 'src/*'")
  allowed("tree-restore-top-subdir", "git restore ':(top)src'")
  allowed("tree-restore-glob-subdir", "git restore ':(glob)src/**'")
  allowed("tree-restore-exclude", "git restore ':(exclude)*'")
  allowed("tree-restore-literal-star", "git restore ':(literal)*'")
  allowed("tree-restore-attr-star", "git restore ':(attr:generated)*'")
  blocked("tree-restore-icase-star", "git restore ':(icase)*'")
  allowed("tree-checkout-dotslash-subdir", "git checkout -- ./src")

  blocked("push-amp-redirect-mid", "git push 2>&1 origin main")
  blocked("push-pushd", "pushd ../on-main && git push")
  blocked("push-cd-dd", "cd -- ../on-main && git push")
  blocked("push-amp-redirect-end", "git push origin main 2>&1")
  blocked("push-amp-redirect-all", "git push &>/dev/null origin main")
  blocked("push-pushd-then-popd", "pushd ../on-main-topic && popd && git push", ON_MAIN)
  blocked("push-popd-back-to-main", "cd ../on-main && pushd ../feat && popd && git push")
  blocked("push-pushd-n-then-popd", "pushd -n ../on-main && popd && git push")
  blocked("push-pushd-swap-back-to-main", "cd ../on-main && pushd ../feat && pushd && git push")
  allowed("push-popd-back-to-the-feature-branch", "pushd ../on-main && popd && git push")
  allowed("push-amp-redirect-mid-feature", "git push 2>&1 origin feat")
  allowed("push-pushd-into-a-feature-worktree", "pushd ../on-main-topic && git push", ON_MAIN)
  allowed("push-cd-dd-into-a-feature-worktree", "cd -- ../on-main-topic && git push", ON_MAIN)
  allowed("push-pushd-n-stays", "pushd -n ../on-main && git push")
})

// A heredoc body is dropped by the dispatcher, so these go through it.
function dispatched(want: string, name: string, command: string): void {
  it(name, () => {
    assert.equal(verdictOf(runHook("bash-guard", bashPayload(command, FEAT))), want)
  })
}
describe("a heredoc or here-string a shell reads is a script", () => {
  dispatched("deny", "bash-heredoc-reset", "bash <<'EOF'\ngit reset --hard\nEOF")
  dispatched("deny", "cat-heredoc-into-bash-rm", "cat <<'EOF' | bash\nrm -rf ~\nEOF")
  dispatched("deny", "bash-s-heredoc-branch-D", "bash -s <<EOF\ngit branch -D x\nEOF")
  dispatched("deny", "bash-indented-heredoc-push-force", "bash <<'EOF'\n  cd sub\n  git push --force\nEOF")
  dispatched("deny", "bash-here-string-reset", 'bash <<<"git reset --hard"')
  dispatched("deny", "bash-here-string-chained", "bash <<<'cd sub; git clean -fd'")
  dispatched("deny", "bash-here-string-assignment", "bash <<<'X=1 git reset --hard'")
  dispatched("deny", "bash-euo-pipefail-heredoc-reset", "bash -euo pipefail <<'EOF'\ngit reset --hard\nEOF")
  dispatched("pass", "heredoc-into-a-file", "cat > x.sh <<'EOF'\ngit reset --hard\nEOF")
  dispatched("pass", "heredoc-to-a-script-operand", "bash x.sh <<'EOF'\ngit reset --hard\nEOF")
  dispatched("pass", "heredoc-written-then-run", "cat > x.sh <<'EOF' && bash x.sh\ngit reset --hard\nEOF")
})

describe("push --prune and a wildcard refspec reach more than they name", () => {
  blocked("push-prune-wildcard", "git push origin --prune 'refs/heads/*:refs/heads/*'")
  blocked("push-prune-all", "git push --all --prune origin")
  blocked("push-wildcard-to-a-local-master", "git push origin 'refs/heads/*:refs/heads/*'", BRANCHES)
  blocked("push-delete-in-a-cluster", "git push -ud origin x")
  allowed("push-prune-one-branch", "git push --prune origin feat")
  allowed("push-wildcard-features-only", "git push origin 'refs/heads/*:refs/heads/*'", FEATURES_ONLY)
})

describe("gh: what deletes on the remote", () => {
  blocked("gh-api-delete-ref", "gh api -X DELETE repos/o/r/git/refs/heads/x")
  blocked("gh-api-delete-ref-method-after", "gh api repos/o/r/git/refs/heads/x --method DELETE")
  blocked("gh-api-delete-ref-glued", "gh api -XDELETE /repos/o/r/git/refs/heads/x")
  blocked("gh-api-delete-ref-url", "gh api --method=delete https://api.github.com/repos/o/r/git/refs/heads/x")
  blocked("gh-api-delete-repo", "gh api -X DELETE repos/o/r")
  blocked("gh-api-force-ref", "gh api -X PATCH repos/o/r/git/refs/heads/main -F force=true")
  blocked(
    "gh-api-graphql-delete-ref",
    "gh api graphql -f query='mutation { deleteRef(input: {refId: \"x\"}) { clientMutationId } }'"
  )
  blocked("gh-repo-delete", "gh repo delete o/r --yes")
  blocked("gh-pr-merge-delete-branch", "gh pr merge 1 --squash --delete-branch")
  blocked("gh-pr-merge-d", "gh pr merge 1 -s -d")
  blocked("gh-pr-close-d", "gh pr close 1 -d")
  blocked("rtk-gh-repo-delete", "rtk gh repo delete o/r")
  blocked(
    "gh-api-graphql-delete-repository",
    "gh api graphql -f query='mutation { deleteRepository(input: {repositoryId: \"x\"}) { clientMutationId } }'"
  )
  allowed(
    "gh-api-graphql-comment-naming-delete-ref",
    "gh api graphql -f query='mutation { addComment(input: {body: \"deleteRef is not run\"}) { clientMutationId } }'"
  )
  allowed("gh-api-get", "gh api repos/o/r/pulls/1/comments")
  allowed("gh-api-delete-comment", "gh api -X DELETE repos/o/r/issues/comments/1")
  allowed("gh-api-patch-ref", "gh api -X PATCH repos/o/r/git/refs/heads/x -F sha=abc")
  allowed("gh-pr-merge-squash", "gh pr merge 1 --squash")
  allowed("gh-pr-merge-body-value", "gh pr merge 1 --squash --body -d")
  allowed("gh-pr-merge-keep-branch", "gh pr merge 1 --squash --delete-branch=false")
  allowed("rtk-gh-pr-view", "rtk gh pr view 1")
})

describe("a commit on a protected branch, where the repository takes none (commitOnProtected: deny)", () => {
  blocked("commit-on-main", 'git commit -m "fix: x"', DENY_ON_MAIN)
  blocked("commit-amend-on-main", "git commit --amend --no-edit", DENY_ON_MAIN)
  blocked("commit-through-dash-C", `git -C ${DENY_ON_MAIN} commit -m "fix: x"`)
  blocked("commit-after-cd", `cd ${DENY_ON_MAIN} && git commit -m "fix: x"`)
  blocked("commit-after-a-switch-to-main", 'git switch main && git commit -m "fix: x"', DENY_ON_FEAT)
  blocked("commit-under-the-strictest-set", 'git commit -m "fix: x"', BROKEN_ON_MAIN)
  blocked("commit-behind-xargs", "echo | xargs git commit -m x", DENY_ON_MAIN)
  allowed("commit-on-a-feature-branch", 'git commit -m "fix: x"', DENY_ON_FEAT)
  blocked("merge-on-main", "git merge feat", DENY_ON_MAIN)
  blocked("cherry-pick-on-main", "git cherry-pick abc", DENY_ON_MAIN)
  blocked("revert-on-main", "git revert HEAD", DENY_ON_MAIN)
  allowed("merge-abort-on-main", "git merge --abort", DENY_ON_MAIN)
  allowed("merge-fast-forward-on-main", "git merge --ff-only origin/main", DENY_ON_MAIN)
  allowed("merge-on-a-feature-branch", "git merge main", DENY_ON_FEAT)
  allowed("push-after-switch-create", "git switch -c fix && git push -u origin HEAD", DENY_ON_MAIN)
  allowed("push-after-checkout-b", "git checkout -b fix && git push -u origin fix", DENY_ON_MAIN)
  allowed("plain-push-after-switch-create", "git switch -c fix && git push", DENY_ON_MAIN)
  blocked("push-after-switch-to-main", "git switch main && git push", DENY_ON_FEAT)
  allowed("commit-after-switch-create", 'git switch -c fix && git commit -m "fix: x"', DENY_ON_MAIN)
  allowed("commit-after-checkout-b", 'git checkout -b fix && git commit -m "fix: x"', DENY_ON_MAIN)
  allowed("commit-after-detach", 'git switch --detach && git commit -m "fix: x"', DENY_ON_MAIN)
  allowed("commit-after-a-checkout-of-a-path", 'git checkout main -- a.txt && git commit -m "fix: x"', DENY_ON_FEAT)
  allowed(
    "commit-after-a-checkout-of-a-path-no-dashes",
    'git checkout main a.txt && git commit -m "fix: x"',
    DENY_ON_FEAT
  )
  allowed("commit-dry-run", 'git commit --dry-run -m "fix: x"', DENY_ON_MAIN)
  allowed("commit-message-naming-dry-run", "git commit -m --dry-run", DENY_ON_FEAT)
  allowed("commit-on-main-by-default", 'git commit -m "fix: x"', ON_MAIN)
})

describe("a quoted separator is text — and cuts both ways", () => {
  allowed("prose-with-pipe", 'git commit -m "docs: never | git push --force"')
  allowed("prose-with-semi", 'git commit -m "docs: never ; git reset --hard"')
  allowed("grep-for-a-restore", 'grep -rn "; git restore ." .')
  allowed("echo-with-pipe", 'echo "a | git clean -fd"')
  blocked("quoted-arg-then-force", 'git push origin "feat|x" --force')
  blocked("quoted-arg-then-hard", 'git reset "ref|x" --hard', DIRTY)
  blocked("quoted-then-real", 'echo "a | b"; git push --force')
  blocked("unterminated-closes", "echo don't; git push --force")
})

describe("a substitution inside double quotes runs", () => {
  blocked("dq-backtick-reset", 'x="`git reset --hard`"', DIRTY)
  blocked("dq-dollar-paren-reset", 'x="$(git reset --hard)"', DIRTY)
  blocked("dq-dollar-paren-push-force", 'echo "pushed: $(git push --force)"')
  blocked("dq-dollar-paren-chained-clean", 'echo "a $(cd sub && git clean -fd)"')
  allowed("sq-dollar-paren-is-text", "git commit -m 'docs: never $(git reset --hard)'")
  allowed("dq-escaped-backtick-is-text", 'echo "\\`git reset --hard\\`"')
  allowed("dq-dollar-paren-safe", 'echo "on $(git rev-parse --abbrev-ref HEAD)"')
  // A heredoc a shell reads is a script, and an unquoted one still runs its substitutions.
  blocked("heredoc-to-bash", "bash <<'EOF'\ncd sub && git reset --hard\nEOF", DIRTY)
  blocked("heredoc-to-sh-s", "sh -s <<'EOF'\ntrue && git clean -fd\nEOF")
  blocked("heredoc-piped-to-bash", "cat <<'EOF' | bash\nls | true; git push --force\nEOF")
  blocked("unquoted-heredoc-substitution", "cat > f.sh <<EOF\n$(git reset --hard)\nEOF", DIRTY)
  allowed("unquoted-heredoc-prose", "cat > notes.md <<EOF\nrun it; git reset --hard is refused\nEOF")
  // The commit form every session uses: the heredoc body is the message, apostrophes and all.
  allowed(
    "dq-cat-heredoc-commit",
    "git commit -m \"$(cat <<'EOF'\nfix: x\n\ndon't; git reset --hard is refused | `git clean -fd` too\nEOF\n)\""
  )
})

describe("allowed", () => {
  allowed("plain-push", "git push")
  allowed("push-u", "git push -u origin feat")
  allowed("prose-in-quotes", 'git commit -m "docs: never git push --force"')
  allowed("prose-lease", 'git commit -m "docs: use --force-with-lease"')
  allowed("assign-plain-push", "A=1 git push")
  allowed("assign-status", "FOO=bar git status --short")
  allowed("assign-pnpm", "NODE_ENV=test pnpm test")
  allowed("clean-dry-run", "git clean -n")
  allowed("clean-dry-run-long", "git clean --dry-run")
  allowed("branch-d-merged", "git branch -d merged")
  allowed("restore-staged", "git restore --staged .")
  allowed("restore-dotfile-dir", "git restore .ai/work/x/CHANGE.md")
  allowed("restore-dotfile-rel", "git restore .claude/settings.json")
  allowed("checkout-dotfile", "git checkout .claude/settings.json")
  allowed("restore-dotted-file", "git restore .gitignore")
  allowed("restore-C-dotfile", "git -C sub restore .ai/work/x")
  allowed("dash-C-status", "git -C sub status --short")
  allowed("dash-C-clean-dry", "git -C sub clean -n")
  allowed("dash-C-branch-d", "git -C sub branch -d merged")
  allowed("dash-C-reset-soft", "git -C sub reset --soft HEAD~1")
  allowed("dash-C-stash-list", "git -C sub stash list")
  allowed("dash-C-rev-parse", "git -C .claude/worktrees/other rev-parse HEAD")
  allowed("dash-C-prose-reset", "git -C sub commit -m 'docs: never reset --hard'")
  allowed("dash-C-prose-push", 'git -C sub commit -m "docs: never push --force"')
  allowed("dash-C-prose-branch", "git -C sub commit -m 'docs: branch -D is rude'")
  allowed("prose-stash-drop", 'git commit -m "docs: never git stash drop"')
  allowed("prose-worktree-remove-force", 'git commit -m "docs: never git worktree remove --force"')
  allowed("restore-quoted-path", 'git restore "./src/app.ts"')
  allowed("checkout-branch", "git checkout main")
  allowed("checkout-feature", "git checkout feature/x")
  allowed("rm-node-modules", "rm -rf node_modules")
  allowed("rm-relative-dir", "rm -rf ./dist")
  allowed("rm-home-subdir", "rm -rf ~/old-dir")
  allowed("find-no-delete", "find . -name '*.pyc'")
  // A bare `:` is the matching refspec: it pushes every branch both sides have and deletes nothing.
  allowed("push-matching-refspec", "git push origin :", FEATURES_ONLY)
  allowed("rtk-status", "rtk git status")
  allowed("rtk-plain-push", "rtk git push")
  allowed("rtk-gain", "rtk gain")
  allowed("rtk-run-tests", "rtk run pnpm test")
  allowed("rtk-summary-status", "rtk summary git status")
  allowed("empty-input", "")
})

describe("the prefilter before the rm, find and shred patterns", () => {
  it("names the word each pattern starts with, so it skips no command a pattern would match", () => {
    const source = readFileSync(hookPath("block-dangerous-commands"), "utf8")
    const arm = source.match(/case "\$SCAN" in\n\s+(.+)\)\n/)?.[1] ?? ""
    const words = arm.split(" | ").map((word) => word.replaceAll("*", ""))
    const rm = source.match(/^RM="([a-z]+)\(/m)?.[1]
    const patterns = (source.match(/^PATTERNS=\(\n([\s\S]*?)^\)/m)?.[1] ?? "").trim().split("\n")
    assert.ok(patterns.length > 1)
    for (const line of patterns.map((text) => text.trim())) {
      const first = line.startsWith('"${RM}') ? rm : line.match(/^"([a-z]+)/)?.[1]
      assert.ok(first !== undefined && words.includes(first), line)
    }
  })
})
