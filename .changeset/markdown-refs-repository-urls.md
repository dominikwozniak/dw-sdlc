---
"dw-sdlc": minor
---

The `markdown-refs` Check judges a URL into the GitHub repository `origin` names, at its default branch: a `github.com/<owner>/<name>/blob|tree/<branch>/` or `raw.githubusercontent.com/<owner>/<name>/<branch>/` URL fails when its path, or its heading anchor, does not resolve in the tree. It reads such a URL inside a code fence too, where a config example's `$schema` lives. The default branch is the one `origin/HEAD` names, else `main`.
