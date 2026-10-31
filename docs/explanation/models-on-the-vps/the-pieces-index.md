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
measured them. The ranked search reads it
([`GET /api/ranked`](/reference/http-api/finding.md#get-apiranked), and the
finder on `<leader>fm`); "notes like this one" comes in a later part of
[#954](https://github.com/pgoell/kasten/issues/954).

## How the ranked search reads it

Three lists of 50 pieces each: BM25 through the `german` index, BM25 through the
`english` one, and the nearest vectors by cosine distance. Reciprocal rank
fusion sums `1 / (60 + rank)` over the lists a piece is in, and a note takes its
best piece. A word both stemmers match counts twice; that is the price of
guessing no language.

The vector list takes only pieces nearer than cosine distance 0.5, so a query
the vault does not answer lists no notes instead of twenty faint ones (#1341).
On a copy of the live index (6,562 pieces, 2026-10-31) the real hits of 16
queries lay at 0.29 to 0.50 and the nearest piece of 12 queries about nothing
in the vault at 0.51 to 0.66, so the floor cuts through a thin band. A lone
German compound pays for it: `Flitterwochen` sits 0.54 from the honeymoon notes
and finds none, while `Japan Flitterwochen` finds them by its words. A BM25 hit
stays whatever its distance. `GET /api/similar`, behind the margin's list of
notes like the open one, takes no floor: it ranks the ten nearest, however far.

The query is embedded on a thread of its own over the indexer's loaded model,
never on the event loop. It once shared the indexer's thread and waited 12.7 s
behind the first fill's batches; onnxruntime runs one session from two threads,
and a query now took 85 to 160 ms while the dev vault was still filling. Until the
model has loaded, the words rank alone and the answer says so. pg_textsearch
sees which index a query names only when the query and the index name are
constants in the SQL and the scan is not inside a subquery, so the backend
writes both inline, quoted by SQLAlchemy.

On a copy of the live index (6,321 pieces of 585 notes, 2026-10-29), a query
took about 300 ms with the model idle: 80 to 140 ms to embed, 140 to 230 ms of
SQL, most of that the vector scan. Words alone took 6 to 56 ms.

Migration `0014` added an HNSW index on the vectors (#1340). On a copy of 6,562
pieces (2026-10-31), over 24 German and English queries, the vector query fell
from 94.5 ms to 2.7 ms at the median and from 103 to 3.1 ms at p95, and every
piece the exact scan found within the floor came back (659 of 659). Three things
make the planner take the index, and each one alone sends it back to scanning
every row:

* The query takes the nearest 50 in a subquery and applies the 0.5 floor
  outside it. With the floor in the same `WHERE`, the planner guesses a third of
  the table passes and scans it.
* The `LIMIT` is a constant. psycopg prepares a statement it runs often, and a
  generic plan with `LIMIT $1` scans the table too.
* `hnsw.ef_search` is 200 for the query's transaction. At pgvector's default of
  40, below the 50 the query asks for, the planner never takes the index; forced
  onto it, the index returned 13 to 40 rows, the archive filter cutting the rest.
  `hnsw.iterative_scan = strict_order` keeps walking past archived pieces until
  50 remain.

The index takes 51 MB and builds in 1.3 s on that copy, within the default 64 MB
of `maintenance_work_mem`. Rewriting a note's pieces costs about 1 ms more a
piece with it in place, far below the time bge-m3 takes to embed one.
`GET /api/similar` pairs every piece of a note with every other piece, which no
index serves, so it answers as before.

## What is in it

Two tables, both made by migration `0013`, which also installs the pgvector and
pg_textsearch extensions:

* `piece_notes` holds each note's path and the sha256 of its bytes, as the indexer last read them.
* `pieces` holds each piece's note path, its place `n` in the note, its heading path, the sha256 of its text, the text, and the 1,024-dimension bge-m3 vector.

Two BM25 indexes sit on `pieces.text`, one with the German text configuration and
one with the English, since a note may mix the two.
An HNSW index with `vector_cosine_ops`, from migration `0014`, sits on
`pieces.embedding`.

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

A note that fails on a model error or a row the database refuses is logged and
skipped until the next sweep. A model that will not load, or any other database
error such as a missing table, stops the indexer with one warning, and the backend
keeps serving. Any other error that ends it logs an error line with its
traceback, and a shutdown logs nothing. The next start sweeps again and catches up.

A lost database connection, a full connection pool or too many connections (which
shows for a moment after a Postgres restart) does not stop it. The indexer waits,
retrying after 1 second and doubling up to 60, then sweeps. So a Postgres restart
needs no backend restart: saves made in the outage reach the index. Saves the
watcher reports in the meantime wait in memory, and a backend shutdown ends the
wait at once.

A vault watcher that fails, at an inotify limit or with the vault folder gone, does
not stop it either. The indexer logs one line, starts the watcher again after the
same wait, and sweeps after each start, so a save no watcher saw still reaches the
index, at most a minute late while the fault lasts. A sweep that finds no vault
folder drops nothing, so a remount re-embeds nothing. A watcher fault of any other
kind ends the indexer with its error line.

A log line about a database error names the driver's first line only: the
statement, its values and Postgres's failing row would put a note's text and
vectors in the log.

## Where the model runs

The indexer runs only when `KASTEN_EMBED_MODEL_DIR` names a folder that holds
bge-m3's ONNX export. It is off by default, since the model is 2.2 GB. The model
loads once, at start, on a thread of its own, at nice 19 with eight onnxruntime
threads, so embedding never holds a request up.

`KASTEN_PIECES_SKIP` leaves one folder out. Prod sets it to the flashcards: a deck is
hundreds of one-line cards, which would crowd every search and take an hour to
embed. A note already indexed in that folder is dropped at the next sweep. The
settings are in [Configuration](/reference/configuration.md#kasten_embed_model_dir).
