---
type: Explanation
title: Semantic search models
description: Which embedding model gives kasten search by meaning and "notes like this one", local or a paid API, what each costs for the live vault and how each reads German; pgoell picked local bge-m3 and BM25, and the page ends with what kasten would build and which BM25 extension Postgres needs.
tags: [search, embeddings, pgvector, research]
status: draft
---

# Semantic search models

[#954](https://github.com/pgoell/kasten/issues/954) asked for search by meaning
in the finder and for agents, and a "notes like this one" list beside the
backlinks. All three are built now. Each needs a model that turns a note into
a vector; notes whose vectors lie close mean similar things. This page is the
comparison the issue asked for before pgoell picked one, and the answer: local
bge-m3, and a hybrid search with BM25.

Figures come in three kinds. **Cited** ones link their source. **Estimated**
ones say so and show the sum. **Measured** ones come from bge-m3 run on the
VPS, in [bge-m3 and pgvector on the VPS](/explanation/models-on-the-vps/bge-m3-and-pgvector-on-the-vps.md).
The other models were not run.

## What kasten had before the build

There is no search index. `search.py` runs ripgrep over the vault on every
query and touches no table: a fixed-string, case-insensitive match capped at
2,000 lines. The finder's content search calls `GET /api/search` and ranks
the lines in the browser; its note finder ranks paths with a fuzzy scorer and
never reads content. The agents' `search_notes` (MCP, and `GET /agent/search`
over HTTP) is the same scan with no ranking. Backlinks are a search for the
note's name; unlinked mentions come from `GET /api/mentions`. A "notes like
this one" list would be a third query beside those two in the note's search
panel.

So the issue's "same event path as the full-text index" does not exist yet.
The file watcher (`events.py`, watchfiles, 100 ms debounce) only tells open
editors that a file changed, and the backend runs no indexer.
[The vault and the derived index](/explanation/vault-and-derived-index.md)
left open how an index would be rebuilt (on startup, on a watcher, on a
command or on a schedule). Embeddings would be kasten's first derived index,
and they have to answer that question.

## The vault and the machine

Measured read only on 2026-10-28 with `rg --files`, `wc` and `find`:

| | Notes | Words | Bytes | Tokens (estimate) |
|---|---|---|---|---|
| Whole vault | 606 | 1,938,549 | 16.3 MB | ≈4.9M |
| Kanji flashcards (`04 Ressources/05 Flashcards`) | 29 | 965,508 | 9.4 MB | ≈3.1M |
| Everything else | 577 | 973,041 | 6.9 MB | ≈1.7M |

Tokens are estimated, not counted: bytes divided by four for the German and
English prose, and one token per character (three bytes) for the Japanese.
Each vendor's tokenizer will land somewhat off, so the times and costs below use a round 5.0M for the whole vault. Outside the flashcards the
median note is 4.2 KB (≈1,050 tokens) and the 90th percentile 30.7 KB (≈7,700
tokens); 382 notes run past 512 tokens and 55 past 8,192.

The 29 flashcard notes hold about 64% of the tokens, and they are lists of
kanji: what a reader looks up there is a character, which ripgrep already
finds. This page gives every time and cost for the whole vault and for the
vault without them, and the recommendation leaves them out.

**Rate of change.** Files changed in the last 7 days, outside the flashcards:
115 notes, ≈0.38M tokens. In the last 30 days: 481 notes, ≈1.5M tokens. The
30-day figure is inflated: mtime counts bulk rewrites too (52 notes share
2026-09-29 and 43 share 2026-10-05). This page uses 1.5M tokens a month as an
upper bound. A built version should re-embed on a hash of the note's text,
not on mtime, so a rewrite that changes nothing costs nothing.

**The VPS.** `nproc` 16: an AMD Ryzen 7 3700X, 8 cores and 16 threads, AVX2
and no AVX-512, no GPU. `free -h`: 62 GiB total, 44 GiB available, 8.4 GiB
free beside 40 GiB of page cache. The backend container has no memory limit
and runs one uvicorn worker, so a local model would be loaded once.

## Local models

Three models that run on CPU inside the backend container. All three read
German, English and Japanese.

