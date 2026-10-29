---
type: Explanation
title: The vault and the derived index
description: Why the notes live on disk, and Postgres holds nothing a note needs.
tags: [design, vault, database, data-model]
status: stable
---

# The vault and the derived index

kasten has one design rule, and the rest of the system falls out of it.

> The vault is a directory of `.md` files, and that directory is the source of
> truth. Postgres may hold a derived index only. You must be able to drop the
> schema and rebuild it from the vault. Nothing that only exists in the
> database is allowed to matter.

The rule has one exception, money. The `finance` schema is a system of record
and does not rebuild from the vault; [Finance in Postgres](/explanation/finance-in-postgres.md)
says why. Two small tables bend it too, the RSVP reading places and the
agent token record, as [below](#rsvp-reading-places). Everything else here
holds for the rest of Postgres.

## What that buys you

**Your notes outlive the software.** They are markdown files in a directory. If
kasten stops being maintained, or you stop liking it, you open the same files in
Obsidian, in vim, in anything. There is no export step because there is nothing
to export from.

**Backup is a solved problem for notes.** Make the vault a git repository and
push it. That is backup and file history in one, and it costs nothing, because
the vault is already plain text. The notes need no database dump job; the
`finance` schema does, and has one, as
[Finance in Postgres](/explanation/finance-in-postgres.md#what-backing-up-now-means)
and [Back up and restore](/how-to/back-up-and-restore.md#the-finance-dump-on-the-maintainers-server)
say.

**The database is disposable, for notes.** `db:reset` throws away every row and
you lose no notes. You do lose the `finance` rows, which nothing rebuilds, and
the RSVP reading places and the agent token record described below. On a dev
database those are test data, so schema work stays cheap there and migrations
lose their fear.

**Two writers are possible.** Editing a file on disk and editing it through the
web page are the same operation, because the file is the thing. Sync tools,
scripts and other editors all keep working.

## What the index is for

Some questions are slow against a directory of files and fast against a
database: full-text search, the backlinks pointing at a note, every note
carrying a tag. An index of the vault would be for those, and would hold
documents, links, tags and search vectors, all derived.

Postgres holds one such index now: the [pieces index](/explanation/models-on-the-vps/the-pieces-index.md),
the first derived index kasten has. It cuts each note into pieces, with a
bge-m3 vector and a BM25 index for each. It passes the test: drop it, rebuild
it from the vault, and the rows come out the same. No search reads it yet.
Search still runs ripgrep over the notes on every query, which at 10,000 notes
takes under 20ms and cannot go stale. The backlinks panel is a search for the
note's name, and the tag list reads the notes too. See
[What is not decided yet](#what-is-not-decided-yet).

The test for whether something belongs in the database is simple. Outside
`finance` and the two tables below, if losing it would lose information, it
does not belong there. Note text, titles and the
links written inside a note are all recoverable by reading the vault again.
Anything you cannot recover that way has to go into a file.

## RSVP reading places

Outside `finance`, Postgres holds two tables the vault cannot rebuild:
`rsvp_places`, from migration `0006`, and `token_action`, from migration `0012`
([below](#the-agent-token-record)). The `rsvp_places` table holds, for each file an RSVP run stopped in, the word it stopped at,
the length of the word list then, and a few words to find the place again.

It lives in the database and not in the note's frontmatter because a run saves
on every pause. A frontmatter write is a jj change, so each pause would add one
to the note's history, and a PDF or a book has no frontmatter to write to.

The rule bends here because the loss is small, unlike finance's. Drop the table and you lose
where each run stopped, and nothing else: no note, no link, no word you wrote.
The next run starts at the top of the file. See
[HTTP API: RSVP](/reference/http-api/rsvp.md).

## The agent token record

The `token_action` table holds one row for each request an agent token makes
under `/agent/`, except the sign-in under `/agent/oauth/`: when, from where,
what it asked for and what it got back. It came with #1197;
until then `rsvp_places` was the only table outside `finance` the vault could
not rebuild. A row is never written to the vault, so that no agent reading
notes can search it, and rows older than 90 days are deleted.

Drop the table and you lose the request record each token shows on `/tokens`:
when it was last used and what it did. The tokens themselves live in
`tokens.json` and keep working. See
[What kasten records](/how-to/connect-an-agent.md#what-kasten-records).

## What follows from it

* `GET /api/files` reads the filesystem and does not consult Postgres at all. See [HTTP API](/reference/http-api.md).
* The history of a note lives with the note, in a jj repo inside the vault, and not in a table. A version you cannot recover by reading the vault again would be information the database alone held, which the rule does not allow for notes. See [Recover an earlier version of a note](/how-to/recover-an-earlier-version.md).
* The vault is a bind mount to a host path in every environment, never a named Docker volume, so it survives the container lifecycle. See [Two environments](/explanation/environments.md).
* Dev and prod never point at the same directory. A dev bug that rewrites files would otherwise eat real notes.
* The vault path is configuration, not a constant. See [Configuration](/reference/configuration.md).

## What is not decided yet

Whether search, backlinks and tags move into the index. The pieces index
answers how it gets rebuilt: a sweep on startup, then the file watcher, as
[The pieces index](/explanation/models-on-the-vps/the-pieces-index.md) says. The rule above still
applies to whatever comes next. Whatever does the indexing must be able to run
from an empty database against a full vault and arrive at the same state.
