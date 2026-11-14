// The `markdown-refs` Check through `dw-sdlc gate`, on a throwaway repository whose markdown breaks one
// link at a time: the exit code and each failure line word for word.

import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { git, lines, repo, runBin } from "../harness.ts"

const CONFIG = ".ai/agentic.config.json"

const README = `# Demo

See [the guide](docs/guide.md), [installing it](docs/guide.md#install-it), [the docs](docs/) and [usage](#usage).
[The site](https://example.com/gone.md), [mail](mailto:someone@example.com) and [a host](//example.com/gone.md).
![The logo](<docs/logo file.svg> "Logo") and ![again](docs/logo%20file.svg), [from the root](/docs/guide.md).

\`[not a link](gone.md)\` and \`\`a [span](gone.md) with \` inside\`\`.

\`\`\`md
[nor this](gone.md)
\`\`\`

[guide]: ./docs/guide.md
[^note]: a footnote, not a link

## Usage
`

/** A README whose every relative link resolves, the docs it points at, and a doc that links back up. */
const TREE = {
  "README.md": README,
  "docs/guide.md": "# Guide\n\n## Install it\n\n```md\n## Not a heading\n```\n",
  "docs/logo file.svg": "<svg/>",
  "docs/agents/domain.md": "# Domain\n\nRead [the guide](../guide.md#install-it) and [the README](../../README.md).\n"
}

/** A repository with `markdown-refs` set to `setting` under gate.checks, `TREE` with `files` over it. */
function withDocs(files: Record<string, string | object> = {}, setting: unknown = true, remote?: string): string {
  const config = { version: 1, gate: { checks: { "markdown-refs": setting } } }
  return repo({ files: { [CONFIG]: config, ...TREE, ...files }, ...(remote === undefined ? {} : { remote }) })
}

/** The failure lines of a Gate run that ran the one Check, its own `gate: check` line and the verdict cut. */
function failures(stdout: string): string[] {
  return lines(stdout).slice(1, -1)
}

describe("the markdown-refs Check", () => {
  it("passes relative links and anchors that resolve, and leaves links with a scheme and links in code alone", () => {
    const run = runBin(["gate"], withDocs())
    assert.equal(run.status, 0, run.stdout)
    assert.deepEqual(lines(run.stdout), ["gate: check markdown-refs — pass", "gate: green — 0 steps, 1 check"])
  })

  it("fails a link to a path that does not exist, a reference definition included", () => {
    const guide = "# Guide\n\n## Install it\n\nSee [the plan](plan.md).\n\n[old]: ../gone/\n"
    const run = runBin(["gate"], withDocs({ "docs/guide.md": guide }))
    assert.equal(run.status, 1)
    assert.deepEqual(failures(run.stdout), [
      'docs/guide.md:5: markdown-refs: links to "plan.md", which does not exist — fix the path or drop the link',
      'docs/guide.md:7: markdown-refs: links to "../gone/", which does not exist — fix the path or drop the link'
    ])
  })

  it("fails an anchor its file has no heading for, a heading inside a code fence not counted", () => {
    const run = runBin(
      ["gate"],
      withDocs({ "docs/agents/domain.md": "# Domain\n\n[A](../guide.md#not-a-heading) and [b](#domains).\n" })
    )
    assert.equal(run.status, 1)
    assert.deepEqual(failures(run.stdout), [
      'docs/agents/domain.md:3: markdown-refs: links to "../guide.md#not-a-heading", but docs/guide.md has no heading with that anchor — point it at a heading the file has',
      'docs/agents/domain.md:3: markdown-refs: links to "#domains", but docs/agents/domain.md has no heading with that anchor — point it at a heading the file has'
    ])
  })

  it("fails a link out of the repository, to a file git ignores, and to a file in another case", () => {
    const doc = "# Domain\n\n[Out](../../../outside.md), [local](../notes.md) and [cased](../Guide.md).\n"
    const run = runBin(
      ["gate"],
      withDocs({ "docs/agents/domain.md": doc, ".gitignore": "docs/notes.md\n", "docs/notes.md": "" })
    )
    assert.equal(run.status, 1)
    assert.deepEqual(failures(run.stdout), [
      'docs/agents/domain.md:3: markdown-refs: links to "../../../outside.md", which is outside the repository — point it at a file of the repository',
      'docs/agents/domain.md:3: markdown-refs: links to "../notes.md", which does not exist — fix the path or drop the link',
      'docs/agents/domain.md:3: markdown-refs: links to "../Guide.md", which does not exist — fix the path or drop the link'
    ])
  })
})

