// Behaviour of lib.sh: the payload reader, the text helpers every guard shares, and the config
// lookup. Every case sources the library in a fresh bash and prints what the shell test compared. The
// config cases mirror test/scripts/agentic-config.test.ts, which is the reference; that file also runs
// this library and compares.

import assert from "node:assert/strict"
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"

import { commit, git, hookPath, initRepo, runBash, scratch, write, writeJson } from "../harness.ts"

const TMP = scratch("lib")
const LIB = hookPath("lib")
const ORG = "git@github.com:acme/app.git"
const COMMITTED = ".ai/agentic.config.json"
const LOCAL = ".ai/agentic.config.local.json"

/** Runs `script` after sourcing lib.sh, `args` from $2 on; stdout with trailing newlines dropped, as `$(…)` drops them. */
function lib(script: string, args: string[] = []): string {
  return runBash(["-c", `source "$1"\n${script}`, "lib", LIB, ...args], "").stdout.replace(/\n+$/, "")
}

describe("guard_read_payload", () => {
  it("json payload, multi-line command kept", () => {
    const file = join(TMP, "p.json")
    writeJson(file, {
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      cwd: "/tmp/x",
      tool_input: { command: "git status\nls" }
    })
    const got = lib(
      `guard_read_payload < "$2" && printf '%s|%s|%s|%s' "$GUARD_EVENT" "$GUARD_TOOL" "$GUARD_CWD" "$GUARD_COMMAND"`,
      [file]
    )
    assert.equal(got, "PreToolUse|Bash|/tmp/x|git status\nls")
  })
  it("file tool payload", () => {
    const file = join(TMP, "f.json")
    writeJson(file, { tool_name: "Read", tool_input: { file_path: "config/database.yml" } })
    const got = lib(
      `guard_read_payload < "$2" && printf '%s|%s|%s' "$GUARD_TOOL" "$GUARD_FILE_PATH" "$GUARD_COMMAND"`,
      [file]
    )
    assert.equal(got, "Read|config/database.yml|")
  })
  it("grep payload carries the path and the glob", () => {
    const file = join(TMP, "g.json")
    writeJson(file, { tool_name: "Grep", tool_input: { pattern: "SECRET", path: "src", glob: ".env*" } })
    const got = lib(`guard_read_payload < "$2" && printf '%s|%s|%s' "$GUARD_TOOL" "$GUARD_FILE_PATH" "$GUARD_GLOB"`, [
      file
    ])
    assert.equal(got, "Grep|src|.env*")
  })
  it("a payload without a glob leaves it empty", () => {
    const file = join(TMP, "f.json")
    assert.equal(lib(`guard_read_payload < "$2" && printf '[%s]' "$GUARD_GLOB"`, [file]), "[]")
  })
  it("fast path takes the command and cwd", () => {
    const got = lib(
      `guard_read_payload --bash-command /tmp/y <<<'git status' && printf '%s|%s|%s' "$GUARD_TOOL" "$GUARD_CWD" "$GUARD_COMMAND"`
    )
    assert.equal(got, "Bash|/tmp/y|git status")
  })
  it("empty stdin returns 1", () => {
    assert.equal(lib(`if printf '' | guard_read_payload; then echo 0; else echo 1; fi`), "1")
  })
  it("malformed json returns 1", () => {
    assert.equal(lib(`if printf 'not json' | guard_read_payload; then echo 0; else echo 1; fi`), "1")
  })
})

