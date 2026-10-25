---
type: Reference
title: "HTTP API: finance sorting"
description: The routes that sort bookings into categories, the payees and rules that do it and the order the rules fire in, the hand's choice, and the to-sort list.
resource: backend/src/kasten_backend/routes/finance_sorting.py
tags: [api, backend, openapi, finance]
status: draft
---

# HTTP API: finance sorting

The routes that give each booking a category: the categories, the payees, the
rules, the category set by hand, and the list of what is still to sort. They
sit beside [the finance routes](/reference/http-api/finance.md), under the same
`/api/finance/` prefix and the same gate, and answer `503` the same way when
there is no database.

## How a booking gets its category

A booking's category comes from the first of these that gives one:

1. **The hand.** A category set by hand is never touched by a rule, however
   the rules change, until it is set back to `null`.
2. **A `text_contains` rule** whose pattern is in the booking's `purpose`,
   case ignored.
3. **The payee's default category**, the one "always for this payee" sets.
4. **A `payee` rule** whose pattern, cleaned like a payee name, is whole words
   of the payee's key: `dm` sorts `dm drogerie markt` and not `admiral`.

Of two rules of one kind that both match, the longer pattern wins, and of two
as long the lower id. Text rules come first because they exist for the
bookings whose payee says nothing about what was bought, PayPal and Amazon:
"always for this payee" on one PayPal booking must not silence the rules that
read past PayPal to Spotify. A payee's own default beats a payee rule because
it names that payee alone, where a rule names part of many.