/** A doc of absolute URLs into `demo/site`, one per line, the last inside a code fence. */
const URLS = `# URLs

[The guide](https://github.com/demo/site/blob/main/docs/guide.md#install-it), [the docs](https://github.com/Demo/Site/tree/main/docs).
![The logo](https://raw.githubusercontent.com/demo/site/main/docs/logo%20file.svg) and <https://github.com/demo/site/blob/main/README.md>.
[An old file](https://github.com/demo/site/blob/v0.1.0/old.md) and [another repository](https://github.com/other/site/blob/main/gone.md).
[Gone](https://github.com/demo/site/blob/main/gone.md) and [no heading](https://github.com/demo/site/blob/main/docs/guide.md#nope).

\`\`\`json
{ "$schema": "https://raw.githubusercontent.com/demo/site/main/config/gone.json" }
\`\`\`
`

describe("the markdown-refs Check on absolute URLs into the repository", () => {
  it("leaves them alone in a repository with no origin, where no URL is its own", () => {
    const run = runBin(["gate"], withDocs({ "docs/urls.md": URLS }))
    assert.equal(run.status, 0, run.stdout)
  })

  it("fails a URL at the default branch to a path or a heading the tree lacks, inside a code fence too", () => {
    for (const remote of [
      "git@github.com:demo/site.git",
      "https://github.com/demo/site.git",
      "https://github.com/demo/site"
    ]) {
      const run = runBin(["gate"], withDocs({ "docs/urls.md": URLS }, true, remote))
      assert.equal(run.status, 1, remote)
      assert.deepEqual(failures(run.stdout), [
        'docs/urls.md:6: markdown-refs: links to "https://github.com/demo/site/blob/main/gone.md", which does not exist — fix the path or drop the link',
        'docs/urls.md:6: markdown-refs: links to "https://github.com/demo/site/blob/main/docs/guide.md#nope", but docs/guide.md has no heading with that anchor — point it at a heading the file has',
        'docs/urls.md:9: markdown-refs: links to "https://raw.githubusercontent.com/demo/site/main/config/gone.json", which does not exist — fix the path or drop the link'
      ])
    }
  })

  it("reads the default branch from origin/HEAD, and judges no URL at another branch", () => {
    const trunk = "[Gone](https://github.com/demo/site/blob/trunk/gone.md)\n"
    const root = withDocs({ "docs/urls.md": URLS, "docs/trunk.md": trunk }, true, "git@github.com:demo/site.git")
    git(root, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/trunk")
    const run = runBin(["gate"], root)
    assert.equal(run.status, 1)
    assert.deepEqual(failures(run.stdout), [
      'docs/trunk.md:1: markdown-refs: links to "https://github.com/demo/site/blob/trunk/gone.md", which does not exist — fix the path or drop the link'
    ])
  })
})

describe("the markdown-refs Check's options", () => {
  it("judges only the files a glob of files matches and none of exempt does", () => {
    const broken = { "docs/guide.md": "# Guide\n\n[Gone](gone.md)\n", "docs/agents/domain.md": "[Gone](gone.md)\n" }
    const run = runBin(["gate"], withDocs(broken, { files: ["docs/**/*.md"], exempt: ["docs/agents/**"] }))
    assert.equal(run.status, 1)
    assert.deepEqual(failures(run.stdout), [
      'docs/guide.md:3: markdown-refs: links to "gone.md", which does not exist — fix the path or drop the link'
    ])
  })

  it("stays off under false", () => {
    const run = runBin(["gate"], withDocs({ "docs/guide.md": "[Gone](gone.md)\n" }, false))
    assert.equal(run.status, 0, run.stdout)
    assert.deepEqual(lines(run.stdout), ["gate: green — 0 steps, 0 checks"])
  })

  it("exits 2 outside a git repository, where it cannot list the files", () => {
    const config = { version: 1, gate: { checks: { "markdown-refs": true } } }
    const run = runBin(["gate"], repo({ git: false, files: { [CONFIG]: config, ...TREE } }))
    assert.equal(run.status, 2)
    assert.deepEqual(failures(run.stdout), [
      "markdown-refs: cannot list the files: not a git repository — run the Gate inside a git repository"
    ])
  })
})
