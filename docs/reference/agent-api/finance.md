---
type: Reference
title: Agent finance routes
description: The routes and MCP tools under /agent/finance/, each the finance pane's own route behind the token, the contracts and their reminder pass among them.
tags: [api, agent, finance, backend]
status: stable
---

# Agent finance routes

Eleven `GET` routes under `/agent/finance/` and one `POST`, which writes
cancel-by todos into contract notes in the vault; no route writes to the
finance database. Each summary is the finance pane's own route, served a
second time behind the token, so it takes the same query and answers the
same JSON, to the cent; the pages
under [HTTP API](/reference/http-api.md) describe the shapes. `today` is always
the reader's local date, never the server's.

| Route | The pane's route | MCP tool |
| --- | --- | --- |
| `GET /agent/finance/budget?month=&today=` | [`GET /api/finance/budget`](/reference/http-api/finance-budget.md) | `monthly_by_category` |
| `GET /agent/finance/budget/free?month=&today=` | [`GET /api/finance/budget/free`](/reference/http-api/finance-budget.md) | `free_to_spend` |
| `GET /agent/finance/goals?today=` | [`GET /api/finance/goals`](/reference/http-api/finance-plans.md) | `goal_progress` |
| `GET /agent/finance/plans/forecast?today=` | [`GET /api/finance/plans/forecast`](/reference/http-api/finance-plans.md) | `plan_forecast` |
| `GET /agent/finance/plans/upcoming?month=` | [`GET /api/finance/plans/upcoming`](/reference/http-api/finance-plans.md) | `plan_forecast` |
| `GET /agent/finance/sync` | [`GET /api/finance/sync`](/reference/http-api/finance-sync.md) | `sync_status` |
| `GET /agent/finance/tax/{year}` | [`GET /api/finance/tax/{year}`](/reference/http-api/finance-tax.md) | `tax_year_summary` |
| `GET /agent/finance/transactions/{id}` | [`GET /api/finance/drill/bookings/{id}`](/reference/http-api/finance-drill.md) | `read_transaction` |
| `GET /agent/finance/transactions` | below | `list_transactions` |
| `GET /agent/finance/lookup` | below | `finance_lookup` |
| `GET /agent/finance/contracts?today=` | [`GET /api/finance/contracts`](/reference/http-api/finance-plans.md) | `list_contracts` |
| `POST /agent/finance/contracts/reminders?today=` | [`POST /api/finance/contracts/reminders`](/reference/http-api/finance-plans.md) | `write_contract_reminders` |

`plan_forecast` answers both plan routes in one object, `forecast` and
`upcoming`, for the month `today` falls in.

The reminder pass is the one the Plans & goals tab runs when it opens: each
contract note with no open cancel-by todo gets the next one, and the answer
is the paths written. It reads only the vault, so it runs with no database
too. `/close-day` reads `list_contracts` to name each contract whose
`cancel_by` falls in the next 14 days.

`GET /agent/finance/transactions` is a page of single bookings, newest first.
It takes the filters of [`GET /api/finance/transactions`](/reference/http-api/finance.md)
(`month` or `from` and `to`, `account`, `category`, `payee`, `text`, `order`,
`after`) and one more, `scope`: `mine` lists the own accounts that are not
saving accounts, `household` the shared ones. A month here is by booking date,
not the budget month a late salary counts in. `limit` is 100 unless given, at
most 500. Each booking comes without its raw bank record, which the single
booking route carries.

```json
{ "bookings": [{ "id": 812, "booking_date": "2026-10-02", "amount": "-120.00", "purpose": "Rewe", "splits": [] }], "next": 812 }
```

`next` is the `after` for the page that follows, and `null` on a page shorter
than `limit`. An `after` that names no booking, one deleted since, is `400`
rather than an empty page. A database that fails partway through a read
answers a tool with a short sentence, and the server log keeps the reason.

`GET /agent/finance/lookup` answers every account, category and payee, the
ids the filters and the summaries name:

```json
{ "accounts": [{ "id": 1, "name": "Giro", "kind": "giro", "shared": false }], "categories": [{ "id": 4, "name": "Groceries", "kind": "flexible" }], "payees": [] }
```

With no database, the self-host default, every finance route answers `503`
with the sentence the pane's routes give, and every finance tool fails with it.
Why agents read single bookings at all is in
[Finance reads past the boundary](/explanation/the-agent-boundary/finance-reads.md).
Tax figures come with the tax marks (#1040).
