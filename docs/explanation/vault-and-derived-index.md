---
type: Explanation
title: The vault and the derived index
description: Why the notes live on disk and Postgres is allowed to hold nothing that matters.
tags: [design, vault, database, data-model]
status: stable
---

# The vault and the derived index

kasten has one design rule, and the rest of the system falls out of it.

> The vault is a directory of `.md` files, and that directory is the source of
> truth. Postgres holds a derived index only. You must be able to drop the
> schema and rebuild it from the vault. Nothing that only exists in the
> database is allowed to matter.

## What that buys you

**Your notes outlive the software.** They are markdown files in a directory. If
kasten stops being maintained, or you stop liking it, you open the same files in
Obsidian, in vim, in anything. There is no export step because there is nothing
to export from.

**Backup is a solved problem.** Make the vault a git repository and push it.
That is backup and file history in one, and it costs nothing, because the vault
is already plain text. Nobody has to write a database dump job.

**The database is disposable.** `db:reset` throws away every row and you lose
nothing. That makes schema work cheap and takes the fear out of migrations.

**Two writers are possible.** Editing a file on disk and editing it through the
web page are the same operation, because the file is the thing. Sync tools,
scripts and other editors all keep working.

## What the index is for

Some questions are slow against a directory of files and fast against a
database: full-text search, the backlinks pointing at a note, every note
carrying a tag. That is what Postgres holds. Documents, links, tags,
search vectors, all derived.

The test for whether something belongs in the database is simple. If losing it
would lose information, it does not belong there. Note text, titles and the
links written inside a note are all recoverable by reading the vault again.
Anything you cannot recover that way has to go into a file.

## What follows from it

* `GET /api/files` reads the filesystem and does not consult Postgres at all. See [HTTP API](/reference/http-api.md).
* The vault is a bind mount to a host path in every environment, never a named Docker volume, so it survives the container lifecycle. See [Two environments](/explanation/environments.md).
* Dev and prod never point at the same directory. A dev bug that rewrites files would otherwise eat real notes.
* The vault path is configuration, not a constant. See [Configuration](/reference/configuration.md).

## What is not decided yet

How the index gets rebuilt: on startup, on a file watcher, on a command, or on
a schedule. Nothing indexes anything today, so the question has not had to be
answered. The rule above constrains the answer, though. Whatever does the
indexing must be able to run from an empty database against a full vault and
arrive at the same state.
