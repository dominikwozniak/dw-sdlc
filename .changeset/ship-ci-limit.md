---
"dw-sdlc": minor
---

`pr ship` parks the new Action `ci-limit` on the third head in a row whose CI failed, the head counted: exit 30, the failing checks under `details.checks`, and in `next` the dev's two ways on, fix it themselves or say "merge without CI". The count reads the pull request's last 100 commits, each now read with its CI state. A head the update-branch merge made counts, CI unavailable with no Gate mark on the head counts, and a green head or a Gate mark resets the count; a commit no check reported on counts for nothing. A rebase or a force push rewrites the history and restarts the count. A rerun is no head: red again on the same head is plain `fix-ci`.
