# How a guard reads a Bash command

The guards of the [`sdlc` plugin](../../plugins/sdlc/README.md#guards) judge a Bash command the way the
shell reads it, through the scanners in `plugins/sdlc/hooks/lib-*.sh`. A rule fires on a command the shell
runs, not on text that only looks like one. This page is for a change to those scanners; what the guards
let past is in [Known limits](../../plugins/sdlc/README.md#known-limits), and why they stop at ordinary
commands is [ADR 0017](../adr/0017-guards-catch-ordinary-commands-not-deliberate-evasion.md) and
[ADR 0018](../adr/0018-bash-guards-keep-the-word-walker-not-a-shell-parser.md). Paths below are under
`plugins/sdlc/`.

## The command position

A command runs where the shell reads one: at a line start, indented or not, or after `;`, `&`, `|`,
`(` or a backtick. It runs, too, behind a launcher, a word that runs the command after it. A command
named by a path or with a leading backslash, `/usr/bin/git` or `\rm`, is that command. The launchers,
with the options that take a value, glued or as the next word:

| launcher                                                       | its options that take a value                                    |
| -------------------------------------------------------------- | ---------------------------------------------------------------- |
| `then`, `do`, `else`, `elif`, `if`, `while`, `until`, `!`, `{` | none                                                             |
| `time`                                                         | `-o`, `-f` (GNU time; the keyword's `-p` takes none)             |
| `sudo`                                                         | `-u`, `-g`, `-h`, `-p`, `-U`, `-r`, `-t`, `-C`, `-D`, `-R`, `-T` |
| `env`                                                          | `-u`, `-C`, `-S`, then any `VAR=value`                           |
| `command`                                                      | none; `-p` runs the command, `-v` and `-V` only look it up       |
| `eval`, `nohup`                                                | none                                                             |
| `exec`                                                         | `-a`                                                             |
| `nice`                                                         | `-n`                                                             |
| `timeout`                                                      | `-s`, `-k`, then one duration                                    |
| `stdbuf`                                                       | `-i`, `-o`, `-e`                                                 |
| `xargs`                                                        | `-a`, `-d`, `-E`, `-I`, `-J`, `-L`, `-n`, `-P`, `-R`, `-s`, `-S` |
| `find` with `-exec`, `-execdir`, `-ok` or `-okdir`             | none; the command runs up to its `;` or `{} +`                   |
| `sh`, `bash`, `zsh`, `dash`, `ksh`                             | none; the command is the text after a `-c`, or after `<<<`       |
| `rtk`                                                          | its flags, then `run`, `proxy`, `err`, `test` or `summary`       |
| `VAR=value`                                                    | none                                                             |

`hooks/lib-words.sh` reads the table twice: `guard_unwrap_words` on words, for the guards that read
a command word by word and for a `cd`, and `GUARD_BOUNDARY` on text, for the arms that read a target
in place.
`test/hooks/lib.test.ts` holds the two to the same spellings.

## Commands and scopes

`guard_scopes`, in `hooks/lib.sh`, cuts the masked scan into the commands the shell runs, one a
line: at `;`, `&`, `|`, a newline and a subshell's parentheses, each of which also stands as a scope
line, so a `cd` inside a subshell ends with it. A redirect's `&`, as in `2>&1`, `<&0` and `&>`, is
no cut: `git push 2>&1 origin main` is one push to `main`. A `cd` or `pushd` with a literal
directory, behind its options and a `--`, moves where the shell stands. The
guard keeps the directories `pushd` saves, so a `popd` or a bare `pushd` goes back as the shell
does, and a subshell gives the stack back at its end too. `pushd` and `popd` take `-n`, which
leaves the shell where it is: `pushd -n dir` saves `dir` and `popd -n` drops the top entry. A `$(…)` or backtick substitution is one
word of the command around it, not a cut: `guard_lift_substitutions` makes it the word `$_`, a value computed at
runtime, and moves its body to a scope of its own just before that command, since the shell runs the
body first. So `git push origin "$(git branch --show-current)" --force` is one push with its
`--force`, and its body one command before it. A `$_` in the command's place, alone or glued to
it, is read as empty, as bash drops an empty expansion, so `$(true) git reset --hard` and
`$(true)git reset --hard` are a `git reset`; a `case` pattern's `)`
inside a substitution ends no substitution. One left open hands back the scan as typed, cut at each
parenthesis and backtick. `guard_segments` is the same lines without the scope lines.

## The quote walker

`guard_quote_walk <text> [<live>] [<state>] [<from>] [<stop>]`, in `hooks/lib-text.sh`, is the one
reader of shell quoting. It cuts the text into pieces, `GUARD_QW_KIND[i]` and `GUARD_QW_TEXT[i]`,
whose texts joined are the text again. The mask, the substitution split, the word reader and the
heredoc passes each loop over those pieces. A piece's kind:

| kind   | the piece                              |
| ------ | -------------------------------------- |
| `t<c>` | text read in context `<c>`             |
| `e<c>` | a backslash and the character it keeps |
| `o<c>` | what opens context `<c>`               |
| `c<c>` | what closes it                         |
| `tC`   | a comment, up to the newline           |
| `h`    | a heredoc operator and its delimiter   |

The contexts:

- `P`, the top level;
- `S` and `D`, a single- and a double-quoted span;
- `A`, an ANSI-C `$'…'` span, where a backslash escapes and the next `'` closes;
- `U`, a `$(…)`, and `V`, a bare `(` inside one;
- `B`, a backtick substitution;
- `H`, an unquoted heredoc body, where only a substitution and a backslash act;
- `E`, a `${…}`, where a quote nests even inside a `"…"`, a `(` and a `#` are text, and the first
  bare `}` closes it.

A `$'` opens `A` wherever a `'` would open `S`. A `$"…"` is a double-quoted span after a `$` of text,
and a `$` before anything else is text. A comment and a heredoc operator count only where the shell
reads a command: in `P`, `U`, `V` and `B`.

A heredoc's delimiter is a whole shell word, up to a blank or a metacharacter, and the body ends at a
line that holds its text alone, quotes and backslashes removed: `E"O"F` ends at `EOF`, and `E.O`,
`'END-OF-TEXT'` and `"END OF"` at themselves. Any quote or backslash in it keeps the body literal. It
opens with a letter, `_`, a quote or a backslash, so the `1<<2` of `$((1<<2))` opens none.

With `<live>` set, a quote after a shell's `-c`, `eval` or `rtk run` holds a command and opens `s`,
`d` or `a` instead; a shell named by a path or behind a backslash, `/bin/bash -c` or `\bash -c`, is
that shell. In `a` a backslash still escapes, so a `\'` there is text the walk does not
follow. A `${…}` in `d` opens `e`: the outer shell expands it and hands the shell what it expands to,
so its text holds the command too, and a `"…"`, `'…'` or `$'…'` in it opens `d`, `s` or `a`. The
outer shell drops those quotes, all but a `'…'` that bash 3.2 and a `:-` keep; reading that one as a
command refuses more, not less.

`GUARD_QW_STATE` is the stack the text ends in, one context per character, starting from `<state>`,
`P` by default. The walk returns 1 when it ends elsewhere, with a quote or a substitution left open.
It starts at offset `<from>`, 0 by default, and reads the text before it as what precedes it.
`<stop>` ends it early: `o` just after a quote handed to a shell opens, `c` just after the context it
starts in closes. `GUARD_QW_END` is the offset it stops at.

The walk jumps from one character that can change the context to the next, so a long quoted body
costs a step per quote, backslash and substitution, not one per character. A step reads a window of
the text, `GUARD_QW_WINDOW` characters. In bash 3.2 a substring costs the length of the string it is
taken from, so a step on the whole text would cost the text's length, and a long command the square
of it.

## Live quotes

A quote handed to a shell, a live quote, is read where the outer shell ends it.
`guard_live_span <opening kind>`, in `hooks/lib-live.sh`, reads one from the walk's pieces, which
start just after its opening quote: `os`, `oa` or `od` where a live walk opened it, `oS`, `oA` or
`oD` where the walk read it the outer shell's way. It sets:

- `GUARD_LIVE_CTX`, the context the outer shell reads it in: `S`, `A` or `D`;
- `GUARD_LIVE_RAW`, the text up to the walk's closing quote; `GUARD_LIVE_LEN`, the characters
  through that quote; `GUARD_LIVE_END`, its piece;
- `GUARD_LIVE_TEXT`, the text the shell is handed: a `$'…'` decoded, and in a `"…"` the escapes of
  `$`, a backtick, `"` and `\` undone;
- `GUARD_LIVE_SPLIT`, that text with each substitution of a `"…"` made `_`, and its body in
  `GUARD_LIVE_SUBS`, since the outer shell runs it first.

A `${…}` nests its quotes the way the outer shell does. The reader returns:

- 1 when the quote never closes;
- 2 when the outer shell may end it elsewhere than a live walk does: a `'…'` holding a `'`, a `$'…'`
  holding an unescaped `'`, a `"…"` holding a `'…'` or `$'…'` with a `"`, `$`, backtick or
  backslash, which is text there to the outer shell, or a substitution read with a quote handed on
  inside it;
- 3 when the walk ends it where the shell does but reads the text as typed, not as the shell is
  handed it: a `$'…'` holding a backslash.

`guard_live_walk` finds where the quote ends with the outer shell's walk and stops the live walk
there, so a command costs time linear in its live quotes.

## Words

`guard_split_words`, in `hooks/lib-words.sh`, splits one command's arguments into words the way a
shell does, so `-C 'my repo'` stays one word. It reads the walk's pieces:

- whitespace at the top level separates words;
- quotes group and are dropped, the `$` of a `$'…'` or a `$"…"` with them;
- a backslash keeps the next character; in a `$'…'` an escape stands for what bash decodes it to, a
  newline reads as a space, and the text ends at a NUL;
- a `$(…)`, a backtick substitution or a `${…}` stays in its word, delimiters and whitespace
  included, with the quotes and backslashes inside it read the same way;
- a comment's text splits as the command's does, and a heredoc operator reads as `<<EOF`, the
  delimiter one word with its quotes dropped, `<<'END OF'` as `<<END OF`.

## Paths in a command

The env and credential guards look for a path among a command's words. `guard_strip_quoted`, in
`hooks/lib-text.sh`, decides which words count:

- A heredoc body is dropped, but for the substitutions an unquoted one runs.
- A word that holds whitespace is prose and is dropped: only a quoted span puts whitespace into a
  word, and such a span is a message, a pattern or a sentence. A quoted word without whitespace
  counts like any other, since `'db:drop'` and `"$HOME/.ssh/id_rsa"` are what the shell passes on.
  So prose in a commit message never reads as a file, while `cat ".env.local"` still names one.
- In the segment of a search tool, `grep`, `egrep`, `fgrep`, `rg`, `ag`, `ack` or `git grep`, every
  quoted word is dropped: there it is the pattern, and `grep -rn ".env.local" src` opens no such
  file.
- A substitution the shell runs, `"$(cat .env.local)"` included, is read as a command of its own, so
  its words count even inside double quotes while the prose around it stays prose. A quote handed to
  a shell's `-c`, `eval` or `rtk run` is read the same way.
- A comment runs nothing, so its words are dropped.

The words are then read command by command, through `guard_scopes`: a relative path counts from
where a `cd`, `pushd` or `popd` earlier in the command left the shell. A glob the
env guard reads, one whose last segment opens with a `.`, is the files it expands to there; quoted,
as in `find . -name '.env*'`, it stays the word it is.

Two costs follow. A quoted path holding a space reads as prose, so `cat "my dir/.env"` passes.
Outside the search tools, a quoted word that is exactly a guarded name reads as that file. An
unterminated quote hands back the text as typed: the guard fails closed and judges what was typed.
