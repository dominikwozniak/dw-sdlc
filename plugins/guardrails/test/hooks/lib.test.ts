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

function boundaryMatches(command: string): string {
  return lib(`if printf '%s\\n' '${command}' | grep -qE "\${GUARD_BOUNDARY}git push"; then echo yes; else echo no; fi`)
}

/** guard_split_substitutions' lines joined by `|`. */
function split(text: string): string {
  return lib(`guard_split_substitutions "$2" | paste -sd'|' -`, [text])
}

function unwrap(words: string): string {
  return lib(`WORDS=(${words}); guard_unwrap_words; printf '%s' "\${WORDS[*]}"`)
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
  it("a << inside an ANSI-C quote is not an opener, one after it opens", () => {
    const strip = `printf '%s\\n' "$2" | guard_strip_heredocs`
    assert.equal(lib(strip, ["echo $'it\\'s << EOF'\ngit reset --hard"]), "echo $'it\\'s << EOF'\ngit reset --hard")
    assert.equal(lib(strip, ["cat $'a\\'b' <<EOF\nbody\nEOF\nls"]), "cat $'a\\'b' <EOF\nls")
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
  it("an unquoted heredoc body keeps the substitutions the shell runs, its prose dropped", () => {
    assert.equal(
      lib(`printf 'cat <<EOF\\nsee $(cat a) and \\x60id\\x60\\nplain\\nEOF\\necho done\\n' | guard_strip_heredocs`),
      "cat <EOF\n$(cat a) `id`\necho done"
    )
  })
  it("a substitution spanning lines of an unquoted body is kept whole", () => {
    assert.equal(
      lib(`printf 'cat <<EOF\\nx $(cat \\\\\\na) y\\nEOF\\n' | guard_strip_heredocs`),
      "cat <EOF\n$(cat \\\na)"
    )
  })
  it("an opener after a bare parenthesis inside $( leaves the line inside the substitution", () => {
    assert.equal(
      lib(`guard_heredoc_opener 'x=$( (cd a) && cat <<EOF' && printf '%s|%s' "$GUARD_HD_DELIM" "$GUARD_HD_STATE"`),
      "EOF|PU"
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
  it("a comment ending in a backslash continues nothing", () => {
    assert.equal(
      lib(`printf 'ls # note \\\ncat x\necho "a # b" \\\nc\n' | guard_join_continuations`),
      'ls # note \\\ncat x\necho "a # b" c'
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
  it("a substitution inside double quotes keeps its separators, its own quotes masked", () => {
    assert.equal(
      lib(`guard_mask_quoted_separators 'x "a;\`b;c\`;$(d; e "f;g")" y'`),
      'x "a\u0002`b;c`\u0002$(d; e "f\u0002g")" y'
    )
  })
  it("a heredoc body is text: separators and quotes masked, line starts kept", () => {
    assert.equal(
      lib(`guard_mask_quoted_separators "$(printf 'cat <<EOF\\ndon\\x27t; a\\nEOF\\nls; b')"`),
      "cat <<EOF\ndon\u0002t\u0002 a\nEOF\nls; b"
    )
  })
  it("an unquoted heredoc body is text, the substitutions in it are not", () => {
    assert.equal(
      lib(`guard_mask_quoted_separators "$(printf 'cat <<EOF\\n# it\\x27s $(a; b)\\nEOF')"`),
      "cat <<EOF\n\u0002 it\u0002s $(a; b)\nEOF"
    )
  })
  it("a comment is text: its separators masked, a # inside a word or quotes no comment", () => {
    assert.equal(lib(`guard_mask_quoted_separators 'ls # a; b'`), "ls # a\u0002 b")
    assert.equal(lib(`guard_mask_quoted_separators 'echo x#y "#"; z'`), 'echo x#y "#"; z')
  })
  it("an ANSI-C quote is text: a backslash escapes in it, its separators masked", () => {
    assert.equal(
      lib(`guard_mask_quoted_separators "$2"`, ["echo $'it\\'s $(x; y) z' ; w"]),
      "echo $'it\\'s $\u0002x\u0002 y\u0002 z' ; w"
    )
  })
  it("an ANSI-C quote handed to a shell holds a command: its separators kept, a \\n one of them", () => {
    assert.equal(
      lib(`guard_mask_quoted_separators "$2"`, ["bash -c $'cd x && ls\\ny' ; echo $'a;b'"]),
      "bash -c $'cd x && ls;y' ; echo $'a\u0002b'"
    )
    assert.equal(
      lib(`guard_mask_quoted_separators "$2"`, ["bash -c $'a\\x3bb\\012c\\x20d' ; echo $'e\\x3bf'"]),
      "bash -c $'a;b;c d' ; echo $'e\\x3bf'"
    )
    assert.equal(lib(`guard_mask_quoted_separators "$2"`, ['bash -c $"a && b"']), 'bash -c $"a && b"')
  })
  it("a $$ is the shell's pid: a quote after it is a plain one, a $' after the pair an ANSI-C one", () => {
    assert.equal(lib(`guard_mask_quoted_separators "$2"`, ["echo $$'x\\' ; c 'd;e'"]), "echo $$'x\\' ; c 'd\u0002e'")
    assert.equal(lib(`guard_mask_quoted_separators "$2"`, ["echo $$$'x\\'; y' ; c"]), "echo $$$'x\\'\u0002 y' ; c")
  })
  it("strip_quoted: the command's words on the first line, each substitution's on a line of its own", () => {
    assert.equal(lib(`guard_strip_quoted 'echo "x $(cat a) y" \`b c\`'`), "echo _\ncat a\nb c")
    assert.equal(lib(`guard_strip_quoted 'cat a "b c"'`), "cat a")
  })
  it("strip_quoted: a comment runs nothing, so its words are dropped", () => {
    assert.equal(lib(`guard_strip_quoted "$(printf 'ls # cat b\\necho "a # b" x#y')"`), "ls echo x#y")
  })
  it("substitutions split out of their text, nested ones too, single quotes literal", () => {
    assert.equal(split('a "x $(b "$(c)") y" `d`'), 'a "x _ y" _|c|b "_"|d')
    assert.equal(split('x="$(e | f)"'), 'x="_"|e | f')
    assert.equal(split("a '$(b)'"), "a '$(b)'")
    assert.equal(split('a "$(b'), 'a "$(b')
  })
  it('an ANSI-C quote holds no substitution, a $"…" quote is a double quote', () => {
    assert.equal(split("a $'it\\'s $(x) y' $(b)"), "a $'it\\'s $(x) y' _|b")
    assert.equal(split('a $"x $(b)"'), 'a $"x _"|b')
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
  it("words cut an ANSI-C quote at a NUL, the way bash does", () => {
    assert.equal(lib(`guard_words "$2" | paste -sd, -`, ["$'.env\\0.example' $'a\\x00b\\'c'd"]), ".env,ad")
  })
  it("words decode the escapes of an ANSI-C quote the way bash does", () => {
    assert.equal(
      lib(`guard_words "$2" | paste -sd, -`, ["$'\\x2eenv\\056local' $'\\u002eenvrc' $'a\\nb' $'\\q\\x\\xff' $'\\cA'"]),
      ".env.local,.envrc,a b,\\q\\x\\xff,\u0001"
    )
  })
  it('words drop the $ of a $"…" quote', () => {
    assert.equal(lib(`guard_words "$2" | paste -sd, -`, ['cat $".env.local" $"a b" p$$"q"']), "cat,.env.local,a b,p$$q")
  })
  it("words drop the $ of an ANSI-C quote, a backslash escaping in it", () => {
    assert.equal(
      lib(`guard_words "$2" | paste -sd, -`, ["cat $'.env.local' $'it\\'s x' a$'b' p$$'q'"]),
      "cat,.env.local,it's x,ab,p$$q"
    )
  })
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
  it("unwrap drops a shell's -c and splits the command it is handed", () => {
    assert.equal(unwrap("bash -c 'git push --force'"), "git push --force")
    assert.equal(unwrap("sh -e -c 'git push'"), "git push")
    assert.equal(unwrap("zsh -lc 'git push'"), "git push")
    assert.equal(unwrap("bash -o pipefail -c 'git push'"), "git push")
    assert.equal(unwrap("bash --norc -c 'git push'"), "git push")
  })
  it("unwrap drops eval", () => {
    assert.equal(unwrap("eval git push"), "git push")
    assert.equal(unwrap("eval 'git push -f'"), "git push -f")
  })
  it("unwrap keeps a shell running a script", () => {
    assert.equal(unwrap("bash scripts/x.sh"), "bash scripts/x.sh")
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
  it("pipelines split at separators but never at a pipe", () => {
    const script = `guard_pipelines "$(guard_mask_quoted_separators 'a | b && c || d; e & f "x;y"')" | paste -sd, -`
    assert.equal(lib(script), 'a | b , c , d, e , f "x\u0002y"')
  })
  it("pipelines keep a redirect's & inside its pipeline", () => {
    const script = `guard_pipelines 'env 2>&1 | grep x &> log' | wc -l | tr -d ' '`
    assert.equal(lib(script), "1")
  })
  it("absolute resolves a relative path under GUARD_CWD, or the base given", () => {
    assert.equal(lib(`GUARD_CWD=/repo; guard_absolute src/a.ts`), "/repo/src/a.ts")
    assert.equal(lib(`GUARD_CWD=/repo; guard_absolute /etc/hosts`), "/etc/hosts")
    assert.equal(lib(`GUARD_CWD=/repo; guard_absolute a.ts /real`), "/real/a.ts")
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
