---
description: Critically review the current uncommitted changes before commit.
allowed-tools: Bash(git diff:*), Bash(git status:*)
---

Current changes:

!`git status --short`

!`git diff --stat`

Use the `code-reviewer` subagent to review the uncommitted diff above (run
`git diff` to read it in full). Report findings as Blocking / Should fix / Nits /
Good. Do not fix anything yet — wait for my go-ahead.
