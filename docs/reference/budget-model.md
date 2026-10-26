---
type: Reference
title: Budget model
description: How the finance budget counts money, the two scopes mine and household, free to spend and each part of it, plans, reserves and goals, where the month's money went, the salary cutoff, limits over time, the overspend carried into the next month, unreserved, status, pace and the suggestion to change a limit, with every threshold.
resource: backend/src/kasten_backend/finance_budget.py
tags: [finance, budget, reference]
status: draft
---

# Budget model

The budget reads the bookings in [the finance schema](/explanation/finance-in-postgres.md)
and works out two things: free to spend this month, and each spending
category against its limit. Its settings live in the database, not the code:
each category's kind, its limit, which income is salary and the salary cutoff
day. The routes are in [HTTP API: finance budget](/reference/http-api/finance-budget.md).

The code is `finance_ledger.py` (where each booking counts),
`finance_free.py` (free to spend), `finance_plans.py` (plans, reserves and
goals), `finance_flow.py` (where the money went), `finance_drill.py` (the
drilldowns) and `finance_budget.py` (limits). This page states what they do; a change to one changes this page.

## Months

A budget month is a calendar month, with one exception: a booking in a salary
category that arrives after the cutoff day counts for the next month. The
cutoff is 15 unless the settings say otherwise, so a salary on 20 September
pays for October. Only money in moves, and only in the categories the settings
name as salary. Every other booking counts in the month of its booking date.

There is no rolling forward. If a pay day moves across the cutoff, say from
the 14th one month to the 20th the next, one budget month gets two salaries
and the month after none. The real salary lands on days 18 to 21, well past
the 15th, so this has not happened; a cutoff close to the pay days would make
it common.

## Scopes

Each account belongs to one scope, or to none:

| Account | Scope |
|---|---|
| `shared` is true, any kind | household |
| not shared, kind `giro`, `card` or `cash` | mine |
| not shared, kind `saving` | none |

A booking counts in its account's scope. A booking on an own saving account,
such as interest, counts nowhere.

## Where a booking counts

A move between two own accounts (a booking with a `transfer_group`) counts by
where its other half is:

| Other half | Counts as |
|---|---|
| the same scope, such as giro to card | nothing |
| an own saving account | moved to saving, on this side's scope |
| mine, seen from household | income on household, "From mine" |
| household, seen from mine | a fixed cost on mine, "Into the shared account" |

So the 900 euros moved from the giro into the shared account is a fixed cost of
900 on mine and income of 900 on household, and nothing else. A move back the
other way counts the same lines with the sign turned round.

The two halves of a move often come in different pulls, and a half is only
linked once its twin is in. Until then a booking whose counterparty IBAN is an
own account's counts as a move to that account all the same, so the twin, when
it comes, does not count the money a second time.

Every other booking counts by its category's kind. A booking with splits counts
by its splits, each by its own category.

| Kind | Counts as |
|---|---|
| `income` | income, in that category |
| `fixed` | a fixed cost, in that category |
| `flexible` | flexible spending, in that category |
| `non_monthly` | non-monthly spending, in that category |
| `saving` | moved to saving |
| `ignore` | nothing |
| no category yet, money out | unsorted spending |
| no category yet, money in | nothing, until it is sorted |

Money in with no category is left out because it may be a refund as easily as
income; counting it would make free to spend look larger than it is. Spending
is net: a refund sorted into Groceries makes Groceries smaller.

## Free to spend

Free to spend is worked out for mine and for household apart, each from its
own lines:

```
free to spend = income expected
              - fixed costs
              - flexible spending so far
              - non-monthly spending so far
              - unsorted spending so far
              - moved to saving so far
              - reserved for plans
              - reserve shortfalls
              - goal contributions still to move
```

A bill a plan's reserve paid counts in none of the spending parts: the
reserve set its share aside in the months before.

* **Income expected**: for each salary category, and on household for "From
  mine", what arrived this month; while nothing has arrived, its average over
  the last 6 months. Every other income category, such as a household
  contribution or a refund, counts only what came in: a one-off payment must
  not raise every month after it.
* **Fixed costs**: for a fixed category with a plan in this scope, what it
  cost so far plus each of its plans' dates this month that no booking met
  yet, at the plan's amount (`basis` `plan`), or its average when that is
  larger (`basis` `average`): a cost no plan names yet still comes. A plan
  that reserves is left out here, since its bill comes out of the reserve,
  and a fixed category one reserves for counts what it cost so far and no
  average, which holds its bills from before. For every other fixed
  category, and on mine for "Into the shared account", the larger of what it
  cost so far this month and its average over the last 6 months. A cost that
  has not come yet is still counted.
