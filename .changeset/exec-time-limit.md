---
"dw-sdlc": patch
---

Every short-lived child process `dw-sdlc` runs has a time limit, 2 minutes, and 10 for a clone, a fetch or a scan of a repository's history. A tool that hangs stops the command with exit 2 and names the tool, where it used to hang forever; `dw-sdlc doctor` reports it on its own line and carries on. git never waits on a credential prompt, and every call has room for 64 MiB of output.
