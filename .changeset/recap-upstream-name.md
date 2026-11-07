---
"dw-sdlc": patch
---

`dw-sdlc recap` finds the pull request of a branch pushed under another name, open or merged. Where gh finds none for the branch itself, recap asks for the head branch its configured upstream names, and takes that pull request when its commits hold the local head. A merged pull request then reads as merged and an open one reports its Action, while a branch started from another's, before its first push, takes none of that branch's.