| | multilingual-e5-base | bge-m3 | embeddinggemma-300m |
|---|---|---|---|
| Hugging Face id | `intfloat/multilingual-e5-base` | `BAAI/bge-m3` | `google/embeddinggemma-300m` |
| License | MIT [L1] | MIT [L2] | Gemma terms, gated [L3][L4] |
| Parameters | 278M [L5] | 568M, derived from the fp32 size [L5] | 303M [L5] |
| Size, fp32 | 1.11 GB [L5] | 2.27 GB [L5] | 1.21 GB [L5] |
| Dimensions | 768 [L1] | 1024 [L2] | 768, cut to 512/256/128 [L3] |
| Input limit | 512 tokens [L1] | 8,192 tokens [L2] | 2,048 tokens [L3] |
| RAM at run time (estimate) | 1.8 to 2.5 GB | 3 to 4 GB | 1.9 to 2.6 GB |
| Whole vault, 5.0M tokens (estimate) | 53 min to 2.6 h | 3.0 to 9.0 h | 1.1 to 3.3 h |
| Without flashcards, 1.7M (estimate) | 18 to 53 min | 1.0 to 3.1 h | 22 min to 1.1 h |
| One median note, 1,050 tokens (estimate) | 0.7 to 2.0 s | 2.3 to 6.8 s | 0.8 to 2.5 s |
| MMTEB, multilingual mean | 57.0 [Q1] | 59.6 [Q2] | 61.2 [L3] |
| German retrieval, MIRACL `de` nDCG@10 | 53.0 [Q3] | **57.6** [Q3] | 56.6 [Q3] |

The time and RAM rows are estimates for all three. For bge-m3,
[the measurement on the VPS](/explanation/models-on-the-vps/bge-m3-and-pgvector-on-the-vps.md) replaces them:
51 minutes and 2.2 GB without flashcards at 512-token pieces.

**License.** e5 and bge-m3 state MIT on their cards; bge-m3's repo has no
LICENSE file, so the card header is the only statement. EmbeddingGemma is
gated behind Google's Gemma terms, which bind every use to a prohibited use
policy, let Google "restrict (remotely or otherwise) usage", and must travel
with any copy [L4]. That is not an open license.

**How the times were estimated.** No published benchmark runs these models
on a Ryzen with a stated text length, so every time above comes from
arithmetic: about two floating point operations per non-embedding parameter per token (the vocabulary table is a lookup), plus
attention, gives ≈190 MFLOP a token for e5-base, ≈240 for EmbeddingGemma and
≈650 for bge-m3. The 3700X peaks near 920 GFLOPS in fp32; the estimate
assumes 100 to 300 GFLOPS in practice. A measured run of the larger
Qwen3-Embedding-0.6B on an Intel i7-13700H works out at about 90 GFLOPS
[Q4], the low end of that range. For bge-m3 over the whole vault:
5.0M × 650 MFLOP = 3.25 PFLOP, which is 3.0 h at 300 GFLOPS and 9.0 h at 100.
RAM is the fp32 weights, about 0.4 GB for the Python runtime [Q4] and 0.3 to
1 GB of working memory for a batch of 512-token pieces: derived, not measured.

**Runtime and image.** Each runs under sentence-transformers on torch, or
under onnxruntime from an ONNX export. The CPU torch wheel for Python 3.14 is
a 184 MB download [R1], several times that installed; onnxruntime is 24 MB
[R2]. An ONNX bge-m3 export exists in fp32 [R3]; its author found that int8
cost quality and ships fp32 only.

**A caveat on the German scores.** bge-m3 and multilingual-e5 list MIRACL's
training data among their fine-tuning sets [L1][Q7], which may favour them on
this test, and bge-m3 leads EmbeddingGemma by one point. Read the German row
as a rough order, not a ranking.

**Dropped:** `Qwen/Qwen3-Embedding-0.6B` (Apache-2.0) has the best MMTEB mean
of the lot, 64.3 [Q2], but a lower German score (54.2 [Q3]) than bge-m3 and
the highest cost on a CPU. `multilingual-e5-small` (118M parameters, 384
dimensions) is the fastest choice, at 50.8 on German [Q3].

## Paid APIs

Each of these sends note text to a company's servers. Prices are standard
rates in US dollars; costs are the price times the token estimates above.

