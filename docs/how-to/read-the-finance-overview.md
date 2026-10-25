---
type: How-to Guide
title: Read the finance overview
description: Open the finance pane on its overview, read free to spend for mine and household and what makes each, see what to watch, the month's pace and where its money went, pull from the bank now, set and change a limit, take a suggested one, and find a booking.
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

The pane has four tabs, Overview, To sort, Transactions and Budget. Tap one,
or press `O`, `S`, `T` or `B`. Every tab but To sort reads one month, the
current one at first; `[` and `]`, or the `‹` and `›` buttons, step it. All
the keys are in [The finance pane](/reference/editor-keys.md#the-finance-pane).

## Read free to spend

The two big numbers are free to spend for **Mine** (your own giro, card and
cash) and **Household** (the shared account). The line under each says what
it is made of: the income expected this month, less fixed costs, flexible and
non-monthly spending so far, spending not sorted yet, and what you moved to
saving.

Open `How it adds up` for the line of each category. A line marked `average`
is an estimate: a salary not in yet counts as its 6-month average, and a fixed
cost counts as the larger of what it cost so far and its average. A number in
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
  Mine or Household, on into the kinds (fixed, flexible, non-monthly, saved,
  into household, not sorted), on into the categories. A stream that ends in
  `Left over` is what the month kept; one from `From earlier months`, in the
  danger colour, is what it spent past what came in. Mine's streams run
  above household's, and each kind's streams keep the kind's colour. The line
  above the chart sums the month up until you point at something. It counts what happened
  so far, not the estimates free to spend makes. Point at a stream or a name,
  or Tab to a name, to read its amount; press a category or an income to open
  its bookings for the month in Transactions. On a phone the chart scrolls
  sideways inside its card, and `Every stream` lists each amount as a table.
* **Unreserved** is what the limits left at each month end since they began,
  and what last month left.

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

## Find a booking

Open Transactions with `T`. The month shown's bookings are listed newest
first. Narrow them by account, category or text; `/` goes to the text field.
Sort the booking under the cursor as on the To sort list, with its category's
key or button, or `a` first for every booking of its payee
([Sort finance transactions](/how-to/sort-finance-transactions.md)).

## Related

* [Budget model](/reference/budget-model.md): every rule behind the figures
* [HTTP API: finance budget](/reference/http-api/finance-budget.md): the routes the pane reads
* [Run the bank sync](/how-to/run-the-bank-sync.md): the job "pull now" asks
