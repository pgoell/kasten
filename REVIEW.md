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

Look at how the change is built as well as whether it works. The lints see one
function or one file; they miss these, which
`docs/how-to/review-an-area-for-deep-modules.md` explains at length. Each point
must name what would show it, so the author can check it:

- A shallow module: a new file, function or component whose body only passes
  calls on. Name the caller it should fold into.
- One task spread thin: name the files this one change touched that always
  change together, and the one they should become.
- A list written out twice: name every copy of the list (kinds of pane,
  routes, settings) that must now be kept the same by hand.
- Code in the wrong home: name the module the feature lives in and why the
  code belongs there.
- A file cut at a line count to fit the size limit: name the commit that cut it.
- A rule of `.claude/CLAUDE.md` broken: a bare catchall, a dynamic import, a
  comment that says what instead of why. Quote the rule.

Taste with no rule behind it is not a finding.

## What not to flag

- Formatting and the rules ruff, Biome, ty and tsc already enforce.
- Files under `docs/log/` and `backend/alembic/versions/` for being many.
- A missing test where the PR body names the test that covers the line.
- A design point about code the diff does not touch; the area review takes those.

## How to report

Only an Important finding becomes a thread on its line, and every thread must be
answered before the merge. Everything else goes in the summary, where the
author reads it and nothing waits on it: an agent fixes whatever it is told, so a
blocking design point costs a commit and a CI run whether it mattered or not.

- **Important**: a bug this diff brings in, or a gap against the linked issue.
  A thread on the file and line, naming the class of bug so the author fixes
  every place it occurs. Important findings come first: never leave one out to
  make room for anything else.
- **Design**: a point from the list above, with the change you would make. At
  most 3, in the summary.
- **Pre-existing**: a bug the base branch already has. In the summary, as a
  line the author can turn into an issue.
- **Nit**: worth a look, safe to ignore. In the summary.

At most 10 findings in all. Every finding names a file and a line in the diff;
do not guess a file name. Never report again a finding an earlier round raised.
The summary gives the count per tag, or says "No issues found."
