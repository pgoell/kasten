---
type: Reference
title: Bank sync
description: The bank sync job's commands and exit codes, its env file, the files it keeps on the server, where each window starts, and the source key it stores a booking by, which the Firefly import must compute alike.
resource: jobs/src/kasten_jobs/bank_sync.py
tags: [finance, jobs, fints]
status: draft
---

# Bank sync

The job in `jobs/` that pulls DKB and PSD over FinTS and writes the bookings
through [the finance routes](/reference/http-api/finance.md). It ships in the
`kasten-backend` image as the command `kasten-bank-sync`, and runs as a one-shot
container on the docker network `web`. Setting it up is
[Run the bank sync](/how-to/run-the-bank-sync.md).

## Commands

| Command | What it does | Exit code |
|---|---|---|
| `poll` | Asks [`GET /api/finance/sync/requests/open`](/reference/http-api/finance-sync.md#get-apifinancesyncrequestsopen). Ends at once when no "pull now" waits; else starts a run with trigger `request` and pulls. Meant for every minute. | `0` nothing to do, or the pull came in; `1` the pull failed |
| `pull` | Starts a run with trigger `scheduled` and pulls. The one daily attempt. | as `poll` |
| `check` | Fails when no run has succeeded for `BANK_SYNC_STALE_DAYS`, or ever. Touches no bank. | `0` fine; `1` stale |
| `setup <bank>` | Logs in by hand, approves the TAN, picks the push TAN method and saves the state. Run once per bank, with a terminal. Touches no kasten. | `0` done |

A run that another run beat to the start (a `409`) exits `0`. A run fails when
any bank or account failed: a login refused, a TAN not approved within 240
seconds, a TAN to type rather than a push, an error on one account, or an IBAN
no kasten account holds, or kasten refusing an account's post (the run records
kasten's answer, cut to 500 characters). The other accounts and banks still
come in, and the run records which failed. Anything else stops the job with a traceback and exit `1`, and
the run is still marked failed in kasten.

## The env file

Read with `docker run --env-file`, so the file is never mounted. Mode `600`.
`jobs/bank-sync.env.example` in the repo lists them all.

| Variable | Default | Meaning |
|---|---|---|
| `KASTEN_API` | `http://kasten-backend-prod:8000` | The backend, by its name on `web` |
| `BANK_SYNC_BANKS` | `DKB,PSD` | The banks to pull, as the prefixes of their variables |
| `<BANK>_BLZ`, `<BANK>_LOGIN`, `<BANK>_PIN`, `<BANK>_FINTS_URL` | none | One login per bank, the names the Firefly importer read. All four are needed |
| `BANK_SYNC_STATE_DIR` | `/state` | Where the state blobs live inside the container |
| `BANK_SYNC_OVERLAP_DAYS` | `14` | How many days before the last good window's end the next starts |
| `BANK_SYNC_SKIP_IBANS` | empty | IBANs the bank lists that kasten should not track, comma-separated, spaces ignored. Neither fetched nor an error |
| `TZ` | UTC | The box's zone, `Europe/Berlin`, so a window ends on the bank's day |
| `BANK_SYNC_FIRST_DAYS` | `90` | How far back a first pull of an account with no bookings goes |
| `BANK_SYNC_STALE_DAYS` | `7` | When `check` fails |

The PIN is never logged: the job leaves it out of every object it logs, and
turns python-fints' own logging down to warnings, as its debug output carries
whole bank messages.

## Files on the server

| Path | Mode | Holds |
|---|---|---|
| `~/.config/kasten/bank-sync.env` | `600` | The env file, logins and PINs |
| `~/.config/kasten/fints/` | `700` | The state, mounted read-write at `/state` |
| `~/.config/kasten/fints/<bank>.bin` | `600` | One bank's FinTS client state (`deconstruct(including_private=True)`): the chosen TAN method, the bank's parameters, the system id. Written by `setup` and after every pull, to a new file moved over the old, so a killed job never leaves half a state |

None of it is in the repo or in `~/kasten-data/`, which holds data only.

## The window

Each account's window ends today and starts at the first of:

1. its `last_good_through` minus `BANK_SYNC_OVERLAP_DAYS`, so a booking the
   bank posts a few days late still comes in;
2. its `newest_booking`, on a first pull after the Firefly history came in;
3. `BANK_SYNC_FIRST_DAYS` back.

Both days are included. The overlap costs nothing: a booking whose account
already holds its key is skipped. It is also what keeps the occurrence index
below honest. The bank picks a window's records by booking date, but the key
holds the value date, so twins are counted right only while one window sees
them all: the job assumes twins are booked within `BANK_SYNC_OVERLAP_DAYS` of
each other, and that the bank lists them by booking date. A twin booked later
than that is taken for the first and dropped. Two weeks is far beyond what
banks take between two identical bookings of one value date.

## The source key

```
<bank>:<iban>:<date>:<amount>:<ref>:<digest>:<n>
```

Everything before the last `:` is the `external_id` the Firefly importer wrote,
built the same way from the same record:

* `bank`: the lowercase prefix, `dkb` or `psd`.
* `iban`: the IBAN as the bank's account list spells it.
* `date`: the record's `date`, the value date, in `YYYY-MM-DD`. Not the booking
  date (`entry_date`), which kasten stores as `booking_date`.
* `amount`: the signed amount as Python prints a `Decimal`, `-4.20`.
* `ref`: `prima_nota`, else `end_to_end_reference`, else empty.
* `digest`: the first 12 hex digits of the SHA-1 of `purpose` and
  `posting_text` joined by a space, the missing ones left out, stripped, in
  UTF-8.
* `n`: the record's place, from `0`, among the records of one fetch whose
  prefix is the same, in the bank's order. Two coffees of one price on one day
  are `:0` and `:1`.

### What the Firefly import computes

For each Firefly withdrawal or deposit whose `external_id` has the shape above
without `:n`, the import (#1033) takes that `external_id` as it is, never
recomputing it, and appends `:n`, where `n` counts the Firefly journals on the
same account with the same `external_id`, from `0`, by date and then journal id.
The bank pull then names the same booking alike, and the ingest skips it.
Firefly sometimes kept only one of two twins, because the importer dropped a
booking whose `external_id` an earlier run had stored. The pull then sends
`:1` for the second, which kasten stores: a booking recovered, not a
duplicate.

Two cases the key cannot cover:

* Firefly's own-account moves carry `transfer:<iban>:<iban>:<date>:<amount>`,
  with neither reference nor purpose, so no bank key can be built for either
  half. The import needs a key of its own for those, and a move on the
  account's newest day can then come in twice, once from Firefly and once from
  the first pull, since that pull starts on that day.
* A record the bank changes after the fact (a purpose filled in later) gets a
  new key and is stored twice. Firefly had the same weakness.
