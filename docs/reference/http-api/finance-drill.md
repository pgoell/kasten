---
type: Reference
title: "HTTP API: finance drilldowns"
description: The routes behind the finance pane's drilldowns, one scope, account, category, payee or booking month by month, with the bookings that count in the month and where one booking counts.
resource: backend/src/kasten_backend/routes/finance_drill.py
tags: [api, backend, openapi, finance]
status: draft
---

# HTTP API: finance drilldowns

The routes the finance pane reads when you open a scope, an account, a
category, a payee or a booking. They sit beside
[the finance budget routes](/reference/http-api/finance-budget.md), under the
same `/api/finance/` prefix and gate, and answer `503` the same way when there
is no database.

Each reads the same ledger free to spend and the sankey read, so a figure for
a month here is the figure the overview gives for it: the salary cutoff, moves
between own accounts, splits, refunds, `ignore` and a bill a plan's reserve
paid all count as [Budget model](/reference/budget-model.md) says. Each month
is read as if it were over, as the sankey reads it: what happened, nothing
estimated.

Amounts are euros as JSON strings, to the cent. A name that matches nothing,
such as an id no category has, is a `404`.

## Month, from and months

The four month reads take `month` (`YYYY-MM`, required), `from` (`YYYY-MM`,
optional) and `months` (1 to 60, 12 when left out). The span is `from` to
`month`, both included, or `month` alone with no `from`; a `from` after
`month` is a `422`. `months` lists the `months` months up to and with
`month`, oldest first, and never fewer than the span holds. The bookings, a
scope's span, a category's payees and span, and an account's money by
category and transfers are the span's. `first` in the answer is the span's
first month.

A scope's, a category's and a payee's bookings are those that count in the
budget month: a salary booked after the cutoff day lists in the month after
its booking date. A split booking lists in each month one of its splits
counts in; in a category's view, only its splits in that category decide.
A booking on an own saving account counts in no scope and lists in none of
these, and a category lists no move between own accounts, even one whose
other half is not in yet. An account's bookings go by booking date, as its
bank balance does.

## GET /api/finance/drill/scopes/{scope}

One scope, `mine` or `household`, each month as the sankey draws it, its
accounts, and the month's bookings on them.

```
GET /api/finance/drill/scopes/mine?month=2026-10&months=12
```

```json
{
  "scope": "mine",
  "first": "2026-10",
  "month": "2026-10",
  "months": [
    {
      "month": "2026-10", "income": "3000.00", "other_scope": "900.00",
      "fixed": "0.00", "flexible": "120.00", "non_monthly": "0.00",
      "reserved": "0.00", "saved": "300.00", "unsorted": "0.00", "left": "1680.00"
    }
  ],
  "span": { "now": { "month": "2026-10", "left": "1680.00" }, "last_year": { }, "average": { } },
  "accounts": [
    { "id": 1, "name": "Giro", "kind": "giro", "balance": "1680.00",
      "balance_on": "2026-10-02", "moved": "-1320.00" }
  ],
  "bookings": []
}
```

* `income`: each income category's money in. `other_scope` is the move
  between mine and household: a cost on mine, money in on household.
* `reserved`: the plans' reserve shares and the month's shortfalls.
* `left`: income, plus or less `other_scope`, less every other part. It is
  free to spend for a month that is over; below zero, the month spent past
  what came in.
* `span`: the span's figures added up (`now`), the same months a year before
  (`last_year`), and the 6 whole months before the span averaged and taken as
  many times as the span has months (`average`, `null` with no month before),
  each shaped as a month is, as
  [GET /api/finance/budget/range](/reference/http-api/finance-range.md) gives
  them.
* `accounts`: the accounts of the scope, by name, each with its latest bank
  balance (`null` with none) and what its bookings moved in the month, by
  booking date.
* `bookings`: as [GET /api/finance/transactions](/reference/http-api/finance.md)
  answers them, newest first.

A scope that is neither `mine` nor `household` is a `422`.

## GET /api/finance/drill/accounts/{account_id}

One account's balance at each month end, and the month's money by category
and by the other own account a transfer went to or came from, all by booking
date.

```json
{
  "account": { "id": 1, "name": "Giro", "bank": "DKB", "iban": "DE02…", "kind": "giro", "shared": false },
  "scope": "mine",
  "first": "2026-10",
  "month": "2026-10",
  "months": [
    { "month": "2026-10", "balance": "1680.00", "balance_from": "2026-10-02",
      "money_in": "0.00", "money_out": "1320.00" }
  ],
  "categories": [ { "id": 4, "name": "Groceries", "amount": "-120.00" } ],
  "transfers": [ { "id": 2, "name": "Shared", "amount": "-900.00" } ],
  "bookings": []
}
```

* `balance`: counted from the latest bank balance on or before the month's
  last day, adding the bookings after it; with none before, from the first
  one after, taking away the bookings between. A bank balance holds the
  bookings of its own day. `balance_from` is the day of the bank balance it
  was counted from, `null` with none at all, when the balance is the
  bookings summed from zero.
* `money_in` and `money_out`: what the month's bookings brought in and took
  out, transfers included, each summed on its own, so a refund does not net
  the spending of its day.
* `categories`: each category's net in the month, signed as bookings are,
  the largest first; `null` for bookings not sorted. `transfers`: the same
  for each other own account. The two add up to what the balance moved.
