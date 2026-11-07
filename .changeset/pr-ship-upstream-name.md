---
"dw-sdlc": patch
---

`dw-sdlc pr ship` without a number finds the pull request of a branch pushed under another name, as `dw-sdlc recap` does. Where gh finds none for the branch itself, it asks for the head branch the configured upstream names, and acts on that pull request only when its commits hold the local head; otherwise it exits 2 and names the pull request it passed over.