| | OpenAI `text-embedding-3-small` | Mistral `mistral-embed` | Voyage `voyage-4-large` |
|---|---|---|---|
| **MONEY**, per 1M tokens | **$0.02** [P1] | **$0.10** [P3] | **$0.12** [P5] |
| Whole vault once, 5.0M | $0.10 | $0.50 | $0.60 |
| Without flashcards, 1.7M | $0.03 | $0.17 | $0.20 |
| Per month, 1.5M | $0.03 | $0.15 | $0.18 |
| Free tier | none found | not stated | 200M tokens per voyage-4 model [P5] |
| Dimensions | 1,536 [P2] | 1,024 [P4] | 1,024 by default [P6] |
| Input limit | 8,192 [P2] | 8,192 [P3] | 32,000 [P6] |
| Company | OpenAI, USA | Mistral AI, France | Voyage AI (MongoDB), USA |
| Benchmark | MTEB 62.3 (old English MTEB, vendor) [P2] | MTEB retrieval 55.3 (vendor, 2023) [P4] | vendor RTEB: ahead of OpenAI v3 large by 14% [P7] |

With Voyage's free tokens the vault could be embedded forty times before the
first bill. `text-embedding-3-large` costs $0.13 per 1M tokens [P1]: $0.65
for the whole vault, $0.20 a month.

**What leaves the machine.** The text of every note embedded, and on every
change the text of that note again, plus every search query.

* **OpenAI** does not train on API data. It keeps it up to 30 days for abuse
  monitoring. EU processing exists for both text-embedding-3 models and needs an
  approved retention control (zero retention or modified abuse
  monitoring); the 10% surcharge applies only to models released from
  March 2026, so not to these [P1][P8].
* **Mistral** hosts in the EU by default [P9]. Its data processing addendum
  allows training on customer data unless the customer opts out, so the
  opt-out has to be switched on [P10].
* **Voyage** trains on API data **by default**. The opt-out is an admin
  toggle that needs a payment method on file; then it keeps nothing [P11].
  No EU region is named.

**German.** None of the three vendors publishes a German score. Voyage calls
voyage-4 multilingual [P6]; OpenAI and Mistral list no languages. OpenAI's
launch post gives 3-small a MIRACL mean of 44.0 over its languages [P12],
well under bge-m3's German 57.6. Before choosing an API, check its German
tasks on the MMTEB leaderboard [Q6].

## Why bge-m3

German decides it: the vault's prose is German and English, and bge-m3 has
the best published German retrieval score here; no API publishes one. A
local model also keeps every note on the VPS. Speed only says it is usable:
a query takes about 56 ms, the first pass without flashcards about 51
minutes, in 2.2 GB. It does not pick bge-m3 over e5-base: bge-m3 is the
slowest of the three, and at 512-token pieces its 8,192-token window no
longer counts. It runs under onnxruntime, not torch.

## What kasten would need

pgoell approved local bge-m3 on #1260 (2026-10-28) and answered the open
points on 2026-10-29: "I'd like to go with bm25, otherwise i agree with all
suggestions and the 64 token overlap". So the plan is:

* **Pieces.** Split each note by heading, then by length to about 512
  tokens, with a 64-token overlap between neighbouring pieces. At 512 a
  median note becomes two or three pieces.
* **A prefix.** Before embedding, each piece gets the note's title and its
  heading path in front (`Steuer 2025 > Kapitalerträge > Freibetrag`), so a
  piece cut out of its note still says what it is about.
* **What stays.** The fuzzy path finder and the ripgrep exact search stay as
  they are.
* **A new ranked search, hybrid.** BM25 full text and bge-m3 vectors over the
  same pieces, each giving a ranked list, fused by reciprocal rank fusion
  (each piece scores the sum of `1 / (60 + rank)` over the lists). BM25
  finds the exact word, a name or a number; the vectors find the meaning.
* **"Notes like this one"** uses the vectors only: the note's own pieces
  against everyone else's.
* **bge-m3's sparse weights** (its third output, one weight a token) stay an
  option, not a plan. BM25 covers the same ground with less to build.
* **A table that can be thrown away:** note path, piece number, heading path,
  a hash of the piece's text, its text for BM25, the vector. Dropping it and
  rebuilding from the vault gives the same rows, as
  [the one rule](/explanation/vault-and-derived-index.md) asks.
* **The event path.** Re-index a note's pieces after a write through the
  API, after a file change seen by the watcher (Obsidian, jj, the shell), and
  once on startup for anything whose hash differs. The startup sweep makes
  the other two safe to miss.
* **The flashcards** stay out by path until someone asks for them.

### BM25 in Postgres

