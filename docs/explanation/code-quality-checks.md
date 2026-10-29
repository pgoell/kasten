---
type: Explanation
title: Code quality checks
description: What each check beyond the file size limit catches, why its limit sits where it does, why the frontend's list of exempt files only shrinks, why comments are held short, why a person still reviews one area at a time, and why the review of each pull request runs in CI.
tags: [design, lint, refactor]
status: stable
---

# Code quality checks

The [file and folder limits](/explanation/file-size-limit.md) keep every file small
enough for an agent to read in one pass, and every folder short enough to scan. It says nothing about whether the code
inside is any good. Four more checks look at that: two complexity lints, a copy
check and a review of one area at a time. The commands are in
[Run the checks](/how-to/run-the-checks.md); this page says why each exists.

## Why the cap was not enough

The cap stops a file from growing. It does not say where to cut one. When the
limit came in, files grew until the hook stopped them, and then got split at
whatever line made them fit. In October 2026, 26 of the 411 files in
`frontend/src` and `backend/src` sat between 4,500 and 5,000 tokens, and
`frontend/src/lib` held 224 files in one folder. A file can pass the cap and
still hold one function nobody can follow, or one task can be spread over six
files of two hundred lines each. The checks below look for those.

## What each check catches

**Backend complexity** (`C901`, `PLR0911`, `PLR0912`, `PLR0913`, `PLR0915` in
ruff). One function with too many paths through it, too many returns,
branches, arguments or statements. McCabe complexity counts the paths; a
function over 10 has more paths than a reader keeps in mind or a test suite
covers. The `PLR` limits are ruff's defaults. They were left alone because
nine of the ten backend functions over them when the rules came in read
better split (the tenth, a test builder, keeps a `noqa`), and a limit raised to let today's code pass would catch nothing.

**Relative imports** (`TID252` in ruff, set to ban all of them). An absolute
import names the package, so a reader and a grep find where a name comes from,
and a file moved to another folder keeps its imports working or fails loudly.
Ruff's default bans only `..` imports, which kasten never had.

**Frontend complexity** (`noExcessiveCognitiveComplexity` in Biome). The same
question for TypeScript, scored a different way: cognitive complexity adds a
point for every branch and loop, and one more for each level it is nested in.
Nesting is what makes a React handler or an effect hard to follow, so this
score fits the frontend better than a count of paths. 15 is Biome's default.

**Copies** (`lint:dup`, jscpd). A block of at least 70 tokens written out
twice. When the check came in, 0.73% of the code was copied, so it fixes
nothing today. It is there to fail the day a copy is pasted instead of a
function written, which is how two copies of a fix drift apart. The threshold
of 1% leaves room for the clones there are and very little more.

**Import boundaries** (`lint:imports`, import-linter and dependency-cruiser).
Which module may import which. A file can pass every size and complexity check
and still reach into another module's inside or import upwards, and then no
module can change alone. The rules follow the layers kasten already has: routes
above the backend's modules, `lib` below `components`, the jobs outside the
backend. A dynamic `import()` hides an edge from these tools and from a reader,
so it is banned too, except for the heavy bundles loaded on demand.

**Comments** (`lint:comments`, `scripts/structure/check-comments`). A file
over 20% comment lines may not get denser, and a file may not gain a
docstring or JSDoc block over six lines. Both counts sit in a baseline that
only goes down. The section below says why.

**An area review** ([Review an area for deep modules](/how-to/review-an-area-for-deep-modules.md)).
The split between files. No lint sees it, because every file and function in a
badly split area can pass each check on its own.

## Why the frontend's list only shrinks

When Biome's rule came in, 111 files held functions over the limit. Fixing all
of them in one pull request would have held up everything else, and turning the
rule on as a warning would have let new code add to the pile. So the rule runs
as an error, and the files that failed that day sit on a list in
`frontend/biome.jsonc` that turns it off for them.

A list like that grows by itself: the easy way past a failing commit is one
more line on it. `backend/tests/test_complexity_baseline.py` fails when the list
holds more files than its `MAX_FILES`, so adding a file means raising a number
in a test, in a diff a reviewer reads. A file comes off when its functions pass,
and the same commit lowers the number. The limit is never raised to take a file
off.

## Why comments are held short

Agents write most of kasten, and an agent explains as it goes: how the file
came to be, the code read back in prose, a doc page told again. The old rule
told a comment to match the density of the file around it, so a dense file
bred more. On 29 October 2026, 50 files in `frontend/src`, `backend/src` and
`jobs/src` were over 20% comment lines, and 412 files held 1,220 docstrings and
JSDoc blocks over six lines.

