---
type: How-to Guide
title: Read the overview
description: Open the overview, read its eight cards of scores and streaks, open the pane behind a card, and know what each number counts, the streak rules and what counts as a note written.
tags: [overview, log, flashcards, todos, streaks, phone, keys]
status: stable
---

# Read the overview

The overview shows how the week is going in one look: eight cards, each a big
number, a line of words and a small chart. Every number is worked out from what
the notes already hold, the `## Log` lines, the todo lines, the flashcard
schedules and the notes you wrote. The overview writes nothing and stores
nothing of its own.

## Open it

* With keys: `<leader>ga`, or the palette's `Open the overview`. `g o` was
  already `Show what this note links to`, so the overview takes `a`, for at a
  glance.
* From the home screen an empty pane shows: the `Overview` button by the date.
* On a phone: open the palette and pick `Open the overview`, or tap
  `Overview` on the home screen.

The overview opens in the focused pane, as the log pane does. On a desktop the
cards sit four across; in a narrow pane and on a phone they stand in one column.

## Move between the cards

* `h`, `j`, `k`, `l` or the arrow keys move between the cards, and Tab walks
  them in order.
* Enter, a click or a tap opens the pane behind the card with the focus.
* The leader works inside the overview, so `<leader>q` closes it and every
  other leader key does what it does elsewhere, with vim on or off.

## What each card says

| Card | Big number | Line of words | Chart | Opens |
| --- | --- | --- | --- | --- |
| Food | the food streak, `5 days` | `in a row within at most 2,200 kcal` | kcal per day over 14 days, the goal as a dashed line | the log pane |
| Today | today's kcal | how it stands against the kcal goal, `960 left` | a ring each for protein, carbs and fat against today's goals | the log pane |
| Weight | the latest weigh-in | the change over 30 days, or `no weigh-ins yet` | the weight line: a dot per weigh-in and the 7-day average | the log pane |
| Water | today's water | the goal in words, `at least 2,000, met` | water per day over 14 days, the goal as a dashed line | the log pane |
| Flashcards | the review streak, `4 days` | `in a row with a review`, and how many cards you rated today | cards rated per day over 14 days | the review pane |
| Todos | todos done today | how many are open and overdue | todos done per day over 14 days | the todo pane |
| Writing | notes written in the last 7 days | how many today | notes written per day over 14 days | today's daily note |
| This year | notes written this year | on how many days | a grid of the year, a column per week, a square per day | this year's note |

The charts speak one language, the one the log pane's Trends uses:

* A bar per day. On Food and Water a day with no log draws no bar and a logged
  zero a thin stub. On Flashcards, Todos and Writing every day counts, so a day
  with none draws the thin stub.
* The goal is a dashed line. A bar past a ceiling goal (`max`, such as kcal,
  coffee or alcohol) is drawn in the warning colour, and the words under the
  chart count those days, so the colour is never the only sign. A floor goal
  never warns.
* Today's bar is full strength and the days before it lighter.
* Rings only for the macros against today's goal, a line only for weight.
* Each chart carries a label a screen reader says, and the card's line of
  words says what it shows.

## The streak rules

A streak counts days in a row, back from today.

* **Food**: days in a row within the kcal goal. Within means at or under a
  ceiling goal, at or over a floor goal. With no kcal goal, it counts logged
  days in a row.
* **Flashcards**: days in a row with at least one card rated.

For both:

* A day with no log breaks the streak. For Food that is a day whose daily note
  has no `## Log`; for Flashcards a day on which no card was rated.
* Today does not break it while it has nothing yet, so a streak does not drop
  to zero in the morning. Once today has a log over the goal, it ends the Food
  streak.
* The Food streak looks back 90 days, the longest range the log pane reads; a
  streak longer than that reads as 90 days.

### Where a review day comes from

The vault keeps no history of ratings. A card holds three numbers, its due
date, its interval and its ease ([Reviewing cards](/reference/flashcard-format/reviewing-cards.md)),
and a rating always writes a due date of the rating's day plus the interval.
So the day a card was last rated is its due date less its interval, and every
schedule of a cloze line counts on its own. Only schedules in a deck, a note
the review pane asks cards from, count.

That gives the day of each card's last rating, not every rating it ever had.
A day shows as a review day while at least one card's last rating fell on it.
Rate a card again tomorrow and it moves to tomorrow, so a day long past can
drop out once every card rated on it has been rated again. On a deck you
review daily that rarely happens, but a streak can read shorter than the
days you really sat down. A note that is itself a card (its schedule in
`sr-due` and `sr-interval` at the top) is not counted, because the scan the
overview reads gives its due date alone.

## What counts as a note written

Writing and This year count notes by the day each note counts on in a search,
the same rule search's weekly bars use:

1. A note whose name starts with a date, such as a daily note, counts on that
   date.
2. Otherwise the `created` field at the top of the note, the day it was
   written, read on your own clock.
3. Otherwise the file's last change.

So a note counts once, on one day. A daily note counts on its own day even
when kasten made it for a log line, and a note with no `created` that you edit
today counts today. The archive folder is left out, as it is from search,
whether or not the archive is shown. A new or deleted note redraws the two
cards at once; an edit to a note already there moves it to today only when the
overview is next opened.

## Todos done

Todos counts a todo as done on the date its `✅` field says, on every `[x]` line
in the vault. A repeating todo leaves a done copy of each finished instance,
so each one counts on its day. The done log under `## Done` in the daily note
records the same events and is not counted a second time.

## Related

* [Use the log pane](/how-to/use-the-log-pane.md): the log pane behind Food, Today, Weight and Water
* [HTTP API: notes](/reference/http-api/notes.md#get-apiwritten): the read behind Writing and This year
* [Editor keys](/reference/editor-keys.md): every leader key
