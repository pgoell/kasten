---
type: Explanation
title: The file size limit
description: Why an authored file stays under 5,000 tokens, why the check counts bytes, and why a file over the limit is split along a deep module.
tags: [design, docs, lint, git-hooks]
status: stable
---

# The file size limit

An authored file stays under 5,000 tokens. `scripts/file_size.py` checks it, and
the pre-commit hook runs the check on the files a commit stages. This page says
why the limit exists and what to do when a commit trips it. For the commands,
see [Run the checks](/how-to/run-the-checks.md).

## Why a cap

An agent reads a file in pieces when the file is too big to take in at once.
Each piece costs a turn, and by the last piece the agent has lost track of what
the first one said. Under the cap, the agent reads the whole file and edits
it without a second read. The cap keeps every file small enough for that.

## Why bytes divided by four

A token is roughly four bytes of English or code. Counting bytes needs no
tokenizer, so the script needs no install and gives the same answer on every
machine. It compares bytes, not the rounded token count, so a file of 20,001
bytes is over the limit even though it rounds down to 5,000 tokens. The number
is a guard, not a measure. It is close enough to catch a file that is too big,
and cheap enough to run on every commit.

## What is excluded

The script skips only what nobody writes by hand: lock files (`uv.lock`,
`bun.lock`, `mise.lock`), the generated API types, OpenAPI file and route tree,
images (PNG, JPEG, GIF, WebP, SVG, ICO), fonts (WOFF, WOFF2, TTF, OTF), PDFs,
EPUBs and `LICENSE`. The list is one plain list in the script, with no per-file
exceptions. A file that needs an exception should be split instead.

## Why split along a deep module

The advice the script prints says to split a file along a deep module. It does
not say to cut the file by line count, to add pass-through wrappers, or to
write barrel files and a utils grab bag. Those give many shallow modules, and a
reader then opens all of them to follow one task. John Ousterhout, in
*A Philosophy of Software Design*, calls a module deep when a small interface
hides a lot of work. A deep module keeps that work behind a few functions, so a
reader needs only one module to follow the task.

## Why the hook checks staged files first

The hook runs the check on the files a commit stages, so a commit fails fast
when it stages any file over the limit, whether that file was already over or is
new or has grown past it. `mise run lint` checks every tracked file. Pre-commit
runs it too, and so does CI's Lint job, so a file over the limit anywhere in the
tree fails the gate. The list of files over the limit is in
`python3 scripts/file_size.py`.

## What a commit that stages a big file does

The commit fails. The output names each file over the limit with its token
count, and it prints the advice above. To get past it, split the file along a
deep module, stage the split, and commit again. Do not use `--no-verify`. A trim
that leaves the file over the limit fails too.

## Related

* [Run the checks](/how-to/run-the-checks.md): the hooks, and how to list the files over the limit
* [mise tasks](/reference/mise-tasks.md): what `lint` runs
