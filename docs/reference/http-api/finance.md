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

`bank`, `iban` and `shared` may be left out. An IBAN another account holds is a
`409`: transfer linking reads an account off its IBAN, so two accounts cannot
share one.

## POST /api/finance/balances

Stores the balances the bank reported, one per account and day. A second
report for the same day replaces the first, since a later pull has seen more
bookings. Answers with how many it stored.

```json
[{ "account_id": 1, "date": "2026-10-25", "amount": "1234.56" }]
```

```json
{ "stored": 1 }
```

A balance is never summed from bookings. A gap in the bookings then shows as a
mismatch between the two, not as a wrong balance.

## GET /api/finance/transactions

The bookings, oldest first by booking date, each with its splits. Takes
`account`, an account id, and `from` and `to`, both `YYYY-MM-DD` and both
included. Each is optional.

```
GET /api/finance/transactions?account=1&from=2026-10-01&to=2026-10-31
```

```json
[
  {
    "id": 7, "account_id": 1, "booking_date": "2026-10-20", "value_date": "2026-10-20",
    "amount": "-30.00", "currency": "EUR", "purpose": "AMAZON 302-1234567", "posting_text": "Lastschrift",
    "counterparty_name": "Amazon EU", "counterparty_iban": "LU89751000135104200E", "bank_ref": null,
    "raw": { "...": "the record as the bank sent it" }, "source_key": "2026-10-20|-30.00|AMAZON 302-1234567|0",
    "imported_at": "2026-10-25T17:00:03.120000Z", "transfer_group": null,
    "splits": [{ "id": 1, "amount": "-20.00", "text": "Book" }, { "id": 2, "amount": "-10.00", "text": "Cable" }]
  }
]
```

`transfer_group` is the same id on both halves of a move between two own
accounts, and `null` on every other booking.

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
was, so a job can send an overlapping window on every run. The key should end
in an occurrence index, the booking's place among identical bookings that day,
so two coffees of the same price on the same day are two keys and both stay.

`linked` counts the transfers paired after the insert. A booking pairs with one
on the account whose IBAN is its `counterparty_iban`, of the opposite amount,
booked at most five days apart; the nearest wins, and each booking pairs once.
Every unlinked booking takes part, not only this batch, because the two halves
often come in different pulls. A second post of the same batch links nothing.

A booking on an account id that does not exist refuses the whole batch with a
`422` naming the ids, and nothing is written.

## PUT /api/finance/transactions/{transaction_id}/splits

Puts the list in place of the booking's splits, and answers with the booking
as `GET` shows it. The splits must add up to the booking's amount: a set that
does not is a `422` saying both sums, and nothing changes. An empty list
removes the splits.

```json
[{ "amount": "-20.00", "text": "Book" }, { "amount": "-10.00", "text": "Cable" }]
```

A booking that does not exist is a `404`.

## Errors

* `503` on every route here when no database answers at
  [`KASTEN_DATABASE_URL`](/reference/configuration.md#kasten_database_url). The
  rest of kasten runs as before.
* `400` when `from` is after `to`.
* `422` when a date is not `YYYY-MM-DD` or names no day, an amount has more
  than two decimals, or a batch holds more than 1,000 bookings.
