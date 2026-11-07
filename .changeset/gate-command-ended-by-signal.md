---
"dw-sdlc": patch
---

`dw-sdlc gate` starts no command after one that SIGINT or SIGTERM ended, and compares no tree after such a Step. Ctrl-C reaches the running command and the Gate together, and the Gate can see the command's exit before its own signal. The Gate reports that command as stopped by the signal and runs nothing after it, as for a signal it gets itself, and the signal that reaches it late does not end it before its report. A command that traps the signal and exits with a code of its own stops the run only once the Gate sees the signal.
