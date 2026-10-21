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

## Read a day

**Today** shows a bar for each kind against its goal from the config note
`99 Misc/01 Config/log.md`: a ✓ once a floor is met, a red ⚠ past a ceiling,
and a plain total for a kind with no goal. Below it are the day's kcal,
protein, carbs and fat, then the entries, the food grouped by meal.

To see another day, press `h` or `l`, tap `‹` or `›`, or pick the date. `t`
or `Today` comes back.

## Log on any day

Tap a kind's button, or type an amount first and then tap the button. `+ 🍽 food`
opens the same food search and barcode scan as the card. The line goes into
the note of the day shown. A day with no note gets one, made the way
`<leader>gd` makes a daily note.

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

**Trends** draws each kind over the last 30 days, a bar per day that has a
`## Log` and the goal as a dashed line. Press `7`, `3` or `9`, or tap `7d`,
`30d` or `90d`, to change the range. Food gets its kcal per day and the average
split of protein, carbs and fat. A day with no log draws no bar and does not
count toward an average.
