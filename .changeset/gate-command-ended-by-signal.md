---
"dw-sdlc": patch
---

`dw-sdlc gate` starts no command after one that SIGINT or SIGTERM ended. Ctrl-C reaches the running command and the Gate together, and the Gate can see the command's exit before its own signal. A `gate.checks.run` script stopped that way no longer lets the next one start, only to be stopped in turn, and a Step stopped that way is not compared for Drift. The Gate reports the command as stopped by the signal and runs nothing after it, as it does for a signal it gets itself.
