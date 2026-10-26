---
type: Reference
title: Firefly import
description: The kasten-firefly-import command, its env file, what it reads from Firefly III and writes to kasten in what order, the source key of each booking and of each transfer half, the category kinds it guesses, how Firefly's rules become kasten's, and what a second run does.
resource: jobs/src/kasten_jobs/firefly_import.py
tags: [finance, jobs, firefly]
status: draft
---

# Firefly import

The one-shot job in `jobs/` that brings Firefly III's history into kasten. It
ships in the `kasten-backend` image as the command `kasten-firefly-import`, and
runs as a container on the docker network `web`. Running it is
[Import from Firefly III](/how-to/import-from-firefly-iii.md).

A one-off: it ran on the maintainer's server on 2026-10-25, and Firefly III
there is retired since (#1041). The code stays for anyone moving from Firefly,
and because the history it stored still carries `raw.firefly`, which the plan
proposals read for Firefly's bills.

## Command

| Command | What it does |
|---|---|
| `kasten-firefly-import --dry-run` | Reads Firefly and prints counts. Writes nothing anywhere. |
| `kasten-firefly-import` | Reads Firefly and imports, then prints counts. |
| `--skip-journal ID` | Leaves that Firefly journal out, in either mode. Repeat it for more. |

It exits `0` when done. Anything that fails, Firefly unreachable or a route
answering an error, stops it with a traceback and a non-zero exit; a second
run picks up where it stopped, since every step looks before it writes.

It prints counts only, never a booking.

## The env file

Read with `docker run --env-file`, mode `600`, at
`~/.config/kasten/firefly-import.env`. `jobs/firefly-import.env.example` lists
both.

| Variable | Default | Meaning |
|---|---|---|
| `FIREFLY_DATABASE_URL` | none | Firefly's Postgres as a libpq URL, `postgresql://user:password@postgres:5432/firefly`. The session is read-only, so no statement can change Firefly |
| `KASTEN_API` | `http://kasten-backend-prod:8000` | The backend, by its name on `web` |
| `FIREFLY_SKIP_JOURNALS` | empty | Journal ids to leave out, commas between, added to the `--skip-journal` ones |

The connection sets `default_transaction_read_only=on` itself, in place of
any `options` the URL carries.

## What it reads

From Firefly, SELECT only: every asset account; every withdrawal, deposit and
transfer that is not deleted, with its two transaction rows, its
`external_id`, its note, category, budget, bill and tags; the category names;
and the triggers of the rules in the `Auto-categorize` group.

Left out: opening balances (kasten takes balances from the bank, never from a
sum), the `Auto-budget` and `Subscriptions` rule groups, budgets, bills and
tags other than as names in `raw`, and piggy banks.

## What it writes, in order

1. **Categories**: each Firefly category kasten lacks that a journal or a
   translated rule names, by name, with the kind from
   [the table below](#category-kinds). One no journal and no rule names, such
   as `Subscriptions`, stays behind. One kasten already has keeps its kind.
2. **Rules**: each translated rule kasten lacks, compared by kind and pattern
   as stored. Rules come before bookings so the ingest sorts each booking as it
   comes in.
3. **Accounts**: each asset account, upserted by name. `kind` comes from
   Firefly's account role (`defaultAsset` and `sharedAsset` giro, `savingAsset`
   saving, `ccAsset` card, `cashWalletAsset` cash), `shared` is the shared role,
   and `bank` the name's first word for an account with an IBAN. A rerun writes
   these again over any change made in kasten. An account renamed in kasten
   makes a rerun fail with a `409`, since the Firefly name then makes a new
   account whose IBAN the renamed one holds: nothing is written twice.
4. **Bookings**: one per journal on each asset account it touches, in batches
   of 1,000. A booking whose key the account holds is skipped.
5. **`POST /api/finance/rules/run`**, once.
6. **Categories by hand**: for each booking whose journal had a Firefly
   category and whose kasten category differs or is empty,
   `PUT .../transactions/{id}/category`. A booking in a transfer is left alone,
   since a transfer takes no category. Where Firefly had none and a rule gives
   one, the rule's stays: kasten has no "none by hand".

## A booking's fields

| Field | From |
|---|---|
| `booking_date`, `value_date` | The journal's date, which is the bank's value date |
| `amount` | The asset account's transaction row, signed, to the cent |
| `purpose` | The description |
| `counterparty_name` | The journal's other account; `null` for Firefly's `Unknown payee` and `Unknown source`. Firefly named its expense and revenue accounts itself, so the payee a history booking gets may differ from the bank's raw name on new bookings: an "always for this payee" set on history then does not sort those |
| `counterparty_iban` | On a transfer, the other own account's IBAN, which kasten's linker pairs the two halves by. Else the first `IBAN: ...` in the note |
| `raw` | `{"firefly": {...}}`: the journal id, type, `external_id`, category, budget, bill, note and tags |
| `source_key` | Below |

## The source key

```
<external_id>:<n>
```

`external_id` is Firefly's, from `journal_meta`, as it stands and never
recomputed, except for a move between own accounts, below. `n` is the journal's place, from `0`, among the journals on the
same account with the same `external_id`, by date and then journal id. For a
bank booking this is the key the bank sync builds
([Bank sync](/reference/bank-sync.md#the-source-key)), so a pull that covers an
imported day skips what the import stored.

A move between own accounts, a transfer or a withdrawal or deposit whose note
names an own IBAN, takes the key the bank sync gives such a record
([Bank sync](/reference/bank-sync.md#a-move-between-own-accounts)),
`transfer:<lo>:<hi>:<date>:<amount>:<n>`: the two IBANs sorted, the journal's
date, and the amount without its sign to the cent. Firefly's own
`transfer:...` ids carry the same parts, but spell the amount as `500`,
`500.00` or `500.000000000000`, so the import rebuilds them. Both halves take
the same key, each on its own account. The first pull starts
`BANK_SYNC_OVERLAP_DAYS` before an account's newest imported booking, and
skips every move and booking the import stored on those days.

A journal with no `external_id` is keyed `firefly:<journal id>:0`, which no
bank key can equal. Firefly holds none such today: only the opening balances
lack one, and they are left out.

## Rules

Each trigger of an `Auto-categorize` rule becomes a kasten rule of its own,
since every such rule fires on any one trigger.

| Firefly trigger | kasten rule |
|---|---|
| `destination_account_contains`, `source_account_contains` | `payee`, on the pattern cleaned like a payee key |
| `description_contains` | `text_contains` |

Firefly matched a substring; a payee rule matches from the start of a word,
so a fragment such as `Lebensversic` still sorts `Lebensversicherung`, but a
pattern inside a word no longer matches. Firefly told a source trigger from a
destination trigger; kasten tells them apart by the category's kind, an
`income` rule sorting only money in and every other rule only money out, so
`Deloitte` for Salary leaves spending at a Deloitte payee alone. Step 6 puts
Firefly's category back on the history wherever the two still differ; only
new bookings feel it.

A pattern may sort each side once, so
`Globus.Markthalle` is a Groceries rule for spending and a Reimbursement rule
for money in. A trigger is left out, and named in the output, when its rule's
`set_category` action is off, when its pattern has no letter or digit, when
its type has no kasten rule, or when a trigger before it made the same kind,
pattern and side for another category. One that repeats a rule for the same
category merges into it.

## Category kinds

| Kind | Firefly categories |
|---|---|
| `income` | Salary, Interest, Reimbursement, Household contribution |
| `fixed` | Housing, Utilities, Telecom, Insurance & memberships, Subs (AI/tech), Subs (personal) |
| `saving` | Investments |
| `non_monthly` | Wedding, Travel, Gifts (given) |
| `flexible` | Every other one: Groceries, Dining, Shopping, Clothing, Personal care, Health, Transport, Entertainment & gaming, Sports & fitness |

## A second run

Changes nothing: the categories, rules and bookings are there, the rules move
nothing, and every category matches. The accounts are posted again with the
same values. A booking you sorted otherwise in kasten since is set back to
Firefly's category, so run it again only while Firefly is the record.
