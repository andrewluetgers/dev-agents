---
name: review
description: Review a git diff for bugs, style issues, and security concerns.
argument-hint: [branch or commit range]
---

# Code Review

Review the current git diff (or the diff specified in `$ARGUMENTS`) for:

1. **Bugs** — logic errors, off-by-ones, null dereferences, race conditions
2. **Security** — injection, auth bypasses, leaked secrets, OWASP top 10
3. **Style** — naming, dead code, unnecessary complexity

Run:
```bash
git diff $ARGUMENTS
```

For each issue found, cite the file and line number. Classify as **bug**, **security**, or **style**. Suggest a fix.

If the diff is clean, say so briefly.