describe("text helpers", () => {
  it("heredoc body dropped, opener kept with << collapsed", () => {
    assert.equal(
      lib(`printf 'cat > x <<EOF\\nsecret body\\nEOF\\necho done\\n' | guard_strip_heredocs`),
      "cat > x <EOF\necho done"
    )
  })
  it("here-string is not an opener", () => {
    assert.equal(lib(`printf 'grep x <<< "a\\nb"\\n' | guard_strip_heredocs`), 'grep x <<< "a\nb"')
  })
  it("a << inside double quotes is not an opener", () => {
    assert.equal(
      lib(`printf 'echo "a << EOF"\\ngit reset --hard\\n' | guard_strip_heredocs`),
      'echo "a << EOF"\ngit reset --hard'
    )
  })
  it("a << inside single quotes is not an opener", () => {
    assert.equal(
      lib(`printf "echo 'a << EOF'\\\\ngit reset --hard\\\\n" | guard_strip_heredocs`),
      "echo 'a << EOF'\ngit reset --hard"
    )
  })
  it("a << behind a comment is not an opener", () => {
    assert.equal(lib(`printf '# note << EOF\\nrm -rf /\\n' | guard_strip_heredocs`), "# note << EOF\nrm -rf /")
  })
  it("a quote carried over from the line before still quotes", () => {
    assert.equal(
      lib(`printf 'git commit -m "subject\\n\\nbody << EOF"\\ngit reset --hard\\n' | guard_strip_heredocs`),
      'git commit -m "subject\n\nbody << EOF"\ngit reset --hard'
    )
  })
  it("an opener inside a substitution in double quotes still opens", () => {
    assert.equal(
      lib(
        `printf 'git commit -m "$(cat <<'"'"'EOF'"'"'\\nnot a subject\\nEOF\\n)"\\necho done\\n' | guard_strip_heredocs`
      ),
      "git commit -m \"$(cat <'EOF'\n)\"\necho done"
    )
  })
  it("a real opener with no terminator drops the rest", () => {
    assert.equal(lib(`printf 'cat <<EOF\\ngit reset --hard\\n' | guard_strip_heredocs`), "cat <EOF")
  })
  it("a continuation line joins the one before it", () => {
    assert.equal(
      lib(`printf 'git push \\\\\\n  --force\\necho done\\n' | guard_join_continuations`),
      "git push   --force\necho done"
    )
  })
  it("an escaped backslash continues nothing", () => {
    assert.equal(lib(`printf 'echo a\\\\\\\\\\ngit status\\n' | guard_join_continuations`), "echo a\\\\\ngit status")
  })
  it("separators inside quotes masked", () => {
    assert.equal(
      lib(`guard_mask_quoted_separators 'git commit -m "a; b | c" && x'`),
      'git commit -m "a\u0002 b \u0002 c" && x'
    )
  })
  it("separators outside quotes kept", () => {
    assert.equal(lib(`guard_mask_quoted_separators "echo 'it''s' ; y"`), "echo 'it''s' ; y")
  })
  it("unterminated quote hands back the original", () => {
    assert.equal(lib(`guard_mask_quoted_separators 'echo "open ; x'`), 'echo "open ; x')
  })
  it("plain words: quotes gone, quoted prose dropped, a quoted word kept", () => {
    assert.equal(
      lib(`guard_plain_words 'cat ".env.local" -m "a b" '"'"'db:drop'"'"' x'`),
      "cat .env.local -m db:drop x"
    )
  })
  it("plain words: an unterminated quote hands back the text", () => {
    assert.equal(lib(`guard_plain_words 'echo "open x'`), 'echo "open x')
  })
  it("quoted spans stripped, tokens split", () => {
    assert.equal(
      lib(`guard_tokens "$(guard_strip_quoted 'cp x "quoted thing" y; cat z')" | paste -sd, -`),
      "cp,x,y,cat,z"
    )
  })
  function boundaryMatches(command: string): string {
    return lib(
      `if printf '%s\\n' '${command}' | grep -qE "\${GUARD_BOUNDARY}git push"; then echo yes; else echo no; fi`
    )
  }
  it("boundary sees through wrappers", () => {
    assert.equal(boundaryMatches('RTK_DISABLED=1 sudo rtk run "git push"'), "yes")
  })
  it("boundary needs a command start", () => {
    assert.equal(boundaryMatches("echo git push"), "no")
  })
  it("boundary after a separator", () => {
    assert.equal(boundaryMatches("ls; git push"), "yes")
  })
  it("words honour quotes and escapes", () => {
    const got = lib(`guard_words "git -C 'my repo' push  --force-with-lease=\\"a b\\":x it\\\\'s" | paste -sd, -`)
    assert.equal(got, "git,-C,my repo,push,--force-with-lease=a b:x,it's")
  })
  function unwrap(words: string): string {
    return lib(`WORDS=(${words}); guard_unwrap_words; printf '%s' "\${WORDS[*]}"`)
  }
  it("unwrap drops assignment, sudo, rtk and its subcommand", () => {
    assert.equal(unwrap("RTK_DISABLED=1 sudo rtk run git push --force"), "git push --force")
  })
  it("unwrap drops command, env and env's options", () => {
    assert.equal(unwrap("env -i -u HOME FOO=1 command git push --force"), "git push --force")
  })
  it("a subshell's parentheses split segments, a quoted one does not", () => {
    assert.equal(
      lib(`guard_segments "$(guard_mask_quoted_separators 'echo $(git push -f) "(x)"')" | paste -sd, -`),
      'echo $,git push -f, "\u0002x\u0002"'
    )
  })
  it("unwrap keeps git after rtk", () => {
    assert.equal(unwrap("rtk git -C sub push -f"), "git -C sub push -f")
  })
  it("unwrap leaves a bare rtk subcommand", () => {
    assert.equal(unwrap("rtk gain"), "gain")
  })
  it("unwrap leaves an unwrapped command alone", () => {
    assert.equal(unwrap("pnpm test"), "pnpm test")
  })
})