* `scope`: `mine`, `household`, or `null` for an own saving account.

## GET /api/finance/drill/categories/{category_id}

One category's months against its limit and average, its payees in the
month, the plans and rules behind it, and the month's bookings.

```json
{
  "category": { "id": 4, "name": "Groceries", "kind": "flexible" },
  "first": "2026-10",
  "month": "2026-10",
  "months": [
    { "month": "2026-10", "mine": "190.00", "household": "0.00", "total": "190.00",
      "from_reserve": "0.00", "limit": "400.00", "available": "365.00", "average": "412.33" }
  ],
  "span": {
    "now": { "mine": "190.00", "household": "0.00", "total": "190.00", "from_reserve": "0.00" },
    "last_year": { "mine": "160.00", "household": "0.00", "total": "160.00", "from_reserve": "0.00" },
    "average": { "mine": "412.33", "household": "0.00", "total": "412.33", "from_reserve": "0.00" },
    "available": "365.00"
  },
  "payees": [ { "id": 5, "name": "REWE", "amount": "70.00" } ],
  "plans": [ { "id": 2, "name": "Rent", "amount": "-1500.00", "every_months": 1 } ],
  "rules": [ { "id": 3, "kind": "payee", "pattern": "rewe", "category_id": 4 } ],
  "bookings": []
}
```

* `mine`, `household` and `total`: what the category counted: money in for
  an income category, money out for any other, net of refunds. An `ignore`
  category counts nothing. `total` is the budget's `spent` for a spending
  category.
* `from_reserve`: the part of it a plan's reserve paid. The sankey draws that
  part as reserved, so its stream into the category is `total` less this.
* `limit` and `available`: as
  [GET /api/finance/budget](/reference/http-api/finance-budget.md) gives them.
  `average` is the mean of `total` over the whole months before, at most 6,
  from the category's first month with money: the budget's `average` for a
  spending category, and money in for an income one.
* `span`: what the category counted over the span, a year before, and at its
  6-month average for as many months, the average from the category's first
  month with money. `available` is what the limits made available over the
  span, each month less the overspend carried into it; `null` with no limit
  in any of its months.
* `payees`: what each payee gave the category over the span, the largest
  first; `id` `null` for bookings with no payee. They add up to the span's
  `total`.
* `rules`: the rules that sort into the category.

## GET /api/finance/drill/payees/{payee_id}

One payee's months, its average spending, the categories its money went to,
the payee rules that name it, and the month's bookings.

```json
{
  "payee": { "id": 5, "key": "rewe", "name": "REWE", "category_id": 4 },
  "first": "2026-10",
  "month": "2026-10",
  "months": [
    { "month": "2026-10", "spent": "100.00", "received": "0.00", "saved": "0.00", "bookings": 1 }
  ],
  "average": "86.50",
  "average_received": "0.00",
  "categories": [ { "id": 4, "name": "Groceries", "kind": "flexible", "amount": "70.00" } ],
  "rules": [],
  "bookings": []
}
```

* `spent`: money out in spending categories and not sorted yet, net of
  refunds. `received`: money in, in income categories. `saved`: moved into
  an own saving account, or spent in a `saving` category. A move between
  accounts of one scope, or between mine and household, is in none of them.
* `bookings` in a month: how many bookings count in it, as `spent` and
  `received` count them; a move between own accounts, a booking in an
  `ignore` category and money in not sorted yet are none.
* `average`: the mean `spent` over the whole months before `month`, at most
  6, from the payee's first month; `null` with none. `average_received` is
  the same for `received`, for a payee that pays in, such as an employer.
* `categories`: what each category got over all the months asked for, the
  largest first.
* `rules`: the `payee` rules whose pattern starts at a word of the payee's
  key, as the rules match, and that sort a side its bookings are on: a rule
  for money out does not name a payee that only pays in.

## GET /api/finance/drill/bookings/{transaction_id}

One booking with every field and its raw record, its account and payee, the
other half of a transfer, the plan it met, and where it counts.

```json
{
  "transaction": { "id": 7, "amount": "-900.00", "raw": { }, "splits": [] },
  "account": { "id": 1, "name": "Giro", "kind": "giro", "shared": false },
  "payee": null,
  "twin": { "id": 8, "account_id": 2, "amount": "900.00" },
  "plans": [ { "id": 2, "name": "Rent", "period": "2026-10" } ],
  "counts": [
    { "month": "2026-10", "scope": "mine", "part": "other_scope", "category_id": null, "amount": "900.00" }
  ]
}
```

* `transaction` and `twin`: as
  [GET /api/finance/transactions](/reference/http-api/finance.md) answers a
  booking. `twin` is `null` for a booking that is no transfer, or whose other
  half is not in yet.
* `counts`: each budget month, scope and part the booking or its splits
  count in, the amount positive as the part counts it. `part` is `income`,
  `fixed`, `flexible`, `non_monthly`, `reserve` (a bill a plan's reserve
  paid), `saved`, `unsorted` or `other_scope`. A move between two accounts
  of one scope, money in with no category, an `ignore` category and a
  booking on an own saving account count nowhere, so the list is empty.

Splitting a booking and sorting it again go through the routes that already
do it: `PUT /api/finance/transactions/{transaction_id}/splits` and the
category routes in [Finance sorting](/reference/http-api/finance-sorting.md).
