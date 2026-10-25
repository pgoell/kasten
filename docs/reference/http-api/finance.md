---
type: Reference
title: "HTTP API: finance"
description: The routes host jobs write accounts, balances and bookings through, the splits under a booking, and the two reads; what reaches them, and the 503 without a database.
resource: backend/src/kasten_backend/routes/finance.py
tags: [api, backend, openapi, finance]
status: draft
---

# HTTP API: finance

The routes jobs on the host write the finance records through, and the reads
the browser and agents use. The records live in Postgres, in the `finance`
schema, for the reasons in [Finance in Postgres](/explanation/finance-in-postgres.md).

Amounts are euros and cents, signed, spending negative. They go out as JSON
strings (`"-4.20"`) so no float touches them, and come in as strings or numbers
with at most two decimals and twelve digits before the point.

## Who reaches these routes

They sit under `/api/`, behind the login gate like every other route there,
with no lock of their own: agents read everything, settled on 2026-10-25. A job
on the host, such as the bank sync, has no browser session and does not pass
the gate. It calls the backend directly on the docker network `web`, inside the
trust zone that
[the security model](/explanation/security-model.md#the-internal-trust-zone)
describes. A job in a container on `web` names it `http://kasten-backend-prod:8000`.
A job on the host itself cannot resolve that name, and the backend publishes no
host port, so it reads the container's address on `web` before each run, as
the address changes when the container restarts:

```sh
docker inspect -f '{{.NetworkSettings.Networks.web.IPAddress}}' kasten-backend-prod
```

The shell and the chat pane reach them the same way. No token
reaches them: nothing under `/agent/` reads finance yet.

## GET /api/finance/accounts

Every account, by name.

```json
[
  { "id": 1, "name": "DKB Girokonto", "bank": "DKB", "iban": "DE02120300000000202051", "kind": "giro", "shared": false }
]
```

`kind` is one of `giro`, `saving`, `card` and `cash`. `shared` marks an account
held with someone else, such as a household account.

## POST /api/finance/accounts

Makes the account, or updates the one with the same `name`, and answers `200`
with the row either way. The name is the key because a cash account has no
IBAN. A job upserts its accounts on every run and posts bookings by the ids it
gets back.

```json
{ "name": "DKB Girokonto", "bank": "DKB", "iban": "DE02120300000000202051", "kind": "giro", "shared": false }
```

`bank`, `iban` and `shared` may be left out. On a new account they then take
`null`, `null` and `false`; on an existing one a field left out keeps what the
account holds, and only a field the post names, `null` included, changes. An
IBAN is stored without spaces and in capitals, however it was sent. An IBAN
another account holds is a `409`: transfer linking reads an account off its
IBAN, so two accounts cannot share one.

## POST /api/finance/balances

Stores up to 1,000 balances the bank reported, one per account and day. A
second report for the same day replaces the first, since a later pull has seen
more bookings, and of two for one day in the same post the later one wins.
Answers with how many it stored.

```json
[{ "account_id": 1, "date": "2026-10-25", "amount": "1234.56" }]
```

```json
{ "stored": 1 }
```

A balance is never summed from bookings. A gap in the bookings then shows as a
mismatch between the two, not as a wrong balance.

## GET /api/finance/transactions

A page of the bookings, oldest first by booking date and then by id, each with
its splits. Each filter is optional:

* `account`: an account id.
* `from` and `to`: both `YYYY-MM-DD` and both included.
* `month`: `YYYY-MM`, the same as `from` and `to` around that month. With
  `from` or `to` beside it, a `400`.
* `category`: a category id. A booking counts when it, or one of its splits,
  has that category.
* `text`: plain text, case ignored, looked for in the purpose, the
  counterparty and the payee's name.
* `order`: `asc`, the default, or `desc` for newest first.

`limit` is the page's size, 500 unless it says otherwise, at most 5,000.
`after` is the `id` of the last booking of the page before, and the next page
starts behind it in the same order, `desc` included. A page shorter than `limit` is the last.
An `after` naming no booking answers `[]`.

```
GET /api/finance/transactions?account=1&month=2026-10&category=4&text=rewe&order=desc&limit=500&after=7
```

```json
[
  {
    "id": 7, "account_id": 1, "booking_date": "2026-10-20", "value_date": "2026-10-20",
    "amount": "-30.00", "currency": "EUR", "purpose": "AMAZON 302-1234567", "posting_text": "Lastschrift",
    "counterparty_name": "Amazon EU", "counterparty_iban": "LU89751000135104200E", "bank_ref": null,
    "raw": { "...": "the record as the bank sent it" }, "source_key": "2026-10-20|-30.00|AMAZON 302-1234567|0",
    "imported_at": "2026-10-25T17:00:03.120000Z", "transfer_group": null,
    "payee_id": 5, "category_id": null, "category_set_by": null,
    "splits": [
      { "id": 1, "amount": "-20.00", "text": "Book", "category_id": 2, "category_set_by": "rule" },
      { "id": 2, "amount": "-10.00", "text": "Cable", "category_id": null, "category_set_by": null }
    ]
  }
]
```

`transfer_group` is the same id on both halves of a move between two own
accounts, and `null` on every other booking. `payee_id`, `category_id` and
`category_set_by` (`rule`, `hand` or `null`) are how the booking, and each
split, is sorted; [HTTP API: finance sorting](/reference/http-api/finance-sorting.md)
says how.

## POST /api/finance/transactions

Takes up to 1,000 bookings, possibly on several accounts, inserts the ones not
already stored, then links transfers. Answers with what it did.

```json
[
  {
    "account_id": 1, "booking_date": "2026-10-20", "value_date": "2026-10-20", "amount": "-4.20",
    "purpose": "Bäckerei", "counterparty_name": "Bäckerei Müller", "source_key": "2026-10-20|-4.20|Bäckerei|0",
    "raw": { "...": "the record as the bank sent it" }
  }
]
```

```json
{ "created": 1, "skipped": 0, "linked": 0 }
```

Only `account_id`, `booking_date`, `amount` and `source_key` are required.
`currency` defaults to `EUR`; `value_date`, `purpose`, `posting_text`,
`counterparty_name`, `counterparty_iban`, `bank_ref` and `raw` to `null`.

`source_key` is the job's own name for the booking, unique per account. A
booking whose account already holds its key is skipped and left exactly as it
was, so a job can send an overlapping window on every run. The same booking
twice in one post is stored once. Two different bookings under one key in one
post are a `422` naming the key, since one of them would be dropped unseen.
`counterparty_iban` is stored without spaces and in capitals. The key should end
in an occurrence index, the booking's place among identical bookings that day,
so two coffees of the same price on the same day are two keys and both stay.

`linked` counts the transfers paired after the insert. A booking pairs with one
that:

* is on the account whose IBAN is its `counterparty_iban`,
* has the opposite amount and the same currency,
* was booked at most five days before or after it,
* and names as its own `counterparty_iban` either nothing or the first
  booking's account.

The nearest wins, and each booking pairs once. Every unlinked booking takes
part, not only this batch, because the two halves often come in different
pulls. A second post of the same batch links nothing, and two posts linking at
once take turns. The pairing is greedy: with the same amount moved several
times in a few days, a booking can be left unlinked that another order would
have paired. That is accepted as rare; such a booking counts as spending.
A transfer takes no category, so a half that had one, by rule or by hand,
loses it when it is paired.

After the linking, each new booking gets its payee from its counterparty name
and the rules' category, in the order
[HTTP API: finance sorting](/reference/http-api/finance-sorting.md#how-a-booking-gets-its-category)
gives. A transfer takes no category.

A booking on an account id that does not exist refuses the whole batch with a
`422` naming the ids, and nothing is written.

## PUT /api/finance/transactions/{transaction_id}/splits

Puts the list in place of the booking's splits, and answers with the booking
as `GET` shows it. The splits must add up to the booking's amount: a set that
does not is a `422` saying both sums, and nothing changes. The parts may
differ in sign, as an order with a credit or a refunded item does. An empty
list removes the splits. A category set by hand on an old split goes with it.
The new splits take the rules' categories at once, and the booking gives up
its own category, even one set by hand, since its category now lives on the
splits.

```json
[{ "amount": "-20.00", "text": "Book" }, { "amount": "-10.00", "text": "Cable" }]
```

A booking that does not exist is a `404`.

## Errors

* `503` on every route here when the connection to
  [`KASTEN_DATABASE_URL`](/reference/configuration.md#kasten_database_url)
  cannot be opened. The rest of kasten runs as before. A database that answers
  and then fails, a timeout or a deadlock, is a `500`.
* `400` when `from` is after `to`, or `month` comes with `from` or `to`.
* `422` when a date is not `YYYY-MM-DD` or names no day, a month is not
  `YYYY-MM` or names no month, an amount has more
  than two decimals, a batch holds more than 1,000 bookings or balances, or
`limit` is not between 1 and 5,000.