Postgres's own `ts_rank` counts matches but is not BM25: it knows nothing of
how rare a word is across the vault or how long a piece is. BM25 needs an
extension. Prod today runs `postgres:17-alpine` (PostgreSQL 17.11, musl) in
the shared `postgres` container from `~/Code/server-infra/docker-compose.yml`,
with no pgvector and no BM25 extension; dev runs the same image from this
repo's `compose.yaml`. Every license below was read from the project's
LICENSE file.

| | pg_textsearch | ParadeDB pg_search | VectorChord-BM25 | plpgsql_bm25 |
|---|---|---|---|---|
| License | PostgreSQL License [B1] | **AGPL-3.0** [B4]; paid Enterprise adds index replication [B5] | **AGPLv3 or ELv2**, your pick of two restrictive ones [B8]; its tokenizer is Apache-2.0 [B9] | Unlicense, public domain [B11] |
| PG17, beside pgvector | Yes, PG 17 and 18; preload [B2] | Yes, PG 15 to 18; preload; needs pgvector since 0.25 [B6] | Yes, PG 14 to 18 [B10] | Yes, plain SQL functions [B11] |
| Prod image change | Off alpine to Debian, or a source build on alpine (plain C `make`, untried on musl) [B2] | Off alpine: `paradedb/paradedb` is `FROM postgres:17-trixie` with pgvector 0.8.6 [B7] | Off alpine: glibc packages and the `vchord-suite` image only [B10] | None |
| German and English | Postgres text configs, one per index: `german`, `english`, `simple` [B2] | Snowball stemmers for both, stopwords for both at once, ICU tokenizer [B6] | Tested on English only; no German stopword list built in [B9] | German stopwords, no stemming [B11] |
| Cost per note save | Write goes to a memtable, spills into segments merged in line; REINDEX if update-heavy work fragments it [B2][B3] | Mutable segment of 1,000 rows, background merges, 15 MB `work_mem` a write [B6] | Growing segment, sealed later; merges not documented [B10] | Rebuild on change (unverified) [B11] |
| Maintained | v1.5.1, 2026-10-02, active [B1] | v0.26.3, 2026-10-22, very active [B4] | 0.3.0, 2025-12-15; tokenizer quiet since 2025-09 [B8][B9] | Small one-person project [B11] |

Also looked at: PGroonga has an alpine image but scores by TF-IDF, not
BM25 [B12]; ZomboDB is archived and needs Elasticsearch.

**Pick: pg_textsearch.** It is the one real BM25 index under a permissive
license with no paid tier, it is maintained, it runs on PG17 beside pgvector,
and it uses the stemmers Postgres already has for German and English.
ParadeDB tokenises better, but it is AGPL with a paid tier, and its write
path is heavier than one user needs. VectorChord-BM25 is AGPL or ELv2 and
only tested on English. plpgsql_bm25 needs no image change but would rebuild
on every save. Costs no money.

What the pick asks of prod, in the server-infra repo, not here:

