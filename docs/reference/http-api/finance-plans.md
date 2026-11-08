---
type: Reference
title: "HTTP API: finance plans and goals"
description: The routes behind plans, contracts and goals, the plans and the bookings that met them, contract notes with their cancel-by dates, the dates a month holds, the 12-month forecast, plans proposed from history, and saving goals with each saving account's balance, reserved and unreserved.
resource: backend/src/kasten_backend/routes/finance_plans.py
tags: [api, backend, openapi, finance]
status: draft
---

# HTTP API: finance plans and goals

The routes the finance pane's Plans & goals tab and the overview read and
write. They sit beside [the finance routes](/reference/http-api/finance.md),
under the same `/api/finance/` prefix and gate, and answer `503` the same way
when there is no database. [Budget model](/reference/budget-model.md) says how
plans and goals count in free to spend; the code is
`routes/finance_plans.py` and `routes/finance_goals.py`.

Amounts are euros as JSON strings, to the cent. A plan's `amount` is signed
like a booking, a cost negative; every other figure here is positive.

## A plan

```json
{
  "name": "Haftpflicht", "account_id": 1, "payee_id": 12, "text": null,
  "amount": "-600.00", "tolerance": "5.00", "every_months": 12,
  "category_id": 7, "start": "2026-03-01", "end": null
}
```

* `payee_id` or `text`, at least one: a booking meets the plan by its payee,
  or by `text` found in its purpose or counterparty name, any case.
* `tolerance`: how far the booking's amount may lie from `amount`; `0` unless
  named.
* `every_months`: 1 for monthly (the default), 12 for yearly, any number of
  months from 1 to 120 between; `null` for a plan that falls due once, on
  `start`. Every date keeps the day of `start`, or the last day of a shorter
  month.
* `end`: the last day it may fall due, or `null`.

A plan without a payee or a text, or with `end` before `start`, is a `422`; so
is an account, payee or category that is not there.

## GET /api/finance/plans

Every plan, by name, each as above with its `id`, whether it `reserves` (a
cost every 2 months or more), the `share` it sets aside each month, and the
first of the month it was `confirmed` in, from which free to spend reads it.

## POST /api/finance/plans

Makes a plan from the body above, matches it against the bookings, and
answers it as `GET` does. `today` (`YYYY-MM-DD`) is required: the plan counts
from that month on, so one made from history leaves past months as they were.
A plan with the same account, payee, text, amount, schedule and start as one
already there is a `409`, so a second press makes no twin. A proposal is confirmed by posting it as
`GET /api/finance/plans/proposals` gave it, less its `key`, `source`, `seen`
and `last`.

## PUT /api/finance/plans/{plan_id}

Replaces a plan with the body, keeping the month it was confirmed in. Its
matches are dropped and made afresh. `404`
for a plan that is not there.

## DELETE /api/finance/plans/{plan_id}

Deletes a plan and its matches; the bookings stay. `204`, or `404`.

## GET /api/finance/plans/upcoming

Every date a plan falls due in `month` (`YYYY-MM`, required), by date, each
with the booking that met it or `null`. `timing` says whether that booking
came in the date's own month (`on_time`), the month before (`early`) or after
(`late`). `counts_for` names the month (`YYYY-MM`) a salary plan's date after
the cutoff day pays for, `null` otherwise.

```json
[
  {
    "plan_id": 3, "name": "Rent", "due": "2026-10-01", "amount": "-900.00",
    "category_id": 2, "reserves": false,
    "match": { "transaction_id": 812, "booking_date": "2026-09-30", "amount": "-900.00", "timing": "early" },
    "counts_for": null
  }
]
```

## GET /api/finance/plans/forecast

Mine's and household's balance at the end of this month and each of the 11
after it, by plans alone. `today` (`YYYY-MM-DD`) is required and names this
month. `balance` is the sum of each scope account's latest bank balance; a
date a booking met on or before that balance's day is left out, the balance
holding it already.

```json
{
  "mine": {
    "balance": "2403.00",
    "months": [{ "month": "2026-10", "planned_in": "0.00", "planned_out": "900.00", "balance": "1503.00" }]
  },
  "household": { "...": "the same shape" }
}
```

## GET /api/finance/plans/proposals

Plans read from history for the owner to confirm; nothing is written. `today`
(`YYYY-MM-DD`) is required. Firefly's bills come first, then payees paid or
paying about the same amount at a steady gap of a month or more. A proposal a
plan already covers, by its payee and account or by its name, is left out.

* **A Firefly bill**: the bookings the Firefly import kept the bill's name
  for (`raw.firefly.bill`). The schedule comes from all of them, the rest
  from those of the last 400 days; a bill with none then, or whose last is
  more than its gap plus half a month ago, is over and left out. The amount
  is their median; the
  tolerance the furthest any lies from it, rounded up to the euro; the
  account, payee and category those most of them have, and the counterparty
  name as `text` when they have no payee. The schedule is the median gap
  between them in months, rounded to 1, 2, 3, 4, 6 or 12; one booking makes a
  yearly bill. `start` is the first booking's day.
* **A recurring payee**: bookings of the last 400 days by payee, account and
  direction, without a Firefly bill. A payee booked every three weeks or more
  often, all its bookings read, is left out, such as a shop. Those within
  10 % (at least 1 euro) of
  the median count, and need to be 3 or more, at a median gap of 20 days or
  more, the last no longer ago than the gap plus half a month. The rest is
  read as for a bill. A payee a bill proposal covers is left out.

