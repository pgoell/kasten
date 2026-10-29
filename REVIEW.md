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

## Design

Look at how the change is built as well as whether it works. The lints see
one function or one file; they miss these, which
`docs/how-to/review-an-area-for-deep-modules.md` explains at length:

- A shallow module: a new file, function or component that only passes calls
  on, or takes a pile of props to hand them down, and hides no work.
- One task spread thin: the change touches many files to do one thing, or two
  files it changes always change together and should be one.
- A list written out twice: a second copy of something another file already
  holds (kinds of pane, routes, settings), which must now be kept the same by
  hand. Name every copy.
- Code in the wrong home: put where the arguments happened to be, not where
  the feature lives.
- A file cut at a line count to fit the size limit, not along a module.
- Breaking the rules in `.claude/CLAUDE.md`: a bare catchall, a dynamic import,
  a comment that says what instead of why.
- Code that does not read like its neighbours: another idiom, naming or comment
  density than the file around it.

## What not to flag

- Formatting and the rules ruff, Biome, ty and tsc already enforce.
- Files under `docs/log/` and `backend/alembic/versions/` for being many.
- A missing test where the PR body names the test that covers the line.
- A design point about code the diff does not touch; the area review takes those.

## How to report

- Every finding names a file and a line in the diff. Do not guess a file name.
- Tag each finding, first word of the comment:
  - **Important**: a bug this diff brings in, or a gap against the linked issue.
  - **Design**: a point from the list above, with the change you would make.
  - **Pre-existing**: a bug the base branch already has. It does not block this PR.
  - **Nit**: worth a look, safe to ignore.
- Name the class of bug, so the author fixes every place it occurs, not one line.
- Never report a finding again that an earlier round reported and the author
  answered.
- End with one summary comment: the count per tag, or "No issues found."
