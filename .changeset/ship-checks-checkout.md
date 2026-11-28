---
"dw-sdlc": minor
---

`pr ship` checks the local checkout before it hands the agent a fix (`fix-conflicts`, `fix-ci`, `address-review`, `prove-locally`). On the pull request's branch, by its own name or its upstream's, behind the `head` GitHub holds, `git pull --rebase` comes first in `next`. On another branch, on a detached HEAD, or on the pull request's branch with a commit the pull request lacks, the answer is the new Action `park wrong-checkout`, exit 30: the one step is the dev's `git switch <branch>`, and the reason names where the checkout is and where it should be. A call that names the pull request with `-R` checks no checkout, so it ships from any directory.
