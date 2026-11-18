---
type: Explanation
title: Finance in Postgres
description: Why money is the one record kasten keeps outside the vault, why Postgres and not a ledger file or SQLite, why agents may read single transactions, and what backing up the database now means.
resource: backend/alembic/versions/0001_finance_schema.py
tags: [design, database, finance, data-model]
status: draft
---

# Finance in Postgres

kasten has [one rule](/explanation/vault-and-derived-index.md): the vault is
the source of truth, and nothing that only exists in the database is allowed
to matter. Finance breaks it on purpose. Transactions, budgets, plans and goals
will live in a `finance` schema in Postgres, and nothing in the vault will be
able to rebuild them.

Every feature before this one turned Postgres down. The flashcard schedule went
into the note, the food you make up went into `foods.md`, the shared lists
stayed two notes. This page says why money went the other way, and what that
costs.

The schema exists from migration `0001`. Migration `0002` adds accounts,
balances, bookings and their splits, which jobs on the host write through
[the finance routes](/reference/http-api/finance.md). Migration `0003` adds the
categories, payees and rules that
[sort them](/reference/http-api/finance-sorting.md). Migration `0004` adds the sync
requests and runs behind "pull now"
([the sync routes](/reference/http-api/finance-sync.md)), and `0005` gives
each rule the side of the bookings it sorts. Migration `0007` adds the
budget's settings: each category's limit by the month it takes effect from,
the salary cutoff day and which income is salary
([Budget model](/reference/budget-model.md)), `0008` the plans and goals, and
`0009` an index on each booking's payee for the payee drilldown.

## A transaction is not a note

A note is something you write and read again. A bank booking is neither. It
arrives from the bank about 75 times a month, nobody writes it, and nobody
reads one on its own: you read sums of them, by month, by category, against a
limit. Every question finance asks is a query over thousands of rows, and a
directory of markdown files answers none of them well.

A transaction also changes in ways a note does not. A rule sorts it, an order
mail splits it into items, a plan matches it, a receipt attaches to it. Each of
those is a row pointing at a row. Written into the vault, they would be edits
to a ledger file that no person made, under a history meant for writing.

## Why not a ledger file in the vault

A plain-text ledger, hledger or beancount style, would keep the rule. kasten
would read it into an index the way it reads todos, and the database would stay
disposable.

It was turned down for three reasons:

- **The writers are jobs.** The bank sync, the order-mail reader and the
  receipt reader write all day. A ledger file would take their writes through
  the save path, one conditional write per change, and fill the note history
  with machine edits.
- **The queries are the product.** Free to spend, budget pace, the forecast
  and the tax totals are SQL over the whole history. An index rebuilt from a
  file would hold the same rows, with a parser in front.
- **Splits and links have no line format.** An Amazon order split over three
  categories, matched to two shipments and one refund, is three tables, not a
  line.

## Why not SQLite

SQLite would be one file with an hourly backup, as other services on the same
box keep. Postgres won on smaller points: kasten's dev, CI and prod already run
it, Alembic already points at it, the host's nightly offsite backup already
dumps the whole prod database, and `numeric` holds exact amounts. Nothing at this
size needs Postgres for speed: about 20,000 transactions in twenty years.

## Agents read everything

An agent with a token reads single transactions, not only totals, through
the finance tools and `/agent/finance/*` (#1038). The first
design gave agents summary views and nothing else, enforced by a database role.
It was dropped (2026-10-25): finance is useful to an agent mostly in the
detail, a payee, a duplicate, a missed refund.

The cost is the one [the agent boundary](/explanation/the-agent-boundary/finance-reads.md)
names for the vault: a leaked token exposes it, and that includes every
transaction.

## What backing up now means

Until now the vault was the only thing on the box that could not be rebuilt.
That stops being true. A dropped `finance` schema is lost money history, not a
slow rebuild, so:

- `db:reset` on a dev database loses that database's finance rows. Dev rows are
  test data, and the reset stays safe there. It was never safe against prod.
- Prod's `finance` schema is in the nightly offsite dump of `kasten_prod`, as
  the whole database is. The vault gets an hourly local backup as well, and
  the finance rows get an hourly dump of their own
  ([Back up and restore](/how-to/back-up-and-restore.md#the-finance-dump-on-the-maintainers-server)),
  so a bad edit costs at most an hour rather than a day.
- Receipts are files, not rows: `~/kasten-data/finance/receipts/` holds them
  by their hash, beside the vault and not in it, and the database holds each
  one's hash and booking. The nightly offsite backup of the home directory
  takes them; the hourly finance dump does not.
- A rollback to a release older than a migration needs that migration undone
  first, with the newer image: the older image does not know the revision. See
  [Deploy to the VPS](/how-to/deploy-to-the-vps.md).

## What is deliberately not here

- **No finance data in the vault.** No export into notes, no ledger mirror. One
  copy, in one place.
- **No second database role.** Agents reach finance through kasten's
  routes like everything else, so a role would guard nothing they could
  otherwise reach.
- **No bank client inside kasten.** Kasten stores and shows; jobs on the host
  gather. The bank sync is one of them ([Run the bank sync](/how-to/run-the-bank-sync.md)):
  kasten records that a pull was asked for, and the job, polling every
  minute, does the pull. So bank logins never reach the backend, and a bank
  that hangs on a TAN holds up a job, not a request.
- **No index of the vault in the same schema.** The
  [pieces index](/explanation/models-on-the-vps/the-pieces-index.md) sits outside `finance` and
  stays disposable.