describe("git helpers", () => {
  const PUSH = "rtk git -C sub push --force-with-lease=a:sha -o x origin feat:main +topic"
  // The callers hand guard_segments the masked scan, so a separator inside quotes is already \002 and
  // stays inside its segment. (The shell test fed it the raw text and compared two constants.)
  it("segments split on real separators only", () => {
    const script = `guard_segments "$(guard_mask_quoted_separators 'a && b | c; "x;y" d')" | paste -sd, -`
    assert.equal(lib(script), 'a , b , c, "x\u0002y" d')
  })
  it("parse_push sees a push", () => {
    assert.equal(lib(`if guard_parse_push '${PUSH}'; then echo yes; else echo no; fi`), "yes")
  })
  it("push location from -C", () => {
    assert.equal(
      lib(`GUARD_CWD=/tmp/x; guard_parse_push 'git -C sub push'; printf '%s' "$GUARD_PUSH_LOC"`),
      "/tmp/x/sub"
    )
  })
  it("push flags", () => {
    const got = lib(
      `guard_parse_push '${PUSH}'; printf '%s,%s,%s,%s' "$GUARD_PUSH_BARE" "$GUARD_PUSH_LEASE" "$GUARD_PUSH_DELETE" "$GUARD_PUSH_REMOTE"`
    )
    assert.equal(got, "1,1,0,origin")
  })
  it("push refspecs, plus stripped", () => {
    assert.equal(
      lib(`guard_parse_push '${PUSH}'; printf '%s' "$GUARD_PUSH_REFSPECS" | paste -sd, -`),
      "feat:main,topic"
    )
  })
  it("push targets are destinations", () => {
    assert.equal(lib(`guard_parse_push '${PUSH}'; guard_push_targets | paste -sd, -`), "main,topic")
  })
  it("parse_push ignores a commit", () => {
    assert.equal(lib(`if guard_parse_push 'git commit -m "push"'; then echo yes; else echo no; fi`), "no")
  })
  it("parse_push needs git first", () => {
    assert.equal(lib(`if guard_parse_push 'echo git push'; then echo yes; else echo no; fi`), "no")
  })
  const w = initRepo(join(TMP, "wt-main"))
  commit(w, "--allow-empty", "-m", "init")
  const one = join(w, ".claude", "worktrees", "one")
  git(w, "worktree", "add", "-q", one, "-b", "one")
  it("worktree_main from a linked worktree", () => {
    assert.equal(lib(`guard_worktree_main "$2"`, [one]), w)
  })
  it("worktree_main on the main checkout returns 1", () => {
    assert.equal(lib(`if guard_worktree_main "$2" >/dev/null; then echo 0; else echo 1; fi`, [w]), "1")
  })
  it("worktree_main outside git returns 1", () => {
    assert.equal(lib(`if guard_worktree_main "$2" >/dev/null; then echo 0; else echo 1; fi`, [TMP]), "1")
  })
  it("push target from the current branch", () => {
    assert.equal(lib(`GUARD_PUSH_LOC="$2"; GUARD_PUSH_REFSPECS=""; guard_push_targets`, [one]), "one")
  })
  it("unreadable current branch returns 1", () => {
    const script = `GUARD_PUSH_LOC="$2"; GUARD_PUSH_REFSPECS=""; if guard_push_targets >/dev/null; then echo 0; else echo 1; fi`
    assert.equal(lib(script, [join(TMP, "nowhere")]), "1")
  })
})

