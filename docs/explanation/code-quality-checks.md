---
type: Explanation
title: Code quality checks
description: What each check beyond the file size limit catches, why its limit sits where it does, why the frontend's list of exempt files only shrinks, and why a person still reviews one area at a time.
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

## Related

* [The file size limit](/explanation/file-size-limit.md): the first check, and what a deep module is
* [Review an area for deep modules](/how-to/review-an-area-for-deep-modules.md): the review, step by step
* [Run the checks](/how-to/run-the-checks.md): the commands, and how to get past each check
