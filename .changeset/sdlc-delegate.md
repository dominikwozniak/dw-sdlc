---
"dw-sdlc": minor
---

The `sdlc-sessions` plugin adds `/sdlc-delegate`, which makes a session a Lead: it hands an issue to a Worker or splits the current work into Briefs, starts each Worker with `dw-sdlc worker start`, ends its turn, wakes on each Worker's Recap, relays what needs the dev and gives one combined Recap. It refuses outside herdr and in a linked worktree.

`dw-sdlc recap` lists the session's live Workers when it runs in herdr, and a live Worker makes the close verdict no, under the reason `workers`. `dw-sdlc doctor` reports on its `hc` line whether herdr's `hc` is on the agent's PATH.

`dw-sdlc worker start` looks for the Worker's tab for up to 10 seconds, or `--wait` when shorter, since the window lists it a moment after `hc run`. `dw-sdlc worker ls` shows the folder a live Worker works in, its worktree, rather than the folder it was launched in.
