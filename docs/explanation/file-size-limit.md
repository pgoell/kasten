---
type: Explanation
title: File and folder limits
description: Why an authored file stays under 5,000 tokens, why a folder holds about seven entries, why the checks count bytes and keep a baseline, and why a file or folder over a limit is split along a deep module.
tags: [design, docs, lint, git-hooks]
status: stable
---

# File and folder limits

An authored file stays under 5,000 tokens, and a folder holds about seven
entries. `scripts/structure/check-file-size` checks the first limit, and
`scripts/structure/check-fan-out` checks the second. This page says why each
limit exists and what to do when a commit trips one. For the commands, see
[Run the checks](/how-to/run-the-checks.md).

## Why a cap

An agent reads a file in pieces when the file is too big to take in at once.
Each piece costs a turn, and by the last piece the agent has lost track of what
the first one said. Under the cap, the agent reads the whole file and edits
it without a second read. The cap keeps every file small enough for that.

## Why bytes divided by four

A token is roughly four bytes of English or code. Counting bytes needs no
tokenizer, so the check needs no install and gives the same answer on every
machine. It rounds bytes/4 down before it compares, so a file passes up to
20,003 bytes and fails from 20,004. The number
is a guard, not a measure. It is close enough to catch a file that is too big,
and cheap enough to run on every commit.

## What is excluded

The check skips only what nobody writes by hand. Its defaults are lock files,
images, fonts, PDFs and license texts. A repo adds its own globs in
`.file-size-excludes` at the root. This repo adds the bun lock, the OpenAPI file
and the generated API types, a saved graph answer, EPUBs and SVGs. A file that
needs an exception should be split instead.

## Why a folder holds about seven entries

An agent lists a folder to find the file it wants. Seven names fit in one look.
A folder of 200 files forces the agent to guess from the names, and a guess that
misses costs another listing. Group files by concept, not into a `utils` or
`helpers` bucket, which only moves the problem to a bigger folder.

`check-fan-out` counts the files and folders directly in a folder. It counts
tracked and untracked entries, and it skips anything git ignores. The repo root
and names that start with a dot are skipped.

## The baseline

Some folders hold more than seven entries today. `.fan-out-baseline` lists them
as `<folder> <count>`. A folder fails only when it grows past its count, so the
baseline may only go down. `check-fan-out --update-baseline` lowers or drops a
line and never raises or adds one. Raising a number is a hand edit that a
reviewer sees, and it does not pass the check on its own merits. Do not raise a
number to get past a failure.

## Lists by design

Some folders are lists on purpose: one dated page per day of changes, and one
file per database migration. `.fan-out-excludes` names them, with a comment above
each that says why.

## The editor hook

Claude Code runs both checks after each edit that the agent makes, through a
PostToolUse hook in `.claude/settings.json`. On a failure the hook prints the
message to the agent, so the agent splits the file or folder before the commit
reaches git.

## Why split along a deep module

The advice the checks print says to split a file along a deep module. It does
not say to cut the file by line count, to add pass-through wrappers, or to
write barrel files and a utils grab bag. Those give many shallow modules, and a
reader then opens all of them to follow one task. John Ousterhout, in
*A Philosophy of Software Design*, calls a module deep when a small interface
hides a lot of work. A deep module keeps that work behind a few functions, so a
reader needs only one module to follow the task. A folder that holds too many
entries splits the same way, by the concept its files share.

## Why the checks run twice

The whole-repo checks in `mise run lint` come first in pre-commit. A second,
narrower pair runs on the staged files. It predates the whole-repo checks and
stays, so a staged file over the limit is named on its own. CI's Lint job runs
`mise run lint` too, so the same checks gate a pull request. The files over the
limit are listed by `scripts/structure/check-file-size`, and the folders over it
by `scripts/structure/check-fan-out --all`.

## What a commit does past a limit

The commit fails. The output names each file over the limit with its token
count, or each folder over the limit with its count, and it prints the advice
above. To get past it, split the file or folder along a deep module, stage the
split, and commit again. Do not use `--no-verify`. A trim that leaves the file
over the limit fails too.

## Related

* [Code quality checks](/explanation/code-quality-checks.md): the checks that look at the code inside a file, which these limits do not
* [Run the checks](/how-to/run-the-checks.md): the hooks, and how to list the files and folders over a limit
* [mise tasks](/reference/mise-tasks.md): what `lint` runs
