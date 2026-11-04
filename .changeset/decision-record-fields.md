---
"dw-sdlc": minor
---

`decision-records` takes a `fields` option that holds each record to more of its frontmatter. It names no field by default, and then the Check judges `status` alone. `date` is a `YYYY-MM-DD` day. Under `touches`, a record in force, its status `accepted` or `active`, names the paths it governs. Each is a file or directory git tracks or would track, or a glob that matches such a file. A `superseded` record names none. Under `superseded-by`, a `superseded` record names the number of each record that replaces it. Each number under `amended-by` is the number of a record in the same directory. A list is comma-separated after its key, or one `- ` item a line under it. Each failure names the record and the fix.