/** A throwaway repository under TMP, with an origin remote when given. */
function repo(name: string, remote?: string): string {
  return initRepo(join(TMP, name), remote === undefined ? {} : { remote })
}
function cfg(root: string, file: string, value: object): void {
  writeJson(join(root, file), value)
}
/** `guard_config_load <root>` then `script`, which sees GUARD_CONFIG, GUARD_CONFIG_ROOT and GUARD_CONFIG_PROBLEMS. */
function loaded(root: string, script: string): string {
  return lib(`guard_config_load "$2"\n${script}`, [root])
}
function get(root: string, filter: string): string {
  return loaded(root, `jq -r '${filter}' <<<"$GUARD_CONFIG"`)
}
function guardrails(root: string): string {
  return get(
    root,
    '[.guardrails.forcePush, .guardrails.envFiles.policy, (.guardrails.protectedBranches | join(" "))] | join(",")'
  )
}
function problems(root: string): string {
  return loaded(root, `printf '%s' "$GUARD_CONFIG_PROBLEMS"`)
}
/** "yes" when bash's own `=~` accepts `yes` and refuses `no` under the resolved commit.pattern. */
function patternSplits(root: string, yes: string, no: string): string {
  const script = `p=$(jq -r .commit.pattern <<<"$GUARD_CONFIG"); if [[ '${yes}' =~ $p ]] && ! [[ '${no}' =~ $p ]]; then echo yes; else echo "no: $p"; fi`
  return loaded(root, script)
}

describe("guard_config_load — inference with no file", () => {
  const r = repo("infer", ORG)
  write(join(r, ".ruby-version"), "4.0.5\n")
  write(join(r, "Gemfile"), "")
  write(join(r, "package.json"), "")
  write(join(r, "pnpm-lock.yaml"), "")
  it("root found", () => {
    assert.equal(loaded(r, `printf '%s' "$GUARD_CONFIG_ROOT"`), r)
  })
  it("conventional under any remote", () => {
    assert.equal(get(r, ".commit.convention"), "conventional")
  })
  it("the Node package manager from the lockfile, nothing from Ruby files", () => {
    assert.equal(loaded(r, `jq -c .packageManagers <<<"$GUARD_CONFIG"`), '{"node":"pnpm"}')
  })
  it("no stack key", () => {
    assert.equal(get(r, 'has("stack")'), "false")
  })
  it("default guardrails", () => {
    assert.equal(guardrails(r), "lease,git,master main production")
  })
  it("conventional commit pattern", () => {
    assert.equal(patternSplits(r, "feat(scope)!: x", "[ABC-12] docs: x"), "yes")
  })
  it("no trailer by default", () => {
    assert.equal(get(r, ".commit.trailer // empty"), "")
  })
  it("no problems", () => {
    assert.equal(problems(r), "")
  })
  it("a subdirectory resolves to the repository root", () => {
    mkdirSync(join(r, "sub", "dir"), { recursive: true })
    assert.equal(loaded(join(r, "sub", "dir"), `printf '%s' "$GUARD_CONFIG_ROOT"`), r)
  })

  const other = repo("other", "https://github.com/dominikwozniak/x.git")
  write(join(other, "package.json"), "")
  it("no package manager without a lockfile", () => {
    assert.equal(loaded(other, `jq -c .packageManagers <<<"$GUARD_CONFIG"`), "{}")
  })

  const plain = join(TMP, "plain")
  mkdirSync(plain)
  it("outside git: conventional", () => {
    assert.equal(get(plain, ".commit.convention"), "conventional")
  })

  const lockfiles: [string, string][] = [
    ["package-lock.json", "npm"],
    ["yarn.lock", "yarn"],
    ["bun.lock", "bun"],
    ["bun.lockb", "bun"]
  ]
  for (const [lockfile, manager] of lockfiles) {
    const locked = repo(`lock-${lockfile}`)
    write(join(locked, lockfile), "")
    it(`lockfile ${lockfile}`, () => {
      assert.equal(get(locked, ".packageManagers.node"), manager)
    })
  }
})