A split is sorted the same way, with its own `text` in place of the purpose and
its booking's payee. A booking with splits takes no category itself; its
splits do. A move between own accounts, a booking with a `transfer_group`,
takes none and is never on the to-sort list: it is no spending. A booking
that had a category before its twin came in loses it when the two are paired,
and setting one by hand on a transfer is a `409`. The move into the shared
household account is a transfer too; the budget (#1036) counts it through the
account's `shared` flag, not through a category.

The rules run over every booking, history included, whenever a rule, a payee's
default or a category's existence changes, and over the new bookings after
every `POST /api/finance/transactions` and after `PUT .../splits`. A run also
takes back a category a rule gave that no rule gives any more. `category_set_by`
on a booking or split says who set its category: `rule`, `hand`, or `null` with
no category.

## Payees

Every booking with a counterparty name gets a payee when it comes in. The
payee's `key` is the name lowercased with Postgres's `lower()`, which is not a
full casefold (`ß` stays `ß`), every run of characters that are neither
letters nor digits made one space, and trimmed, so `REWE Markt GmbH.` and
`Rewe  markt gmbh` are the one payee `rewe markt gmbh`. Its `name` is the first
spelling seen, with its spaces tidied, for showing. A name that cleans to
nothing, such as `-`, gets no payee.

## Patterns

A pattern is stored lowercased, and a `payee` pattern also cleaned like a
payee key, so `DM.` is stored as `dm`. A rule is unique by its kind and its
stored pattern, so `REWE` beside `rewe` is a repeat. A pattern with no letter
or digit in it is refused.

Two writes that sort take turns: each holds one advisory lock until it
commits, so a run of the rules never overwrites a category set by hand while
it ran.

## GET /api/finance/categories

Every category, by name.

```json
[{ "id": 1, "name": "Groceries", "kind": "flexible" }]
```

`kind` is one of `fixed`, `flexible`, `non_monthly`, `income`, `saving` and
`ignore`. Limits come with the budget (#1036).

## POST /api/finance/categories

Makes a category from `{ "name": "Groceries", "kind": "flexible" }` and answers
it with its id. A name already taken is a `409`.

## PUT /api/finance/categories/{category_id}

Renames a category or changes its kind, from the same body as `POST`. The
bookings in it stay in it. A name another category holds is a `409`, and a
category that does not exist a `404`.

## DELETE /api/finance/categories/{category_id}

Deletes a category and every rule that names it, takes it off the payees that
had it as their default, and answers `204`. Every booking and split it held,
by hand or by rule, goes back to the rules, and what no rule sorts goes back to
the to-sort list. A category that does not exist is a `404`.

## GET /api/finance/payees

Every payee, by key, with its default category or `null`.

```json
[{ "id": 3, "key": "rewe markt gmbh", "name": "REWE Markt GmbH", "category_id": 1 }]
```

## PUT /api/finance/payees/{payee_id}

Sets the payee's default category from `{ "category_id": 1 }`, or clears it
with `null`, runs the rules over that payee's bookings, and answers the payee. This is
"always for this payee": every booking of the payee that no text rule and no
hand sorts takes the category. A payee that does not exist is a `404`, a
category that does not exist a `422`.

## GET /api/finance/rules

Every rule, in the order they fire: the text rules, then the payee rules, each
longest pattern first and then by id.

```json
[{ "id": 2, "kind": "text_contains", "pattern": "spotify", "category_id": 4 }]
```

## POST /api/finance/rules

Makes a rule from `kind` (`text_contains` or `payee`), `pattern` and
`category_id`, runs the rules over every booking, and answers it with the
pattern as stored. A rule of the same kind and stored pattern is a `409`, and a category that does not exist a
`422`. So is a pattern with no letter or digit in it: a payee pattern such as
`-` cleans to nothing, which is in every payee's key.

## PUT /api/finance/rules/{rule_id}

Changes a rule, from the same body as `POST`, and runs the rules over every
booking. The same `409` and `422` apply, and a rule that does not exist is a
`404`.

## DELETE /api/finance/rules/{rule_id}

Deletes a rule, runs the rules over every booking, and answers `204`. What the
rule sorted is sorted by the next rule that matches, or goes back to the
to-sort list. A rule that does not exist is a `404`.

## POST /api/finance/rules/run

Gives every booking with a counterparty and no payee its payee, runs the rules
over every booking, and answers how many bookings and splits took another
category. Every write above already runs them; this is for a job, such as the
Firefly import, that writes the tables some other way.

```json
{ "changed": 12 }
```

## PUT /api/finance/transactions/{transaction_id}/category

Sets the booking's category by hand from `{ "category_id": 1 }`, and answers
the booking as `GET /api/finance/transactions` shows it. `null` hands the
booking back to the rules, which run on it at once. A booking with splits is a
`409`, since its category lives on the splits, and so is a transfer, which
takes none; setting `null` on either is allowed. A booking that does not exist is a `404`, a category that does not
exist a `422`.

## PUT /api/finance/splits/{split_id}/category

The same for one split, answering the split:

```json
{ "id": 11, "amount": "-10.00", "text": "Cable", "category_id": 1, "category_set_by": "hand" }
```

## GET /api/finance/to-sort

A page of the bookings that hold something without a category, oldest first
by booking date and then by id: a booking with no splits and no category, or
a booking with a split that has none. Transfers are left out. A booking's
`splits` lists only its splits still without a category, and is empty when the
booking itself is the thing to sort.

`limit` and `after` page as on `GET /api/finance/transactions`: 500 unless
asked otherwise, at most 5,000, and `after` the `id` of the last booking of the
page before. `total` counts everything there is to sort, the bookings without
splits and the loose splits, on every page alike.

```json
{
  "total": 580,
  "bookings": [
  {
    "id": 7, "account_id": 1, "booking_date": "2026-10-20", "amount": "-30.00", "currency": "EUR",
    "purpose": "AMAZON 302-1234567", "counterparty_name": "Amazon EU",
    "payee_id": 5, "payee_name": "Amazon EU",
    "splits": [{ "id": 2, "amount": "-10.00", "text": "Cable" }]
  }
  ]
}
```

## Related

* [Sort finance transactions](/how-to/sort-finance-transactions.md): the pane that reads this list
* [HTTP API: finance](/reference/http-api/finance.md): the accounts, bookings and splits these sort
