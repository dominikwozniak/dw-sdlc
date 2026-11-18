---
"dw-sdlc": minor
---

Add `dw-sdlc session name <name> --role lead|worker`, which names the calling herdr session: it sets the labels `role` and `name` on `$HC_TERMINAL_ID` with `hc label` and renames the tab that holds it. Add `dw-sdlc session ls`, which lists every live session with its role, name, status and folder, where `worker ls` lists only the Workers of one Lead.
