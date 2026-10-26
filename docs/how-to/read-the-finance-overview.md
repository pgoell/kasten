---
type: How-to Guide
title: Read the finance overview
description: Open the finance pane on its overview, read free to spend for mine and household and what makes each, see what to watch, the month's pace, where its money went and the goals, drill down into a scope, account, category, payee or booking, read a quarter, a year or any months against a year before, pull from the bank now, set and change a limit, set every limit at once, and find a booking.
tags: [finance, budget, pane, keys, phone]
status: draft
---

# Read the finance overview

The finance pane opens on its overview: what you may still spend this month,
and what needs a look. How each figure is worked out is in
[Budget model](/reference/budget-model.md).

## Open the pane

* With keys: `<leader>gk`.
* On a phone: the palette's `Open the finance pane`.

The pane has five tabs, Overview, To sort, Transactions, Budget and Plans &
goals. Tap one, or press `O`, `S`, `T`, `B` or `G`. Every tab but To sort reads one month, the
current one at first; `[` and `]`, or the `‹` and `›` buttons, step it. All
the keys are in [The finance pane](/reference/editor-keys.md#the-finance-pane).

## Read free to spend

The two big numbers are free to spend for **Mine** (your own giro, card and
cash) and **Household** (the shared account). The line under each says what
it is made of: the income expected this month, less fixed costs, flexible and
non-monthly spending so far, spending not sorted yet, what you moved to
saving, what the plans' reserves set aside, and the goal contributions still
to move.

Open `How it adds up` for the line of each category. A line marked `average`
is an estimate: a salary not in yet counts as its 6-month average, and a fixed
cost counts as the larger of what it cost so far and its average. A fixed cost
with a plan counts what it cost plus its plans still to come. A `reserve` line
is a plan's monthly share for a bill that comes less often, with what the
reserve holds; a `goal` line is a contribution not yet moved into its saving
account. A number in
the danger colour with `⚠` means the month is already spent past what came in.

## See what needs a look

* **Watch** lists the categories over their limit first, then those near it,
  then those whose limit last month's overspend cut. With nothing to watch it
  says so, with a `✓`.
* **Pace** is flexible spending against the flexible limits. The tick on the
  meter is how far through the month today is; a fill past the tick by more
  than a tenth of the limits reads `ahead of the month ⚠`.
* **Spending** shows 12 months of spending, the month shown in full strength,
  and the month's limits as a dashed line. Point at a bar, or move to it with
  Tab, to read its month; press it to show that month.
* **Where it went** draws the month's money as streams: each income into
  Mine or Household, on into the kinds (fixed, flexible, non-monthly, reserved, saved,
  into household, not sorted), on into the categories. A stream that ends in
  `Left over` is what the month kept; one from `From earlier months`, in the
  danger colour, is what it spent past what came in. Mine's streams run
  above household's, and each kind's streams keep the kind's colour. The line
  above the chart sums the month up until you point at something. It counts what happened
  so far, not the estimates free to spend makes. Point at a stream or a name,
  or Tab to a name, to read its amount; press a category to open it
  (below). On a phone the chart scrolls
  sideways inside its card, and `Every stream` lists each amount as a table.
* **Left from limits** is what the limits left at each month end since they
  began, less what you moved into goals, and what last month left.
  `Move into a goal` moves part of it into one
  ([Plan costs and goals](/how-to/plan-costs-and-goals.md)).
* **Goals** shows each goal's reserved money against its target, the date,
  what each month needs to reach it, and whether this month's contribution
  reached the account; under them, what each saving account has not reserved
  for a goal
  ([Plan costs and goals](/how-to/plan-costs-and-goals.md)).

## Drill down

Press `Mine ›` or `Household ›` over a big number, or a category in **Where
it went**, to open it. Each view reads the month shown, and `[` and `]` still
step it. The breadcrumbs over the view say where you are, such as
`October 2026 › Groceries › REWE`; press one to go back to it, or press
`Escape` to step back one. From the month, `Escape` goes back to the editor.

* **A scope** gives its month as the sankey draws it, income less each part,
  and what was left; its spending month by month, with `Every month` as a
  table; its accounts with their latest bank balance; and its bookings.
* **An account** gives its balance at each month end, counted from the bank's
  balances and the bookings between; the month's money by category; the
  transfers to and from your other accounts; and its bookings. It reads
  bookings by booking date, as the bank does, so a salary booked on the 20th
  sits in that month here.
* **A category** gives 12 months of bars against what its limit made
  available, with its average; its payees in the month; the plans and rules
  that book into it; and its bookings.
* **A payee** gives its spending each month, how many bookings and the
  average, and the categories its money went to. Pick a category, then
  `Make it the default` to sort this payee's bookings into it, or
  `Add a rule` to sort every payee whose name starts the same way.
* **A booking** gives every field and its raw record, where it counts in the
  budget, the plan it met and the other half of a transfer. Sort it again
  with a category's key or button, as on To sort. To split it, press
  `Split into parts`, then `Add a part` for each further part; type each
  amount and what it was, and press `Save the splits` once the parts add up.
  Then sort each part. Remove every part and press `Save, whole` to make it
  one booking again.

The bookings a view lists are those that count in the month, so a salary
booked after the cutoff day shows in the month after. Tap one, or move with
`j` and `k` and press Enter, to open it.

A view's figures are the overview's own: a scope's month adds up to what the
sankey shows for it, and a category's month is its `spent` on Budget. A bill
a plan's reserve paid counts in its category there, and the view says how
much of it the reserve paid.

## Read a quarter, a year or any months

On the overview and in a drilldown, the `Span` list over the view reads
`Month`, `Quarter`, `Year` or `Custom`. A quarter or a year is the one the
month shown is in, and a custom span is the months you pick, first and last.
`[` and `]`, or `‹` and `›`, step a whole span. A span never runs past this
month, so the year still running reads `2026 so far`.

Over more than one month the big numbers are what each scope kept over the
span, with the parts it is made of; **Where it went** draws the whole span,
so a month that spent past what came in nets against the others. Watch,
Pace and Left from limits read one month and step aside.

**Compared** sets each scope's span against the same months a year before
and against the 6 months before it, taken as many times as the span has
months, with the change in percent. `no data` means the history does not
reach back a year; a span that ends this month reads `so far`, since this
month holds only the days gone. A category's view gives the same three
figures and what its limits made available over the span. Press a bar in a
chart to read that month alone.

## Pull from the bank now

The **Bank** card says when the last good pull was and whether the last run
worked. Press `P` or `Pull now`. The bank job sees the request within a
minute and sends a push TAN to your phone; approve it. The card reads
`Waiting for the bank job…` and follows the run until it ends. A card in the
danger colour means no pull has worked for 7 days.

## Set or change a limit

1. Open Budget with `B`.
2. Move to the category with `j` and `k`, or tap it.
3. Press `e`, or tap `Edit limit`, type the monthly amount and press Enter or
   `Save`. An empty field takes the limit away. `Escape` leaves the field.

The limit counts from the month shown on, so set it on the month it should
start. The months before keep the limit they had.

When a limit and the category's average have stood apart for 3 months, the row
offers `Raise to …` or `Lower to …`. Press `y`, or tap it, to take it.

## Set every limit at once

1. Open Budget with `B`, and press `s`, or tap `Set up every limit`.
2. Each spending category has a field holding its limit in force. Beside it
   stand its 6-month average and a suggestion: the larger of what its
   monthly plans cost and its average. A yearly bill a plan reserves for is
   not in the suggestion, since the reserve pays it.
3. Press `u`, or tap `Use suggestions`, to fill every field with its
   suggestion, then change what you want. The line under the table adds the
   fields up against the income the month expects, and says what is left, or
   how far over.
4. Press `Save`. Only the limits you changed are written, from this month
   on, whatever month the pane shows, so no month already over changes. An
   empty field takes a limit away. `Escape` goes back to Budget.

## Find a booking

Open Transactions with `T`. The month shown's bookings are listed newest
first. Narrow them by account, category or text; `/` goes to the text field.
Sort the booking under the cursor as on the To sort list, with its category's
key or button, or `a` first for every booking of its payee
([Sort finance transactions](/how-to/sort-finance-transactions.md)). Enter
opens the booking under the cursor.

## Related

* [Budget model](/reference/budget-model.md): every rule behind the figures
* [HTTP API: finance budget](/reference/http-api/finance-budget.md): the routes the pane reads
* [HTTP API: finance drilldowns](/reference/http-api/finance-drill.md): the routes the drilldowns read
* [Run the bank sync](/how-to/run-the-bank-sync.md): the job "pull now" asks