* **Flexible, non-monthly and unsorted spending**: what went out so far.
* **Moved to saving**: what moved into an own saving account so far, less
  what came back, plus spending in a `saving` category.
* **Reserved for plans**: each reserving plan's monthly share, below.
* **Reserve shortfalls**: what a bill paid this month cost past what its
  reserve held, below.
* **Goal contributions still to move**: on mine, each goal's planned monthly
  contribution less what of it moved into the goal's account so far; below.

The average is the mean over the whole months before this one, at most 6,
counted from the first month that category, or that move between mine and
household, had money: a category made two months ago averages over two. A
month with nothing in it after that counts as zero. With no month before,
there is no average, and a line counts what happened so far.

A month that is over estimates nothing: each line counts what happened.

The answer gives each line with its `so_far`, its `average`, the figure it
`counted` and the `basis` of that figure (`so_far`, `average` or `plan`), so the
overview can say what the number is made of.

### Where the money went

The overview's sankey reads free to spend as if the month were over, so each
line counts what happened so far and nothing is estimated: a salary not in
yet and a fixed cost still to come are not drawn. Every rule above holds, as
it is the same reading. For each scope:

```
money in  = each income line + money taken from earlier months
money out = each fixed, flexible and non-monthly line + reserved + saved
            + not sorted + left over
```

* Each scope has its own kinds, in the order fixed, flexible, non-monthly,
  reserved, saved, into household, not sorted, then left over; a category gathers what
  both scopes spent on it.
* The move into the shared account is the kind `Into household` on mine and
  the source `From mine` on household, the same amount on both sides, so each
  scope adds up on its own.
* `Reserved` is the plans' reserve shares and the month's shortfalls; a bill
  a reserve paid is in no category's stream, as in free to spend.
* Left over is free to spend for a month that is over, when it is above zero.
  Below zero, the same amount comes in as `From earlier months`: the month
  spent past what came in.
* A line below zero changes sides: a refund larger than its category's
  spending, or savings drawn on, comes in as a source of its own; income paid
  back goes out.
* A category below 3 % of the money into both scopes folds into
  `Other <kind>`, and an income into `Other income`, when at least two of the
  same kind would; one alone keeps its name.

### Drilldowns

The drilldowns read the same lines, so a booking counts there where it
counts here ([HTTP API: finance drilldowns](/reference/http-api/finance-drill.md)):

* A scope's month is the sankey's: each part counts what happened, and what
  is left is free to spend for a month that is over.
* A category's month is its `spent` below, both scopes together, a bill a
  reserve paid included; the sankey draws that bill as reserved instead, so
  its stream is the category's month less what the reserve paid.
* A payee's month is its bookings' lines alone. Spending is money out in
  spending categories and not sorted; a move between own accounts is never
  spending, and its saved part is shown apart.
* An account is the one view by booking date, not budget month, as its bank
  balance is: the salary cutoff does not move its bookings.

## Plans

A plan is an expected booking: a payee or a text, an amount give or take a
tolerance, a schedule, an account and a category. It falls due on its start
date and then every `every_months` months on the same day (the last day of a
shorter month), until its end; a plan with no schedule falls due once.

**Matching.** A booking meets a plan's date when it is on the plan's
account, is no move between own accounts, has the plan's payee or holds its
text in its purpose or counterparty name (any case), and its amount lies
within the tolerance of the plan's. Every open period, the calendar month a
date falls in, first takes a booking of its own month; a period still open
after that takes one from the month before (paid early) or after (paid
late) no more than 20 days from the date. Of several, the one nearest the date wins, then the one nearest the
amount, and each booking meets one plan once. Matches are stored: they are made when
bookings come in and when a plan is made or changed (a changed plan loses its
matches and is matched afresh), never on a read. A date no booking met is
upcoming, even once past. A salary plan's date after the cutoff day says
which month it counts for.

**Confirmed.** A plan counts in free to spend from the month it was made or
confirmed in, never before: neither its reserve shares nor its fixed cost
change the months already gone. Matching still links its bookings from its
start, so the dates of past months show their ticks. Changing or deleting a
plan has no history of its own: the plan as it now stands is read for every
month from its confirmation on, so an edit changes those months too.

**Reserves.** A cost that comes every 2 months or more reserves. Its reserve
is walked month by month from the `every` months before its first date, or
from the month it was confirmed in when that is later. Each month sets aside
what the next bill still lacks over the months left to it, this one
included, rounded up to the cent: a twelfth of a yearly bill when the reserve
starts in time, more when a plan was confirmed late, and the whole bill when
it is due in the month the reserve starts. That share comes off free to
spend. The bill a match paid comes out of the reserve; what it cost past what
the reserve held is the month's `shortfall`, which comes off free to spend in
the bill's month, and what a cheaper bill left stays for the next. The
booking that paid the bill, or its splits, counts in no spending part of free
to spend, but the budget's categories still count it as spent.

