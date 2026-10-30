---
type: Reference
title: Search by meaning for agents
description: The route and the MCP tool an agent ranks notes by meaning with, what each answer holds, and what the status sentence says when the hits are thin.
tags: [api, agent, search, backend]
status: stable
---

# Search by meaning for agents

Finds the notes best matching `q` by its words and its meaning, at most twenty,
best first: the search [`GET /api/ranked`](/reference/http-api/finding.md#get-apiranked)
runs. The MCP tool is `search_meaning`, taking `query` for `q`, and `like` and
`archive` under the same names. The keyword search beside it is
[`GET /agent/search`](/reference/agent-api/routes.md#get-agentsearch).

```
GET /agent/search/meaning?q=forking&archive=false
```

```json
{ "hits": [{ "path": "borges.md", "heading": "Borges > Labyrinths", "text": "The garden of forking paths.", "score": 0.0328 }], "status": "" }
```

`heading` is the best piece's heading path, empty before the note's first
heading. `text` is its first 240 characters, and `score` the fused score.

`like` takes a note's path and answers the notes like it, at most ten, by the
stored vectors alone, as [`GET /api/similar`](/reference/http-api/finding.md#get-apisimilar)
does. It wins over `q`, and its `score` is the cosine similarity.

`archive=true` takes the archive folder in, as `GET /agent/search` does. The
folder named by `KASTEN_PIECES_SKIP` is never indexed, so it never appears.

`status` is empty when all is well. Otherwise it says in plain sentences why
the hits may fall short: the model is still loading or not configured, so the
hits rank by words alone; the index is still filling ("The index has read N of
M notes so far."); or the index holds no note at the `like` path, so there are no hits. A
database with no pieces table answers no hits and reads as an index of 0
notes. Only a backend with no database answers with an error, the 503 the other
routes give. Nothing here writes.
