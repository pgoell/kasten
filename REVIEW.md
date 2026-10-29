# Review guide

The CI reviewer reads this file, `.claude/CLAUDE.md` and the pull request
before it reads the diff. Keep it short: every line costs a review.

## What counts as a failure here

- The vault loses or garbles a note, a link, its frontmatter or its jj history.
- A wikilink resolves to the wrong note, or a move or rename leaves links behind.
- Dev touches prod: the live vault, `kasten_prod`, or the prod containers.
- A route outside the open prefixes in `docs/explanation/security-model.md`
  answers without oauth2-proxy in front, or a token reaches the browser or a log.
- The editor breaks with vim mode on or off, or on a phone.
- A doc in `docs/` says something the code no longer does.
- A migration that cannot run against the live database, or cannot go back.

## What not to flag

- Style, naming and formatting: ruff, Biome, ty and tsc already run.
- Files under `docs/log/` and `backend/alembic/versions/` for being many.
- A missing test where the PR body names the test that covers the line.
- Taste. If it works, is tested and reads like its neighbours, let it be.

## How to report

- Every finding names a file and a line in the diff. Do not guess a file name.
- Tag each finding, first word of the comment:
  - **Important**: a bug this diff brings in, or a gap against the linked issue.
  - **Pre-existing**: a bug the base branch already has. It does not block this PR.
  - **Nit**: worth a look, safe to ignore.
- Name the class of bug, so the author fixes every place it occurs, not one line.
- Never report a finding again that an earlier round reported and the author
  answered.
- End with one summary comment: the count per tag, or "No issues found."
