---
type: Reference
title: "HTTP API: finance sync"
description: The four routes behind "pull now" and the bank sync status, that the bank job polls, starts and finishes its runs through, with the claim two pollers race for.
resource: backend/src/kasten_backend/routes/finance_sync.py
tags: [api, backend, openapi, finance]
status: draft
---

# HTTP API: finance sync

Kasten never talks to a bank. The bank job on the host does
([Run the bank sync](/how-to/run-the-bank-sync.md)), and these routes are where
the two meet: a "pull now" waits here until a run claims it, and each run
records its outcome and, per account, the window it fetched. The status they
add up to is what the finance pane and agents show.

They sit beside the other finance routes, behind the same gate and with the same
`503` when no database answers; [HTTP API: finance](/reference/http-api/finance.md)
says who reaches them. Times are UTC.

## GET /api/finance/sync

The status. The job reads it every minute, so it stays cheap.

```json
{
  "requested_at": "2026-10-25T08:00:00Z",
  "last_run": {
    "id": 12, "trigger": "scheduled", "started_at": "2026-10-24T15:00:02Z",
    "finished_at": "2026-10-24T15:01:10Z", "outcome": "failed",
    "error": "psd: TAN not approved within 240s"
  },
  "last_success_at": "2026-10-23T15:00:40Z",
  "days_since_success": 2,
  "accounts": [
    {
      "account_id": 1, "name": "DKB Girokonto", "iban": "DE02120300000000202051",
      "last_good_through": "2026-10-24", "last_good_at": "2026-10-24T15:01:10Z",
      "days_since_success": 0, "newest_booking": "2026-10-24"
    }
  ]
}
```

* `requested_at`: when the oldest open "pull now" was made, `null` when none
  waits.
* `last_run`: the newest run, finished or not; `null` before the first.
  `finished_at` and `outcome` stay `null` while it runs.
* `last_success_at` and `days_since_success`: the newest run whose outcome was
  `ok`, and the whole days since. Both `null` when none ever was.
* `accounts`, one row per account by name: `last_good_through` is the last day
  of the newest window fetched for it without error, even in a run that failed
  for another account, and `last_good_at` when that run finished.
  `newest_booking` is the latest booking date stored. The job starts its next
  window from these ([Bank sync](/reference/bank-sync.md#the-window)).

## POST /api/finance/sync/requests

"Pull now". Records a request, or answers the one still open, so pressing twice
asks once. No body.

```json
{ "id": 4, "requested_at": "2026-10-25T08:00:00Z", "run_id": null }
```

The job sees it within a minute and starts a pull, which sends a push TAN to the
phone. `run_id` is the run that claimed it.

## POST /api/finance/sync/runs

Starts a run. `trigger` is `request` when the job found a request open, or
`scheduled` for its own daily pull.

```json
{ "trigger": "request" }
```

```json
{
  "run": { "id": 13, "trigger": "request", "started_at": "2026-10-25T08:00:41Z", "finished_at": null, "outcome": null, "error": null },
  "claimed": 1
}
```

The run claims every open request at once, since one pull serves them all; a
scheduled run claims them too. `claimed` counts them.

`409` when:

* another run is starting at the same moment. A start holds a database lock
  until it commits, and a second start that finds it held is turned away rather
  than queued, so two pollers never both pull, and never send two TANs.
* another run has not finished and started less than 30 minutes ago. An older
  unfinished run died without saying so and no longer blocks.
* the trigger is `request` and no request is open, because another poller
  claimed it first.

The job takes a `409` as "nothing to do" and exits `0`.

## PATCH /api/finance/sync/runs/{run_id}

Finishes a run, once, with a line per account it reached. Answers the run as
`POST` shows it.

```json
{
  "outcome": "failed",
  "error": "psd: TAN not approved within 240s",
  "accounts": [
    { "account_id": 1, "fetched_from": "2026-10-19", "fetched_through": "2026-10-25", "outcome": "ok", "created": 3, "skipped": 41 }
  ]
}
```

`outcome` is `ok` or `failed`, on the run and on each line. `error`, `created`
and `skipped` may be left out. At most 100 lines.

* `404` for no such run.
* `409` for a run already finished: its record stays as the first finish wrote
  it.
* `422` naming every account id that does not exist, and nothing is written.