describe("guard_config_load — the committed file", () => {
  const r = repo("committed", ORG)
  cfg(r, COMMITTED, {
    baseBranch: "develop",
    guardrails: { forcePush: "deny", protectedBranches: ["master"] },
    validation: { commands: ["pnpm check"] },
    commit: { trailer: "Co-Authored-By" }
  })
  it("overrides the defaults", () => {
    assert.equal(get(r, ".baseBranch"), "develop")
  })
  it("guardrails merged over the defaults", () => {
    assert.equal(guardrails(r), "deny,git,master")
  })
  it("validation commands", () => {
    assert.equal(get(r, '.validation.commands | join(" ")'), "pnpm check")
  })
  it("commit merged", () => {
    assert.equal(get(r, ".commit.trailer"), "Co-Authored-By")
  })
  it("convention still inferred", () => {
    assert.equal(get(r, ".commit.convention"), "conventional")
  })
  it("no problems", () => {
    assert.equal(problems(r), "")
  })

  const convention = repo("convention", ORG)
  cfg(convention, COMMITTED, { commit: { convention: "ticket-key" } })
  it("commit.convention picks the preset", () => {
    assert.equal(patternSplits(convention, "[ABC-12] docs: x", "feat(scope)!: x"), "yes")
  })

  const invalid = repo("invalid")
  cfg(invalid, COMMITTED, { version: 2, guardrails: { forcePush: "allow", extra: 1 }, unrelatedTool: {} })
  it("every violation named", () => {
    const want = [
      `${COMMITTED}: version: 2 is not 1`,
      `${COMMITTED}: guardrails.forcePush: "allow" is not one of "deny", "lease"`,
      `${COMMITTED}: guardrails: unknown key "extra"`
    ].join("\n")
    assert.equal(problems(invalid), want)
  })
  it("guards go strictest", () => {
    assert.equal(guardrails(invalid), "deny,deny,master main production")
  })

  const notJson = repo("notjson")
  write(join(notJson, COMMITTED), "{ not json")
  it("not JSON is one problem", () => {
    assert.ok(problems(notJson).includes(`${COMMITTED}: not JSON: `), problems(notJson))
  })
  it("one line", () => {
    assert.equal(problems(notJson).split("\n").length, 1)
  })
  it("guards go strictest", () => {
    assert.equal(guardrails(notJson), "deny,deny,master main production")
  })
})

describe("guard_config_load — the local file", () => {
  const tighten = repo("tighten")
  cfg(tighten, COMMITTED, { baseBranch: "main", guardrails: { forcePush: "lease", protectedBranches: ["master"] } })
  cfg(tighten, LOCAL, {
    baseBranch: "develop",
    guardrails: { forcePush: "deny", envFiles: { policy: "deny" }, protectedBranches: ["master", "staging"] },
    worktree: { setup: ["pnpm install"] }
  })
  it("tightens guardrails", () => {
    assert.equal(guardrails(tighten), "deny,deny,master staging")
  })
  it("overrides everything else", () => {
    assert.equal(get(tighten, '[.baseBranch, (.worktree.setup | join(" "))] | join(",")'), "develop,pnpm install")
  })
  it("no problems", () => {
    assert.equal(problems(tighten), "")
  })

  const loosen = repo("loosen")
  cfg(loosen, COMMITTED, { guardrails: { forcePush: "deny", protectedBranches: ["master", "production"] } })
  cfg(loosen, LOCAL, { baseBranch: "develop", guardrails: { forcePush: "lease", protectedBranches: ["master"] } })
  it("loosening forcePush named", () => {
    assert.ok(problems(loosen).includes(`${LOCAL}: guardrails.forcePush: "lease" loosens "deny"`), problems(loosen))
  })
  it("dropped branch named", () => {
    assert.ok(problems(loosen).includes(`${LOCAL}: guardrails.protectedBranches: drops "production"`), problems(loosen))
  })
  it("whole local file dropped", () => {
    assert.equal(get(loosen, ".baseBranch"), "auto")
  })
  it("guards go strictest", () => {
    assert.equal(guardrails(loosen), "deny,deny,master main production")
  })

  const localOnly = repo("local-only")
  cfg(localOnly, LOCAL, { guardrails: { forcePush: "lease", envFiles: { policy: "deny" } } })
  it("equal or tighter than the defaults passes", () => {
    assert.equal(problems(localOnly), "")
  })
  const localFewer = repo("local-fewer")
  cfg(localFewer, LOCAL, { guardrails: { protectedBranches: ["master"] } })
  it("fewer branches than the defaults is a loosening", () => {
    assert.ok(problems(localFewer).includes('drops "main", "production"'), problems(localFewer))
  })
})
