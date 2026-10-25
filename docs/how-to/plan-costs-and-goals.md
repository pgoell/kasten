---
type: How-to Guide
title: Plan costs and goals
description: Confirm the plans kasten proposes from history, add and change a plan, see what is due this month and which booking met it, read the forecast, set a saving goal in a saving account, assign its contribution once a month, and move what the limits left into it.
tags: [finance, budget, plans, goals, pane, keys, phone]
status: draft
---

# Plan costs and goals

Plans are the bookings you expect: rent, insurance, a salary. Goals are money
you set aside in a saving account for something. Both live on the finance
pane's **Plans & goals** tab: open the pane with `<leader>gk` (on a phone,
the palette's `Open the finance pane`) and press `G` or tap the tab. How they
count in free to spend is in [Budget model](/reference/budget-model.md).

## Confirm the proposed plans

Under **Proposed from history** kasten lists plans it read from your bookings:
every bill Firefly kept, then payees you pay or that pay you about the same
amount every month or more. Nothing is a plan until you confirm it.

1. Read the line: amount, how often, where it came from, how often it was
   seen and when last.
2. Press the key on its button, `1` to `9`, or tap `Confirm`.

The plan is made as proposed and matched against your bookings at once. It
counts in free to spend from this month on, so the months already gone stay
as they were. A
proposal for something that is no bill, such as a supermarket you visit
weekly at the same price, is best left alone.

## Add or change a plan

1. Press `n` or tap `New plan`; for an existing one tap its `Edit`.
2. Fill in the name, the account, a text the booking holds in its purpose or
   name, the amount (tick `Money in` for income), how far it may be off, how
   often, the category, and the first date it is due. A last date is
   optional.
3. Press Enter or `Save`; `Escape` or `Cancel` leaves the form. `Delete`
   removes the plan; its bookings stay.

A cost every 2 months or more, such as a yearly insurance, sets aside its
monthly share: the plans list says how much. Its bill then comes out of that
reserve, not out of the month it is paid in.

## See what is due

**Due in** lists every date a plan falls due in the month shown. A `✓` means
a booking met it, with its day and amount, and `early` or `late` when it came
in the month before or after; a `○` means it is still to come. A salary due
after the cutoff day says which month it counts for. Step the month with `[`
and `]`.

**Forecast by plans** draws each month's end for mine and household as a
line, from today's bank balances and the plans alone; point at a month, or
Tab to it, to read its balance. `Every month` opens the figures as a table.
Flexible spending is not in it, so read it for the big moves, not to the
euro.

## Set a goal

1. Press `g` or tap `New goal`.
2. Name it, set the target and the date, pick the saving account it lives in,
   type what of that account's balance is already its own (`Reserved`), and
   what you plan to put in each month (`Monthly`). The field shows what the
   goal needs a month.
3. Press Enter or `Save`.

The goals of one account may together reserve no more than the account's
latest bank balance. Each account's `Not reserved on` line under the goals
says what is still free of goals.

## Work towards a goal each month

Each goal shows its reserved money against the target, the date, what each
month needs to reach it, and how much of this month's contribution has moved
into the account.

1. Move the money to the saving account at your bank. Once the bank sync
   brings the transfer in, the goal reads `moved this month ✓`. Until then the
   contribution still to move comes off free to spend.
2. Assign it: move to the goal with `j` and `k` and press `a`, or tap
   `Assign`. That adds this month's contribution to what the goal reserves,
   once: the goal then reads `assigned ✓`, and `a` does nothing more this
   month. `u` or `Undo` takes it back. The button is greyed out, and says
   why, when the account has not that much free of goals or no contribution
   is set.
3. To change the monthly contribution or the reserved amount, press `e` or tap
   `Edit`.

## Move what the limits left into a goal

`Left from limits` is what your category limits left at each month end. It is
another figure from an account's `Not reserved on`: the first is money your
limits did not spend, the second is money in a saving account no goal holds.

1. Move the money to the goal's saving account at your bank.
2. Tap `Move into a goal` beside `Left from limits`, on this tab or on the
   Overview's card of the same name.
3. Pick the goal and the amount (all of it at first) and press `Move`.

The goal reserves that much more and `Left from limits` drops by it. A goal
whose account does not hold the money yet refuses, and says how much it can
take.

The Overview's **Goals** card shows the same bars.
