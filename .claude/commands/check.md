---
description: Run the full verification suite (lint, typecheck, test).
allowed-tools: Bash(pnpm:*)
---

Run the project verification gate and report results concisely:

!`pnpm check`

If anything fails, summarise what broke and propose the minimal fix. Do not
commit; this is a read-only health check.