**Forecast.** Each scope's balance for this month and the 11 after it starts
at the sum of its accounts' latest bank balances and adds every plan's dates
in the scope, but a date a booking met on or before the day of its account's
latest bank balance, which already holds it. Flexible spending and goal
contributions have no plan, so they are not in it.

## Goals

A goal is a target by a due date, living in one own saving account. The owner
assigns part of the account's latest bank balance to it as `reserved`; the
goals of one account together may reserve no more than that balance, and
what is left is the account's unreserved. Progress is reserved over target.
The monthly need is what is left of the target over the months from this one
up to and with the due month, rounded up to the cent; the due month is the
last a contribution comes off free to spend in.

The money reserved is already in the saving account, so it is off free to
spend from the day it moved. What comes off free to spend is the goal's
planned monthly contribution, set by the owner, as long as the goal is not
reached and the month is not past its due month. Free to spend counts it once:
what moved into the goal's account this month (`saved_into`) fills its goals
in order of due date, and only what is still to move comes off, on top of
moved to saving. A month that is over counts what moved, and nothing still to
move.

A balance that fell below what its goals reserve shows on the account's line;
lowering a reservation or renaming a goal is still allowed then, and only a
change that takes more of an account is checked against its balance.

Assigning is the owner's step, and happens once a month: it raises
`reserved` by the monthly contribution, up to the target and within the
account's balance, and records the month and the amount, so a second assign
that month changes nothing and the assign can be undone.

The leftovers of the limits, unreserved below, are another figure from the
saving account's unreserved: what the limits left of the spending accounts'
money. The pane calls the first "left from limits" and the second "not
reserved on" the account. Moving part of the leftover into a goal raises the
goal's `reserved` by it, within the account's balance (so move the money to
the saving account first), and records the move in the reader's month, which
comes off the leftover from that month on. A move may take no more than the
leftover less every move there is, so none spends what another took.

## Limits

Every fixed, flexible and non-monthly category is watched. A limit is a
monthly amount, set from a month on: the limit in force in a month is the one
set from that month or the latest before it. Changing a limit adds a row from
the month named, so the months before keep the limit they had. A row with no
amount takes the limit away from that month on.

A limit counts spending in both scopes together.

### Overspend and leftovers

At the end of a month:

* What a category spent past its limit comes off its limit the month after,
  as `carried`. `available` is the limit less `carried`, never below zero.
  The overspend is measured against the month's own limit, not what was
  available, so it is paid back once and never grows: spending 150 against a
  limit of 100 every month leaves 50 available every month, not less each
  time. A month with no limit carries nothing, and neither does the month
  after it.
* What a category left of its available limit goes to **unreserved**.
  `unreserved.last_month` is what the month before left; `unreserved.total` is
  what every month since the first limit left. Only months that are over
  count, so a month ahead adds nothing for the month still running.
  `unreserved.total` is less what was moved into goals by the month shown,
  which `unreserved.moved` gives.

### Status and pace

| Status | When |
|---|---|
| `over` | spent something, and more than `available` |
| `near` | a flexible category only: spent something, at least 90 % of `available`, or more than `expected_by_now` plus 10 % of `available` |
| `ok` | every other category with a limit |
| `null` | no limit |

`expected_by_now` is `available` times the share of the month gone, for
flexible categories only: on 10 October that is 10 / 31 of the limit. A fixed
or non-monthly cost is paid in one go, so rent at its limit on the first is
`ok`, not near.

### The average and the suggestion

Beside each limit stands the category's average over the last 6 whole months,
from its first month with money.
When the limit in force and the average have stood apart in the same direction
for 3 months running, the budget suggests raising or lowering the limit to the
average, rounded to the nearest 10 euros. Apart means a gap of at least 10 %
of the limit and at least 10 euros. Each of the 3 months is read with the
average as it stood at its end, against the limit in force now, so a limit
changed to fit stops the suggestion at once. The category's own history must
reach back 3 months. There is no suggestion for a non-monthly category, whose yearly cost
averages badly over months, nor one to lower a limit to nothing. A suggestion
never changes anything by itself; accepting it is a `PUT` of the limit.

## Settings

| Setting | Where | Starts as |
|---|---|---|
| Category kind | `PUT /api/finance/categories/{id}` | the kind the category was made with |
| Limit | `PUT /api/finance/categories/{id}/limit` | none |
| Salary categories | `PUT /api/finance/budget/settings` | the income category named `Salary`, marked by migration `0007` |
| Salary cutoff day | `PUT /api/finance/budget/settings` | 15 |
