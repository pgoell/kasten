---
type: Reference
title: "HTTP API: log"
description: The route that adds up each day's water, coffee, alcohol and food from its daily note.
resource: backend/src/kasten_backend/log.py
tags: [api, backend, openapi]
status: stable
---

# HTTP API: log

The route that adds up each day's water, coffee, alcohol and food from its daily note.

## GET /api/log

Takes `from` and `to`, both `YYYY-MM-DD`, and answers with a list of days, oldest
first. A day is in the list when its daily note in the range has a `## Log`
heading. A day without one is absent. A day whose `## Log` is empty is there,
with zeros.

```
GET /api/log?from=2026-10-20&to=2026-10-20
```

```json
[
  {
    "date": "2026-10-20",
    "path": "01 Periodic/00 Daily/2026-10-20.md",
    "entries": [
      { "line": 7, "text": "- 🍺 1 0.5 l 5%", "kind": "alcohol", "ml": 500.0, "count": 1, "abv": 5.0, "grams": 19.7, "meal": null, "words": null, "kcal": null, "protein": null, "carbs": null, "fat": null },
      { "line": 8, "text": "- 🍽 lunch: Skyr 🔥 160 kcal 🥩 27 g 🍞 10 g 🧈 0 g", "kind": "food", "ml": null, "count": null, "abv": null, "grams": null, "meal": "lunch", "words": "Skyr", "kcal": 160.0, "protein": 27.0, "carbs": 10.0, "fat": 0.0 }
    ],
    "totals": {
      "water": { "ml": 0.0 },
      "coffee": { "count": 0 },
      "alcohol": { "count": 1, "ml": 500.0, "grams": 19.7 },
      "food": { "kcal": 160.0, "protein": 27.0, "carbs": 10.0, "fat": 0.0 }
    }
  }
]
```

Every field of an entry is there, `null` where its kind has none. Every total
is there too, zero where nothing was logged. The lines are read as
[the log format](/reference/log-format.md) describes them.

## Errors

* `400` when `from` is after `to`.
* `422` when a date is not `YYYY-MM-DD` or names no day, `0` and `2026-02-30` among them.

## Reading

The route lists the daily folder once and reads the notes there whose names
fall in the range, so a wide range costs no more than the notes it holds. A
note it cannot read, gone or not UTF-8, is left out. It runs no search over
the vault, and it keeps nothing in Postgres or in an index. The archive is not
read.
