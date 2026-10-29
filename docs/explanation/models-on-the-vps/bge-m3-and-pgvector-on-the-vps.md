---
type: Explanation
title: bge-m3 and pgvector on the VPS
description: How fast bge-m3 embeds a query and the vault on the VPS's CPU, measured at four piece lengths, and what pgvector needs on the shared postgres.
tags: [search, embeddings, pgvector, research]
status: draft
---

# bge-m3 and pgvector on the VPS

[Semantic search models](/explanation/models-on-the-vps/semantic-search-models.md)
compares embedding models for #954 and says what kasten would build. This
page holds the two parts it rests on: bge-m3 measured on the VPS after
pgoell asked how fast its queries and indexing would be, and what pgvector
needs on the shared postgres. Nothing here is built.

## bge-m3 measured on the VPS

Run on 2026-10-28 on the VPS, beside the live services: bge-m3's own fp32
ONNX export (`onnx/` in `BAAI/bge-m3` [L2]) under onnxruntime 1.31.1 on Python 3.12 (it ships wheels for the
backend's 3.14 too), 8 of
the 16 threads, at `nice 19`. The load average stood at 8 to 10 from the
other containers throughout, so an idle machine would do somewhat better.
The pieces are real vault text outside the flashcards, cut to a fixed length.
Nothing went into kasten or its database.

**Model.** Loading takes 1.8 s and 1.6 GB of RAM. In the backend it would load
once at start.

**A query.** A typed query is 9 to 14 tokens.

| Step | p50 | p95 |
|---|---|---|
| Tokenize | 0.02 ms | |
| Embed with bge-m3 (200 runs, German and English) | 45 ms | 53 ms |
| Nearest 20 of 3,500 pieces, pgvector exact scan | 11 ms | 17 ms |
| Nearest 20 of 3,500 pieces, pgvector HNSW | 1.1 ms | 1.2 ms |
| Nearest 20 of 3,500 pieces, numpy in the backend | 3 ms | 7 ms |
| **Whole query, embed and exact scan** | **≈56 ms** | **≈70 ms** |

So a search by meaning answers in well under a tenth of a second, and the
model, not the vector search, takes most of it. The vector search used a
throwaway `pgvector/pgvector:pg17` container (pgvector 0.8.7, 4 CPUs) with
random unit vectors: their count and width set the time, not their content.
Ten times the pieces (35,000) still answers in 157 ms exact or 3.7 ms with
HNSW, whose build then takes 172 s and 461 MB.

**Indexing.** The bge-m3 tokenizer counts 2.08M tokens outside the
flashcards, more than the 1.7M estimated above. Throughput falls as pieces
grow, because attention costs grow with the square of their length:

| Piece length | Batch | Tokens a second | Whole vault without flashcards | Peak RAM |
|---|---|---|---|---|
| 512 | 8 | 676 | **51 min** | 2.2 GB |
| 1,024 | 4 | 533 | 65 min | 3.1 GB |
| 2,048 | 2 | 375 | 1.5 h | 4.3 GB |
| 8,192 | 1 | 149 | 3.9 h | 13 GB |

Each row ran 32,000 to 49,000 tokens and the vault time extrapolates from
it; the 8,192 row rests on four pieces, so read it as rough. The estimate
above (1.0 to 3.1 h) was too slow for short pieces and about right for whole
notes.

What this means for kasten:

* **Use 512-token pieces.** Feeding bge-m3 whole notes of up to 8,192 tokens
  is four times slower a token and needs six times the RAM. Short pieces also
  point a hit at the part of a note that matched.
* **The first pass is about an hour,** once, in the background, while
  ripgrep search keeps working. At 512 the vault makes about 4,000 to 5,000
  pieces, 46 MB in pgvector.
* **Keeping up is cheap.** Saving a median note (≈1,050 tokens, three pieces)
  re-embeds in 2 to 3 s. A busy week's 0.38M changed tokens is about ten
  minutes of work, less with re-embeds driven by a hash of each piece.
* **No vector index is needed** at this size: the exact scan takes 11 ms.
  HNSW pays off past tens of thousands of pieces.

The two benchmark scripts and their raw output are in a comment on #1260.

## pgvector on the shared postgres

kasten_prod lives in the shared `postgres` container, defined in
`~/Code/server-infra/docker-compose.yml` as `postgres:17-alpine` (PostgreSQL
17.11). That image does not ship pgvector: `pg_available_extensions` has no
`vector` row today. Dev runs the same image from this repo's `compose.yaml`.
This page changes neither.

What it would take:

* **Version.** pgvector 0.8.7, released 2026-10-01, supports PostgreSQL 13
  and up [V1][V2].
* **Image.** Either `pgvector/pgvector:pg17`, which is Debian and glibc
  [V3], or an image `FROM postgres:17-alpine` that builds pgvector from
  source (`make`, `make install`) [V2]. Moving the existing data directory
  from alpine (musl) to Debian (glibc) changes how text sorts under a libc
  collation, so every such text index needs a `REINDEX` first, or a lookup
  can miss rows that are there [V4]. The alpine build keeps the data
  directory as it is. The change goes through the server-infra repo, and the
  dev compose here needs the same image.
* **Extension.** `CREATE EXTENSION vector;` once in kasten_prod [V2].
* **Column and index.** `vector(1024)` for bge-m3 or Mistral, `vector(1536)`
  for OpenAI. An HNSW index with `vector_cosine_ops`: it needs no training
  data and keeps up with rows that change, where IVFFlat must be built after
  the data is in [V2]. HNSW indexes `vector` up to 2,000 dimensions and
  `halfvec` up to 4,000, so 3-large's 3,072 needs `halfvec` [V2]. At this
  vault's size an exact scan with no index is fast enough: 11 ms over 3,500
  rows, measured in [bge-m3 measured on the VPS](#bge-m3-measured-on-the-vps).

## Sources

* [L2] [BAAI/bge-m3 model card](https://huggingface.co/BAAI/bge-m3)

pgvector:

* [V1] [pgvector changelog](https://github.com/pgvector/pgvector/blob/master/CHANGELOG.md)
* [V2] [pgvector README](https://github.com/pgvector/pgvector)
* [V3] [pgvector image tags](https://hub.docker.com/r/pgvector/pgvector/tags?name=pg17) and [its Dockerfile](https://github.com/pgvector/pgvector/blob/master/Dockerfile)
* [V4] [PostgreSQL wiki, locale data changes](https://wiki.postgresql.org/wiki/Locale_data_changes)
