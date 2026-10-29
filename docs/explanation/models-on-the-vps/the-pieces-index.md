---
type: Explanation
title: The pieces index
description: How the pieces index follows the vault, why a save embeds only what changed, and what the indexer does when something fails.
tags: [search, embeddings, pgvector, database, indexer]
status: stable
---

# The pieces index

Postgres holds a derived index of the vault: the pieces index. Each note is cut
into pieces, and each piece has a bge-m3 vector and a BM25 index beside its text.
[Semantic search models](/explanation/models-on-the-vps/semantic-search-models.md)
picked the models and the BM25 extension, and
[bge-m3 and pgvector on the VPS](/explanation/models-on-the-vps/bge-m3-and-pgvector-on-the-vps.md)
measured them. No search reads the index yet. The ranked search comes in a later
part of [#954](https://github.com/pgoell/kasten/issues/954).

## What is in it

Two tables, both made by migration `0013`, which also installs the pgvector and
pg_textsearch extensions:

* `piece_notes` holds each note's path and the sha256 of its bytes, as the indexer last read them.
* `pieces` holds each piece's note path, its place `n` in the note, its heading path, the sha256 of its text, the text, and the 1,024-dimension bge-m3 vector.

Two BM25 indexes sit on `pieces.text`, one with the German text configuration and
one with the English, since a note may mix the two.

A note is cut at its headings first. A section longer than about 512 bge-m3 tokens
is cut again into windows that overlap by 64 tokens, so a sentence on an edge is
whole in one of them. Each piece starts with the note's title and heading path,
such as `Steuer 2025 > Kapitalerträge`, then a blank line, then the text. A piece
above the first heading starts with the title alone. Frontmatter is left out. A
`#` line inside a code fence is code, not a heading.

## Why it can be dropped

The index is derived. Drop it, and the backend builds it again from the vault. The
split and the model are deterministic, so the rebuilt rows match the old ones. That
passes the test in
[The vault and the derived index](/explanation/vault-and-derived-index.md#what-the-index-is-for),
and [Rebuild the pieces index](/how-to/back-up-and-restore.md#rebuild-the-pieces-index) shows how.

## How it follows the vault

On start, a sweep reads every note and compares its sha256 with `piece_notes`. Only
the notes that differ are indexed. A note in `piece_notes` that is no longer in the
vault is dropped.

After that, the backend's own file watcher reports each note written or removed,
whoever did it: the API, Obsidian, jj or a shell. The watcher runs whether or not a
browser is open. A folder move reports no note, only a listing, and the listing
starts another sweep. A note the watcher reports goes before the rest of a sweep, so
a save made during the first hour of indexing is in the index within seconds.

## Why a save embeds little

Pieces are matched by the sha256 of their text, across all notes. A save embeds only
the pieces whose text changed, and the rest keep their vectors.

A folder move embeds nothing, because the title and headings in front of each piece
are the same at the new path. A rename embeds again, because the title is in front
of every piece.

## When it stops

A note that fails, on a model error or a row the database refuses, is logged and
skipped until the next sweep. A model that will not load, or a database that fails,
stops the indexer with one warning, and the backend keeps serving. The next start
sweeps again and catches up.

## Where the model runs

The indexer runs only when `KASTEN_EMBED_MODEL_DIR` names a folder that holds
bge-m3's ONNX export. It is off by default, since the model is 2.2 GB. The model
loads once, at start, on a thread of its own, at nice 19 with eight onnxruntime
threads, so embedding never holds a request up.

`KASTEN_PIECES_SKIP` leaves one folder out. Prod sets it to the flashcards: a deck is
hundreds of one-line cards, which would crowd every search and take an hour to
embed. A note already indexed in that folder is dropped at the next sweep. The
settings are in [Configuration](/reference/configuration.md#kasten_embed_model_dir).
