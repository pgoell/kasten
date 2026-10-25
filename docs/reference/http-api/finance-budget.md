---
type: Reference
title: "HTTP API: finance budget"
description: The routes behind the finance budget, a month's budget per category, free to spend for mine and household, the spending trend, a category's limit and the budget settings.
resource: backend/src/kasten_backend/routes/finance_budget.py
tags: [api, backend, openapi, finance]
status: draft
---

# HTTP API: finance budget

The routes the finance pane's overview and budget read, and the two writes
that set a limit and the settings. They sit beside
[the finance routes](/reference/http-api/finance.md), under the same
`/api/finance/` prefix and gate, and answer `503` the same way when there is
no database. [Budget model](/reference/budget-model.md) says how every figure
is worked out.

Amounts are euros as JSON strings, to the cent, spending as a positive figure.

## Month and today

The three reads take `month` (`YYYY-MM`) and the first two `today`
(`YYYY-MM-DD`), all required: pace and "so far" depend on the reader's own
day, and the server keeps UTC, which on the last evening of a month is already
the next one in Berlin. A month that names no month, such as `2026-13`, is a
`422`, as is a read without them.

## GET /api/finance/budget

Every fixed, flexible and non-monthly category's month, by name, and what the
limits left.

```
GET /api/finance/budget?month=2026-10&today=2026-10-10
```

```json
{
  "month": "2026-10",
  "share_of_month": "0.3226",
  "categories": [
    {
      "id": 4, "name": "Groceries", "kind": "flexible",
      "limit": "400.00", "carried": "35.00", "available": "365.00", "spent": "190.40",
      "average": "432.10", "expected_by_now": "117.74", "status": "near",
      "suggestion": { "direction": "raise", "amount": "430.00" }
    }
  ],
  "unreserved": { "last_month": "120.00", "total": "560.00" }
}
```

* `share_of_month`: how far through the month `today` is, `0` before it and
  `1` after it.
* `limit`: the limit in force, `null` with none. `carried` is last month's
  overspend, and `available` the limit less it.
* `average`: the mean spending of the whole months before, at most 6; `null`
  with none.
* `expected_by_now`: `available` times `share_of_month`, for a flexible
  category with a limit; `null` otherwise.
* `status`: `ok`, `near`, `over`, or `null` without a limit.
* `suggestion`: `null`, or a new limit to raise or lower it to.

## GET /api/finance/budget/free

Free to spend for mine and household, each with the lines it is made of.

```json
{
  "month": "2026-10",
  "mine": {
    "total": "1240.00",
    "income": {
      "total": "3410.00",
      "lines": [
        { "name": "Salary", "category_id": 1, "so_far": "0.00", "average": "3410.00", "counted": "3410.00", "basis": "average" }
      ]
    },
    "fixed": { "total": "1350.00", "lines": [] },
    "flexible": { "total": "520.00", "lines": [] },
    "non_monthly": { "total": "0.00", "lines": [] },
    "unsorted": "0.00",
    "saved": "300.00",
    "reserves": {
      "total": "50.00",
      "lines": [{ "plan_id": 3, "name": "Haftpflicht", "share": "50.00", "paid": "0.00", "balance": "350.00" }]
    },
    "goals": {
      "total": "200.00",
      "lines": [
        { "goal_id": 1, "name": "Wedding", "account_id": 5, "account_name": "DKB Personal Saving",
          "planned": "500.00", "moved": "300.00", "done": false }
      ]
    }
  },
  "household": { "...": "the same shape" }
}
```

`total` is income less fixed, flexible, non-monthly, unsorted, saved, the
reserves' shares and the goals' contributions still to move. A line's
`category_id` is `null` for the move between mine and household,
`Into the shared account` on mine and `From mine` on household. `basis` says
whether `counted` is what happened so far, the average, or (`plan`) what it
cost so far plus its plans still to come.

`reserves` has a line per plan that sets money aside: its `share` this month,
the bill it `paid` this month, and the `balance` it holds at the month's end,
which may be below zero. `goals` has a line per goal with a contribution this
month, on mine only; `total` is `planned` less `moved` over them while the
month runs, and `0.00` once it is over. Plans and goals have their own
routes, [HTTP API: finance plans and goals](/reference/http-api/finance-plans.md).

## GET /api/finance/budget/trend

Spending per month for the `months` months up to and with `month`, oldest
first. `months` is 12 unless named, from 1 to 60.

```json
{
  "months": ["2025-11", "2025-12"],
  "categories": [{ "id": 4, "name": "Groceries", "kind": "flexible", "amounts": ["412.10", "398.00"] }],
  "totals": ["2410.20", "2652.80"],
  "limits": [null, "2500.00"]
}
```

`totals` sums every spending category per month. `limits` sums what each
month had available, the limits less last month's overspend, as
`GET /api/finance/budget` gives them; `null` in a month with no limit.

## PUT /api/finance/categories/{category_id}/limit

Sets a category's monthly limit from the month `from` names on, and answers
the row; `from` is required. A second limit from the same month replaces
the first; one from a later month leaves the months before as they were.
`null` takes the limit away from that month on.

```json
{ "amount": "400.00", "from": "2026-11" }
```

```json
{ "category_id": 4, "from": "2026-11", "amount": "400.00" }
```

A category that does not exist is a `404`. A category that is not `fixed`,
`flexible` or `non_monthly`, or an amount below zero, is a `422`.

## GET /api/finance/budget/settings

The salary cutoff day and the income categories that count as salary.

```json
{ "salary_cutoff_day": 15, "salary_category_ids": [1] }
```

## PUT /api/finance/budget/settings

Writes both, from the same body as `GET` answers, and answers it. The list is
the whole set: a category left out stops being salary. The day is 1 to 31; an
id that is not an income category is a `422` naming it.