* **An image** with pgvector and pg_textsearch: a source build of both
  `FROM postgres:17-alpine` keeps the data directory as it is; if
  pg_textsearch will not build on musl, `pgvector/pgvector:pg17` (Debian)
  plus pg_textsearch, and then a `REINDEX` of every text index in every
  database on the container before use, since glibc sorts text differently
  from musl ([bge-m3 and pgvector on the VPS](/explanation/models-on-the-vps/bge-m3-and-pgvector-on-the-vps.md#pgvector-on-the-shared-postgres)).
* **`shared_preload_libraries = 'pg_textsearch'`**, which takes a restart of
  the shared container and so a short stop for every database on it.
* **Two BM25 indexes** on the pieces' text, one `german` and one `english`,
  each queried by name with `to_bm25query`, fed into the same fusion as the vectors. That
  needs no language guess per piece; the vault mixes both in one note.

## Sources

Local models and quality:

* [L1] [intfloat/multilingual-e5-base model card](https://huggingface.co/intfloat/multilingual-e5-base)
* [L2] [BAAI/bge-m3 model card](https://huggingface.co/BAAI/bge-m3)
* [L3] [google/embeddinggemma-300m model card](https://huggingface.co/google/embeddinggemma-300m)
* [L4] [Gemma Terms of Use](https://ai.google.dev/gemma/terms)
* [L5] Hugging Face model API, `https://huggingface.co/api/models/<id>?blobs=true`, e.g. [bge-m3](https://huggingface.co/api/models/BAAI/bge-m3?blobs=true)
* [Q1] [MMTEB paper](https://arxiv.org/abs/2502.13595)
* [Q2] [Qwen3-Embedding-0.6B model card, MMTEB table, which lists bge-m3 too](https://huggingface.co/Qwen/Qwen3-Embedding-0.6B)
* [Q3] [MTEB results repository](https://github.com/embeddings-benchmark/results), `MIRACLRetrievalHardNegatives`, `de` subset, per model
* [Q4] [Qwen3 embedding on CPU, measured](https://lilting.ch/en/articles/qwen3-embedding-qdrant-cpu-benchmark)
* [Q6] [MTEB leaderboard](https://huggingface.co/spaces/mteb/leaderboard)
* [Q7] [M3-Embedding paper](https://arxiv.org/abs/2402.03216), fine-tuning data
* [R1] [PyTorch CPU wheels](https://download.pytorch.org/whl/cpu/torch/)
* [R2] [onnxruntime on PyPI](https://pypi.org/project/onnxruntime/)
* [R3] [bge-m3 ONNX export](https://huggingface.co/Sophia-AI/bge-m3-onnx)

Paid APIs:

* [P1] [OpenAI pricing](https://developers.openai.com/api/docs/pricing)
* [P2] [OpenAI embeddings guide](https://developers.openai.com/api/docs/guides/embeddings)
* [P3] [mistral-embed model page](https://docs.mistral.ai/models/mistral-embed-23-12)
* [P4] [Mistral, La Plateforme launch](https://mistral.ai/news/la-plateforme)
* [P5] [Voyage pricing](https://docs.voyageai.com/docs/pricing)
* [P6] [Voyage embeddings](https://docs.voyageai.com/docs/embeddings)
* [P7] [Voyage 4 launch post](https://blog.voyageai.com/2026/01/15/voyage-4/)
* [P8] [OpenAI, your data](https://developers.openai.com/api/docs/guides/your-data)
* [P9] [Mistral, where data is stored](https://help.mistral.ai/en/articles/347629-where-do-you-store-my-data-or-my-organization-s-data)
* [P10] [Mistral data processing addendum](https://legal.mistral.ai/terms/data-processing-addendum)
* [P11] [Voyage FAQ](https://docs.voyageai.com/docs/faq)
* [P12] [OpenAI, new embedding models](https://openai.com/index/new-embedding-models-and-api-updates/)

BM25 in Postgres:

* [B1] [pg_textsearch LICENSE](https://github.com/timescale/pg_textsearch/blob/main/LICENSE) and [releases](https://github.com/timescale/pg_textsearch/releases)
* [B2] [pg_textsearch README](https://github.com/timescale/pg_textsearch)
* [B3] [pg_textsearch ARCHITECTURE.md](https://github.com/timescale/pg_textsearch/blob/main/ARCHITECTURE.md)
* [B4] [ParadeDB LICENSE](https://github.com/paradedb/paradedb/blob/main/LICENSE) and [releases](https://github.com/paradedb/paradedb/releases)
* [B5] [ParadeDB Enterprise](https://www.paradedb.com/docs/operate/deploy/enterprise)
* [B6] ParadeDB: [install](https://www.paradedb.com/docs/operate/deploy/self-hosted/extension), [stem](https://www.paradedb.com/docs/reference/token-filters/stemming), [stop](https://www.paradedb.com/docs/reference/token-filters/stopwords), [writes](https://www.paradedb.com/docs/operate/performance-tuning/writes)
* [B7] [ParadeDB Dockerfile for PG17](https://github.com/paradedb/paradedb/blob/main/docker/Dockerfile.paradedb-17)
* [B8] [VectorChord-BM25 LICENSE](https://github.com/tensorchord/VectorChord-bm25/blob/main/LICENSE) and [releases](https://github.com/tensorchord/VectorChord-bm25/releases)
* [B9] [pg_tokenizer LICENSE](https://github.com/tensorchord/pg_tokenizer.rs/blob/main/LICENSE) and [docs](https://github.com/tensorchord/pg_tokenizer.rs/tree/main/docs)
* [B10] [VectorChord-BM25 README](https://github.com/tensorchord/VectorChord-bm25) and [VectorChord images](https://github.com/tensorchord/VectorChord-images)
* [B11] [plpgsql_bm25](https://github.com/jankovicsandras/plpgsql_bm25)
* [B12] [PGroonga images](https://github.com/pgroonga/docker)
