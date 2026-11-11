// The cut points every guard shares, each payload of F01, F13 and F24 in #318 sent to the guard it
// names: a substitution is one word of its command, a shell by path or behind a backslash runs its
// `-c` quote, a heredoc delimiter is a whole shell word. The passes hold the same spellings to ordinary work.

import { join } from "node:path"
import { describe, it } from "node:test"

import { bashPayload, commit, expectExit, git, initRepo, runHook, scratch, write, writeJson } from "../harness.ts"

const TMP = scratch("whole")
const FEAT = initRepo(join(TMP, "feat"), { branch: "feat" })
write(join(FEAT, "pnpm-lock.yaml"), "")
write(join(FEAT, ".gitignore"), "*.local\n")
write(join(FEAT, ".env.local"), "SECRET=1\n")
initRepo(join(FEAT, "sub"), { branch: "main" })
initRepo(join(FEAT, "app"), { branch: "main" })
const COMMIT_DENY = initRepo(join(TMP, "commit-deny"), { branch: "main" })
write(join(COMMIT_DENY, "a.txt"), "a\n")
git(COMMIT_DENY, "add", "a.txt")
commit(COMMIT_DENY, "-m", "init")
writeJson(join(COMMIT_DENY, ".ai", "agentic.config.json"), { guardrails: { commitOnProtected: "deny" } })

type Guard =
  | "block-dangerous-commands"
  | "block-env-access"
  | "credential-leak-guard"
  | "block-non-pnpm"
  | "block-store-writes"

// The guard alone and behind the dispatcher, which hands it the command with its heredoc bodies off.
function refused(guard: Guard, name: string, command: string, cwd = FEAT): void {
  it(`${guard} refuses ${name}`, () => {
    expectExit(runHook(guard, bashPayload(command, cwd)), 2)
    expectExit(runHook("bash-guard", bashPayload(command, cwd)), 2)
  })
}
function passed(guard: Guard, name: string, command: string, cwd = FEAT): void {
  it(`${guard} passes ${name}`, () => {
    expectExit(runHook(guard, bashPayload(command, cwd)), 0)
    expectExit(runHook("bash-guard", bashPayload(command, cwd)), 0)
  })
}
// A heredoc body is dropped by the dispatcher alone: the guard on its own reads each line as typed.
function dispatchedPass(name: string, command: string): void {
  it(`bash-guard passes ${name}`, () => {
    expectExit(runHook("bash-guard", bashPayload(command, FEAT)), 0)
  })
}

describe("F01: a substitution is one word, and the words after it belong to the same command", () => {
  const dangerous: [string, string, string?][] = [
    ["subst-push-force-dq", 'git push origin "$(git branch --show-current)" --force'],
    ["subst-push-f-unq", "git push origin $(git rev-parse --abbrev-ref HEAD) -f"],
    ["subst-push-force-bt", "git push origin `git branch --show-current` --force"],
    ["subst-push-delete", 'git push "$(git remote)" --delete old'],
    ["subst-push-main", 'git push "$(git remote)" HEAD:main'],
    ["subst-reset-hard-after", 'git reset "$(git merge-base origin/main HEAD)" --hard'],
    ["subst-dashC-reset", 'git -C "$(git rev-parse --show-toplevel)" reset --hard'],
    ["subst-dashC-push-force", 'git -C "$(pwd)" push --force'],
    ["subst-dashC-clean-unq", "git -C $(pwd) clean -fd"],
    ["subst-dashC-bt", "git -C `pwd` reset --hard"],
    ["subst-restore-source", 'git restore --source="$(git merge-base main HEAD)" .'],
    ["subst-checkout-dot", 'git checkout "$(git merge-base main HEAD)" -- .'],
    ["subst-worktree-force", 'git worktree remove "$(git rev-parse --show-toplevel)/../wt" --force'],
    ["subst-gitdir-assign", 'GIT_DIR="$(pwd)/.git" git reset --hard'],
    ["subst-gh-merge-d", 'gh pr merge "$(gh pr view --json number -q .number)" --squash --delete-branch'],
    [
      "subst-gh-api-delete",
      'gh api -X DELETE "repos/$(gh repo view --json nameWithOwner -q .nameWithOwner)/git/refs/heads/x"'
    ],
    ["subst-branch-D-after", 'git branch "$(echo x)" -D'],
    ["subst-commit-deny-dashC", 'git -C "$(pwd)" commit -m "fix: x"', COMMIT_DENY]
  ]
  for (const [name, command, cwd] of dangerous) {
    refused("block-dangerous-commands", name, command, cwd)
  }
  refused("block-store-writes", "store-subst-confirm", 'pnpm store:listing "$(echo x)" --confirm')
  refused("block-store-writes", "store-subst-confirm-node", 'node scripts/store-listing.ts --dir "$(pwd)/x" --confirm')
  refused("block-store-writes", "store-subst-asc-confirm", 'asc metadata pull --dir "$(pwd)/x" --confirm')

  refused("block-dangerous-commands", "a substitution's own command", 'echo "$(git reset --hard)" done')
  refused("block-dangerous-commands", "a nested substitution's command", 'echo "$(echo $(git clean -fd) x)" y')
  refused(
    "block-dangerous-commands",
    "a lease push where a cd before it moved",
    'cd sub && git -C "$(pwd)" push --force-with-lease'
  )
  passed("block-dangerous-commands", "a lease push where the shell stands", 'git -C "$(pwd)" push --force-with-lease')
  passed("block-dangerous-commands", "a push of the current branch", 'git push origin "$(git branch --show-current)"')
  passed(
    "block-dangerous-commands",
    "a lease push of the current branch",
    "git push --force-with-lease origin `git branch --show-current`"
  )
  passed("block-dangerous-commands", "a status of the top level", 'git -C "$(git rev-parse --show-toplevel)" status')
  passed("block-dangerous-commands", "a cd inside a substitution ends with it", 'echo "$(cd sub && pwd)"; git status')
  passed("block-store-writes", "a store read with a substitution", 'asc metadata pull --dir "$(pwd)/x"')

  // Bash drops an empty expansion and runs the next word, so a substitution leading a command hides none.
  refused("block-dangerous-commands", "a substitution before the command", "$(echo) git reset --hard")
  refused("block-dangerous-commands", "a backtick before the command", "`true` git reset --hard")
  refused("block-dangerous-commands", "a substitution before the command after a cd", "cd sub; $(true) git clean -fd")
  refused("block-store-writes", "a substitution before asc", "$(echo) asc metadata apply --dir x")
  // A `case` pattern's `)` ends no substitution.
  refused("block-dangerous-commands", "a case inside a substitution", "echo $(case x in x) git reset --hard;; esac)")
  passed(
    "block-dangerous-commands",
    "a harmless case inside a substitution",
    'echo "$(case x in x) echo y;; esac)" && git status'
  )
})