A long comment costs on every read. An agent reads it whole each time it opens
the file, against the file's 5,000 tokens, and no test sees it go stale. A
history is wrong the day the code changes; the commit message keeps it beside
the diff it explains, and `docs/` keeps the reasons that outlive one commit.

The two counts measure different things. Comments inside a function are noise
in proportion to the code around them, so the first check counts their share.
A docstring or a JSDoc block is what an editor shows a caller, so the second
counts its length. `frontend/src/lib/overlay-styles.ts` shows why both are
needed: 2% of its lines are comments, and it holds six JSDoc blocks over six
lines, one of them an 18-line story of the file.

The limits come from that day's code. 20% is where the densest tenth of files
over 20 lines starts; across the repo the share is about 10%. A file under 20
lines is left out, as one comment there is a large share. Six lines leaves
room for a docstring of two lines and a short list of arguments. Both
baselines work like the frontend's list above: fixing every file in one pull
request would hold up everything else, so today's files may only get better.

A count cannot tell a constraint from a story. So `REVIEW.md` asks the CI
review to name the bloated comments on a diff's lines and give the shorter
text, in its summary, where nothing waits on it.

The check is kasten's own, not a copy from the structure plugin like the
file-size and fan-out checks, because its limits come from kasten's code. Its
TypeScript side is a small lexer, not a parser: a `//` in JSX text reads as a
comment, which is rare enough to accept.

## Why a review by a person

A lint measures one thing it can count. Whether a module is deep, in John
Ousterhout's sense of a small interface over a lot of work, depends on what the
code is for. A file of one-line wrappers passes every check; so do seven files
that each hold a list of the kinds of pane, which must be kept the same by
hand. Only someone reading the area whole sees that one task touches all of
them.

The review runs when an area keeps producing bugs, or a file in it reaches
4,500 tokens, so the effort goes where the cost already shows. Its findings go
in as `refactor` issues rather than straight into code, so that someone decides
which are worth the change before any is built.

## Why the review runs in CI

Agents write most of kasten's pull requests, and the issue loop merges a score
of them a day. A review inside the loop reached only the loop's own pull
requests, and only while its rules said so. In CI it reads every pull request
the same way, whoever opened it, and the same files carry to another repo.

It follows the process Anthropic's Claude Code team describes: an AI review and
a security review on every pull request, findings as threads that must be
answered before the merge, tags that keep a bug the base branch already had
from blocking the author, and a person only where the change is risky. Three
choices keep it from costing more than it saves:

- **It reviews design as well as bugs.** The lints count; the review asks
  whether the change hides work behind a small interface or spreads one task
  over files, the questions of [the area review](/how-to/review-an-area-for-deep-modules.md),
  asked of the diff only. Each point must name what would show it, and taste
  with no rule behind it is no finding.
- **Only bugs block.** An agent author fixes every thread it is given, so a
  blocking design point would cost a commit and a CI run whether it mattered or
  not, and its fix rate would say nothing. Design, Pre-existing and Nit
  findings go in the summary; only Important ones are threads, and they take
  the first of the ten places. A person reads a sample of the Design points to
  judge whether they earn their keep.
- **The rounds stop.** An agent author and an agent reviewer can cycle all
  night, each round finding one more old bug. After the first round a review
  reads only the new commits, and after three it stops and asks for a rethink.
  The security review skips a later round whose commits change at most 100
  lines and no path in `.github/CODEOWNERS`, as a fix push is a few lines and
  rereading it would spend plan usage for little; the next round it runs reads
  the skipped commits too.
- **The change sets the risk, not the author.** `.github/CODEOWNERS` names the
  risky paths, and a pull request touching one waits for pgoell's review.
  GitHub reads the file from the base branch, so a pull request cannot take
  itself off the list, and a push dismisses the approval, so it covers only
  the commits that were read.
- **The loop pushes as a bot.** Its implementer runs with the token of a
  second account, a classic one with the `repo` scope and no `workflow`
  scope, so GitHub refuses any push of it that changes `.github/workflows`. A
  prompt-injected agent can then neither edit CI nor forge a check, and pgoell
  can approve its pull requests, which GitHub does not let an author do. A
  first try held risky pull requests with a commit status, but any workflow in
  a pull request can post one; a code owner's review it cannot.

The security review runs Claude Code with its own prompt, not Anthropic's
security review action, which takes only an API key and is billed apart from
the plan the other review runs on.

## Related

* [The file size limit](/explanation/file-size-limit.md): the first check, and what a deep module is
* [Review an area for deep modules](/how-to/review-an-area-for-deep-modules.md): the review, step by step
* [Run the checks](/how-to/run-the-checks.md): the commands, how to get past each check, and how to answer the CI review
* [Get past the comment checks](/how-to/run-the-checks.md#get-past-the-comment-checks): what to cut when `lint:comments` fails
