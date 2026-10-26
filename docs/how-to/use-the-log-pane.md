---
type: How-to Guide
title: Use the log pane
description: Open the log pane, read a day's totals against your goals, log on today or another day, fix or delete an entry, and read the trends over 7, 30 or 90 days, with keys or by touch.
tags: [log, pane, food, phone, keys]
status: stable
---

# Use the log pane

The log card on a daily note is the quick way to log a drink or a food. The log
pane is where you look back over the days, fix an entry and log for a day that
has gone. Every entry stays a line under `## Log` in its daily note, as
[Log format](/reference/log-format.md) describes, so the pane writes nothing
the note does not show.

## Open the pane

* With keys: `<leader>gf`, or the palette's `Open the log`.
* On a phone: tap `log` in the row of buttons along the bottom edge.

The pane opens in the focused pane, as the todo pane does. Split first to keep
the note you were in beside it. The keys it takes are in
[The log pane](/reference/editor-keys.md#the-log-pane).

On a desktop the pane shows **Today** and **Trends** side by side. On a phone,
or in a pane too narrow for two columns, they stack, and on a phone two tabs at
the top, `Today` and `Trends`, switch between them. The day, the range and the
cursor stay as they were when you switch, and the keys work on either tab.

## Read a day

**Today** has a row for the day's kcal, protein, carbs and fat, then one for
each kind of the config note `99 Misc/01 Config/log.md`. A row gives the name,
the total, and where there is a goal, a meter and the goal in words: `at most
2,200, within` or `at most 2,200, over` for a ceiling, `at least 120` or `at
least 120, met` for a floor. A passed ceiling turns the warning colour; a floor
not met is just a shorter bar. A kind with no goal shows its total alone. Below
the rows are the day's entries, the food grouped by meal.

A kind marked `last`, such as weight, keeps its last value instead of adding up.
Its row has no meter. It shows the day's value, or with none the latest value
before the day and its date. Then come the 7-day average and the goal in words.
With no weigh-in in the range, the row says `no weigh-ins yet`. To add weight,
put this line in `99 Misc/01 Config/log.md`: `- ⚖ weight: kg, last`. A goal
goes at the end, as in `- ⚖ weight: kg, last, max 85`.

To see another day, press `h` or `l`, tap `‹` or `›`, or pick the date. `t`
or `Today` comes back.

## Log on any day

The buttons are the ones on the daily note's log card: a quick button per kind
with its total and meter, and `+ Food`. Tap a kind's button, or type an amount
first and then tap the button. `+ Food`, or `f`, opens the same food search and
barcode scan as the card, in the same sheet: a sheet from the bottom on a phone,
a panel at the pane's right edge over a dimmed pane on a desktop. `Escape`, a
tap on the dimmed part or a drag down closes it and gives the pane the keys
back. The line goes into the note of the day shown, and the sheet closes once
it is written; a refused write keeps it open. A day with no note gets one, made
the way `<leader>gd` makes a daily note.

A `last` kind's button shows the day's value, or with none the latest value
before the day, with its date. Type the number and press the button, and the
line is written, such as `- ⚖ 82.4 kg`. With the field empty, the button writes
nothing. It says `Type the weight in kg`, the field takes the focus, and its
placeholder reads `weight in kg`. Then Enter in the field writes the number. A
refused amount, such as `abc`, keeps the ask, so a fixed number can be typed and
Enter pressed. The ask ends once a line is written, when another kind's button is
pressed, or when the day changes.

## Fix or delete an entry

1. Move to the entry with `j` and `k`, or tap it.
2. Press `e` or `Enter`, or tap it. A form opens with the amount, or for a food
   the meal and the servings.
3. Change it and press `Save`. `Escape` or `Cancel` leaves it as it was.

`d` deletes the entry under the cursor. `u`, or the `Undo` button, puts it back
where it was. `o` opens the note at the entry's line.

An entry is written only when its line still reads as the pane showed it. If
the note changed meanwhile, or the note is open with text not yet saved, the
pane writes nothing and says why. Read the note again and retry.

## Read the trends

**Trends** covers the 30 days that end on the day shown. Press `7`, `3` or
`9`, or tap `7d`, `30d` or `90d`, to change the range. A day counts as logged
when its note has a `## Log`.

* The summary row comes first: the average kcal over the logged days; the days
  within the kcal goal, as `21 of 27` logged days; the streak, the logged days
  within the kcal goal in a row up to the day shown (a day with no food line
  ends it, even one with drinks logged; today with no food line yet does not);
  and for each `last` kind, such as
  weight, the change from its first weigh-in in the range to its last. It reads
  as `-1.2 kg` or `+0.4 kg`, with the words `from 83.6 to 82.4 kg`.
* A small chart for each kind, except a `last` kind, and for kcal, protein,
  carbs and fat, all the same size: a bar per logged day, the goal as a dashed line. A bar past a
  ceiling takes the warning colour, and the chart says in words how many days
  went over. A day with no log has no bar and does not count toward an average.
  When the range ends on today, today's bar is full strength and the days
  before it lighter. The overview draws its bars the same way
  ([Read the overview](/how-to/read-the-overview.md)).
* A line for each `last` kind, such as weight: a dot for each weigh-in, the
  7-day average as a thin line under the dots, and the goal as a dashed line if
  it has one. The scale runs from the lowest value to the highest, not from zero,
  so small changes show. The chart says in words how many weigh-ins it has and
  the change.
* The macro split: one bar of the average protein, carbs and fat as shares of
  their kcal, with the percentages under it.
* A table by week, newest first: average kcal, protein and water over the
  week's logged days, a column for each `last` kind with its mean weigh-in over
  the week, and the days logged, as `5 of 7`.