describe("F13: a shell named by a path or behind a backslash runs its -c quote", () => {
  refused("block-dangerous-commands", "bin-bash-chain", "/bin/bash -c 'cd sub && git reset --hard'")
  refused("block-dangerous-commands", "bin-sh-chain", '/bin/sh -c "cd sub; git clean -fd"')
  refused("block-dangerous-commands", "bin-bash-chain-rm", "/bin/bash -c 'cd /tmp && rm -rf ~'")
  refused("block-dangerous-commands", "backslash-bash-chain", "\\bash -c 'cd sub && git reset --hard'")
  refused("block-env-access", "env-bin-bash", "/bin/bash -c 'cat .env.local'")
  refused("block-env-access", "env-bs-bash", "\\bash -c 'cat .env.local'")
  refused("credential-leak-guard", "cred-bin-bash", "/bin/bash -c 'cat ~/.ssh/id_rsa'")
  refused("credential-leak-guard", "cred-bs-bash", "\\bash -c 'cat ~/.ssh/id_rsa'")
  refused("block-non-pnpm", "pnpm-bin-bash-chain", "/bin/bash -c 'cd app && npm install'")
  refused("block-store-writes", "store-bin-bash-chain", "/bin/bash -c 'cd x && asc metadata apply --dir y'")

  refused(
    "block-dangerous-commands",
    "a shell by a path under /usr",
    "/usr/local/bin/zsh -c 'git status && git reset --hard'"
  )
  passed("block-dangerous-commands", "a harmless chain", "/bin/bash -c 'cd sub && git status'")
  passed("block-dangerous-commands", "a quote a script by path gets", "./bin/bashful -c 'git reset --hard'")
})

describe("F24: a heredoc's delimiter is a whole shell word, closed where bash closes it", () => {
  refused("block-dangerous-commands", "hd-split-delim", 'cat <<E"O"F\nbody\nEOF\ngit reset --hard\nE')
  refused("block-dangerous-commands", "hd-dot-delim", "cat <<E.O\nbody\nE.O\ngit reset --hard")
  refused("block-dangerous-commands", "hd-hyphen-delim-q", "cat <<'END-OF-TEXT'\nbody\nEND-OF-TEXT\ngit reset --hard")
  refused("block-dangerous-commands", "hd-space-delim-q", 'cat <<"END OF"\nbody\nEND OF\ngit reset --hard')

  dispatchedPass("a body under a hyphenated delimiter", "cat <<'END-OF-TEXT'\ngit reset --hard\nEND-OF-TEXT")
  dispatchedPass("a body under a split delimiter", 'cat <<E"O"F > x.txt\ngit reset --hard\nEOF\ngit status')
  dispatchedPass("a body under a dotted delimiter", "cat <<E.O\ngit clean -fd\nE.O")
  refused(
    "block-dangerous-commands",
    "a shell reading a body under a quoted delimiter",
    "bash <<'END-OF-TEXT'\ngit reset --hard\nEND-OF-TEXT"
  )
  passed("block-dangerous-commands", "a left shift in arithmetic", "echo $((1<<2)) && git status")
})
