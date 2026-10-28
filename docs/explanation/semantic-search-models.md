---
type: Explanation
title: Semantic search models
description: Which embedding model could give kasten search by meaning and "notes like this one", local on the VPS's CPU or a paid API, what each costs in RAM, time or money for the live vault, how each reads German, and what pgvector needs, with bge-m3's query and indexing speed measured on the VPS; ends with the choice pgoell has to make.
tags: [search, embeddings, pgvector, research]
status: draft
---

# Semantic search models

[#954](https://github.com/pgoell/kasten/issues/954) wants search by meaning
in the finder and for agents, and a "notes like this one" list beside the
backlinks. Both need an embedding model: it turns a note into a vector, and
notes whose vectors lie close mean similar things. The issue leaves the model
to pgoell and asks for a short comparison first. This page is that
comparison. Nothing here is built.

Figures come in two kinds. **Cited** ones link their source. **Estimated**
ones say so and show the sum. **Measured** ones come from bge-m3 run on the
VPS, after pgoell asked how fast its queries and indexing would be; they are
in [bge-m3 measured on the VPS](#bge-m3-measured-on-the-vps). The other
models were not run.

## What kasten does today

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
[the measurement on the VPS](#bge-m3-measured-on-the-vps) replaces them:
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

## What kasten would need

* **A table that can be thrown away:** note path, piece number, a hash of the
  piece's text, the vector. Dropping it and rebuilding from the vault gives
  the same rows, as [the one rule](/explanation/vault-and-derived-index.md)
  asks.
* **Pieces.** A model reads only so many tokens. At 512 a median note
  becomes two or three pieces and 382 notes need splitting; at 8,192 only
  the 55 longest notes do. On the VPS's CPU bge-m3 should still get 512:
  whole notes run four times slower a token. Split by heading, then by
  length.
* **The event path.** Re-embed after a write through the API, after a file
  change seen by the watcher (Obsidian, jj, the shell), and once on startup
  for anything whose hash differs. The startup sweep makes the other two
  safe to miss.
* **The flashcards** stay out by path until someone asks for them.

## Recommendation

Three things decide it:

1. **German.** The vault's prose is German and English. bge-m3 has the best
   published German retrieval score here; no API publishes one.
2. **Speed.** Measured on the VPS, a bge-m3 query answers in about 56 ms,
   and the first pass over the vault without flashcards takes about 51
   minutes at 512-token pieces. Speed answers whether bge-m3 is usable, not
   why to pick it: it is the slowest of the three, and at 512-token pieces
   its 8,192-token window no longer counts. The choice over e5-base rests on
   German alone.
3. **Where the text goes.** A local model keeps every note on the VPS. Every
   API sends it to another company, and for Voyage that means training by
   default.

The VPS has 44 GiB available, so bge-m3's 2.2 GB at 512-token pieces is
affordable. Its first pass runs once, in the background, and a saved note
re-embeds in 2 to 3 s. If that hour or that RAM is too much, OpenAI's
3-small costs a few cents a month (**MONEY**, $0.02 per 1M tokens) and gives
up the German edge and the privacy.

**Recommended: local `BAAI/bge-m3`, run under onnxruntime on 512-token
pieces, flashcards left out.**

**pgoell's choice:** one embedding model, local or API. Answer in this shape:

* `954: local BAAI/bge-m3` (recommended)
* `954: local intfloat/multilingual-e5-base` (smaller, faster, weaker German)
* `954: API openai/text-embedding-3-small` (**MONEY**, $0.02 per 1M tokens)
* `954: API mistral/mistral-embed` (**MONEY**, $0.10 per 1M tokens, EU hosted)

Add `+ flashcards` to embed the kanji notes as well.

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

pgvector:

* [V1] [pgvector changelog](https://github.com/pgvector/pgvector/blob/master/CHANGELOG.md)
* [V2] [pgvector README](https://github.com/pgvector/pgvector)
* [V3] [pgvector image tags](https://hub.docker.com/r/pgvector/pgvector/tags?name=pg17) and [its Dockerfile](https://github.com/pgvector/pgvector/blob/master/Dockerfile)
* [V4] [PostgreSQL wiki, locale data changes](https://wiki.postgresql.org/wiki/Locale_data_changes)