```json
[
  {
    "key": "bill:Haftpflicht", "source": "bill", "name": "Haftpflicht",
    "account_id": 1, "payee_id": 12, "text": null,
    "amount": "-486.00", "tolerance": "6.00", "every_months": 12,
    "category_id": 7, "start": "2025-03-02", "seen": 2, "last": "2026-03-01"
  }
]
```

## Contracts

A contract is a note in `03 Areas/03 Money/Contracts/` whose frontmatter has
`type: Contract`, `plan` (a plan's id, optional), `start`, `term`, `renews`,
`notice` and `ends`. A length is `12 months`, `1 year`, `6 weeks` or
`30 days`; `renews: none` ends with the term, and no `renews` renews monthly.
The term ends the day before `start`'s day that many months on, or on the
last day of a shorter month (BGB § 188); each renewal counts from the day
after it. A period's cancel-by is its end less `notice`, on the same day or
the last of a shorter month. `ends` set means cancelled: no cancel-by.

### GET /api/finance/contracts

Every contract note, by its next cancel-by date on or after `today`
(`YYYY-MM-DD`, required), those with none last; `yearly` is the sum of theirs.

```json
{
  "contracts": [{
    "path": "03 Areas/03 Money/Contracts/Haftpflicht.md", "name": "Haftpflicht",
    "plan_id": 14, "plan_name": "Haftpflicht", "amount": "-600.00", "every_months": 12,
    "yearly": "600.00", "cancel_by": "2026-11-28", "renews": "2027-03-01",
    "ends": null, "problem": null
  }],
  "yearly": "600.00"
}
```

`yearly` is what the plan costs a year, positive, `null` with no plan or one
that falls due once. `problem` names a field missing or unreadable, or
`plan 14 is gone`.

### POST /api/finance/contracts/reminders

Writes each contract note's next cancel-by todo under `## Cancel-by`, as
`- [ ] cancel or renegotiate <name>, renews <date> 📅 <cancel-by> ⏳ <four weeks before, not before today>`,
and answers the paths it wrote. `today` is required. An open todo there holds
the note; past a done or rejected one the next comes after its `📅`.

### POST /api/finance/contracts

Starts the note for `{"plan_id": 14}`, named after the plan, its id, name and
amount filled in and its terms left empty, and answers it as `GET` does,
`201`. `404` for a plan that is not there, `409` for a note already there.

## A goal

```json
{
  "name": "Wedding", "target": "12000.00", "due": "2027-04-01",
  "account_id": 5, "reserved": "600.00", "monthly": "500.00"
}
```

* `account_id`: an own saving account, not shared; any other is a `422`.
* `reserved`: what the owner assigns of the account's balance, `0` unless
  named. The goals in one account together may reserve no more than its
  latest bank balance; a write past it is a `422` naming what is unreserved.
* `monthly`: the contribution the owner plans, `null` for none.

## GET /api/finance/goals

Every goal by due date, and every own saving account. `today` (`YYYY-MM-DD`)
is required.

```json
{
  "goals": [
    {
      "id": 1, "name": "Wedding", "target": "12000.00", "due": "2027-04-01",
      "account_id": 5, "reserved": "600.00", "monthly": "500.00",
      "assigned_month": "2026-10", "assigned_amount": "500.00",
      "progress": "0.0500", "need": "1900.00",
      "this_month": { "planned": "500.00", "moved": "0.00", "done": false }
    }
  ],
  "accounts": [
    { "id": 5, "name": "Saving", "balance": "1000.00", "balance_date": "2026-10-09",
      "reserved": "600.00", "unreserved": "400.00" }
  ]
}
```

* `assigned_month` and `assigned_amount`: the month a contribution was last
  assigned, and how much, or `null`.
* `progress`: `reserved` over `target`, at most 1.
* `need`: what each month from this one to the due month must add to reach
  the target.
* `this_month`: the contribution planned and what of it moved into the
  account this month; `null` for a goal that has none this month.
* `unreserved`: the balance less what its goals reserve, below zero when the
  balance fell under it.

## POST /api/finance/goals

Makes a goal from the body above and answers it with its `id`, its amounts to
the cent, and `assigned_month` and `assigned_amount`.

## PUT /api/finance/goals/{goal_id}

Replaces a goal, so assigning more of the balance or another contribution is
one write. Only a change that reserves more, or moves the goal to another
account, is checked against the balance. `404` for a goal that is not there.

## DELETE /api/finance/goals/{goal_id}

Deletes a goal; what it reserved goes back to unreserved. `204`, or `404`.

## POST /api/finance/goals/{goal_id}/assign

Assigns this month's contribution: `reserved` rises by `monthly`, up to the
target, and the month and amount are recorded, in one conditional write so
two presses at once assign once. `today` (`YYYY-MM-DD`) is
required and names the month. A second assign in the same month, or one with
no contribution left to add, changes nothing; one past the account's balance
is a `422`. Answers the goal as `POST /goals` does.

## DELETE /api/finance/goals/{goal_id}/assign

Takes back the contribution assigned in `today`'s month: `reserved` drops by
it. A `409` when none was assigned that month.

## POST /api/finance/goals/{goal_id}/leftover

Moves part of what the limits left over into the goal. `today` (`YYYY-MM-DD`)
is required.

```json
{ "amount": "100.00" }
```

The move is dated `today`'s month. `amount` may be no more than what the
limits left by then less every move there is, and the goal's account must
hold it as for any reservation; either refusal is a `422`. The goal reserves
that much more, and the budget's leftover is less by it from that month on. Deleting the goal gives it back.
