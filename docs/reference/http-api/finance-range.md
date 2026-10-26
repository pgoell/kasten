---
type: Reference
title: "HTTP API: finance spans and setup"
description: The routes behind the finance pane's time ranges and budget setup, both scopes over a span of months against a year before and the 6-month average, every spending category's limit on one screen, and every limit set at once.
resource: backend/src/kasten_backend/routes/finance_range.py
tags: [api, backend, openapi, finance]
status: draft
---

# HTTP API: finance spans and setup

The routes the finance pane reads for a quarter, a year or any span of
months, and the two behind the budget setup. They sit beside
[the finance budget routes](/reference/http-api/finance-budget.md), under the
same `/api/finance/` prefix and gate, and answer `503` the same way when there
is no database. [Budget model](/reference/budget-model.md#spans-of-months) has
the rules.

Amounts are euros as JSON strings, to the cent.

## A span

A span is `from` to `month`, both `YYYY-MM` and both included; with no `from`
it is `month` alone. A `from` after `month`, or a month that names none, is a
`422`. [GET /api/finance/budget/flow](/reference/http-api/finance-budget.md#get-apifinancebudgetflow)
and [the drilldowns](/reference/http-api/finance-drill.md) take the same two.

Each month of a span is read as over, as the sankey reads a month: what
happened, nothing estimated. A span's figures are its months added up.

## GET /api/finance/budget/range

Mine and household over the span, each set against the same months a year
before and the average of the 6 months before it.

```
GET /api/finance/budget/range?from=2026-07&month=2026-09
```

```json
{
  "first": "2026-07",
  "month": "2026-09",
  "months": 3,
  "mine": {
    "now": {
      "month": "2026-07", "income": "10350.00", "other_scope": "2700.00",
      "fixed": "115.20", "flexible": "960.12", "non_monthly": "640.00",
      "reserved": "0.00", "saved": "1200.00", "unsorted": "37.50", "left": "4697.18"
    },
    "last_year": { "month": "2025-07", "income": "0.00" },
    "average": { "month": "2026-07", "income": "10350.00" }
  },
  "household": { "now": { }, "last_year": { }, "average": null }
}
```

* `now`: the span's figures, each part as the sankey draws it, as
  [a scope's month](/reference/http-api/finance-drill.md#get-apifinancedrillscopesscope)
  has them. `left` is what the span kept in all: a month that spent past what
  came in nets against the others.
* `last_year`: the same months a year before, dated by its first; `null`
  when the history does not reach back to them.
* `average`: the 6 whole months before the span, from the first month with
  any booking, averaged and taken as many times as the span has months, so
  it reads against `now` at the same length; `null` with no month before.

## GET /api/finance/budget/setup

Every fixed, flexible and non-monthly category, by kind then name, with its
limit in force in `month`, its 6-month average, what its plans cost a month,
and a figure to start from; and the income the limits are set against.
`today` (`YYYY-MM-DD`) is the reader's, as free to spend reads it.

```
GET /api/finance/budget/setup?month=2026-11&today=2026-10-26
```

```json
{
  "month": "2026-11",
  "expected_income": "4350.00",
  "limits": "2060.00",
  "suggested": "2215.00",
  "categories": [
    { "id": 3, "name": "Rent", "kind": "fixed", "limit": "1450.00", "average": "1450.00",
      "planned": "1450.00", "plans": ["Rent"], "suggested": "1450.00" },
    { "id": 4, "name": "Groceries", "kind": "flexible", "limit": "420.00", "average": "264.18",
      "planned": null, "plans": [], "suggested": "265.00" }
  ]
}
```

* `planned`: what the category's monthly cost plans come to, each read from
  the month it was confirmed in. A plan that reserves, such as a yearly
  bill, and a plan due once are no monthly cost and are left out. `null`
  with none.
* `suggested`: the larger of `planned` and the average rounded up to the
  euro; `null` with neither.
* `expected_income`: the month's income as free to spend expects it, both
  scopes, each income category once. Household's money from mine is left
  out, since it is mine's income moved.
* `limits` and `suggested` at the top: the limits in force, and the figures
  to start from, added up.

## PUT /api/finance/budget/limits

Set many categories' monthly limits from one month on, all or none, as
[PUT /api/finance/categories/{category_id}/limit](/reference/http-api/finance-budget.md)
sets one.

```json
{ "from": "2026-11", "limits": [ { "category_id": 4, "amount": "300" }, { "category_id": 5, "amount": null } ] }
```

Answers with each limit as stored, `{ "category_id", "from", "amount" }`. An
`amount` of `null` takes that limit away from the month on. A category that
is not a spending one, or one named twice, is a `422`, and nothing is
written.
