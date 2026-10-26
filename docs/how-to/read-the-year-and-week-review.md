---
type: How-to Guide
title: Read the year and week review
description: Read the year review at the top of a yearly note and the week review at the top of a weekly note, know what each section shows and how each number is worked out, and switch on the GitHub section.
tags: [review, year, week, periodic, github, todos, flashcards]
status: stable
---

# Read the year and week review

A yearly note opens with a review of its year. A weekly note opens with a review
of its week. The review holds the todos done, the time on them, the notes
written, the tags, the flashcards answered and the days logged. It also holds
the weight and the kcal. The year review adds Claude Code's tokens and cost. A
GitHub section joins it when the backend has a token.
Every number is worked out from what the notes already hold. The review writes
nothing into them.

## Where it shows

* The year review sits on `01 Periodic/04 Yearly/YYYY.md`, for example `2026.md`.
* The week review sits on `01 Periodic/01 Weekly/YYYY-Www.md`, for example
  `2026-W43.md`. The week is an ISO week, read off the name. Week 1 can start in
  the December before, and week 53 exists only in some years.
* The review draws under the title and the link row, in Read and in Edit. Your
  own text sits below it. A note with no title gets the review after its
  frontmatter, so it still shows.
* No other note gets a review. That includes `index.md`, a daily note and a note
  named any other way.

The review is drawn on the screen only. The file keeps the text you wrote, so
opening and leaving the note does not change it.

A year that has not begun says `2027 has not started.` A week that has not begun
says `This week has not started.`

A past year runs from Jan 1 to Dec 31. The current year runs to today. A week
runs from Monday to Sunday. Days are your own local days.

Each review reads under the same query keys as the other panes, so a write made
elsewhere reaches the review.

## The year review

The heading says `Year in review`, with the year under it. Six sections sit in
the main column, and a column of five numbers sits beside them.

### Projects

One row for each project with a todo done or a note written in the year. The
columns are Done, Time and Notes. The project's name is the last part of its
folder: `FDE` for `02 Projects/FDE`. Rows sort by time, then by done todos,
then by notes, most first, then by name.

* A todo belongs to the project the todo list gives it. That is the first of the
  five steps in [Tags, projects and views](/reference/todo-format/tags-projects-and-views.md#projects),
  so a `#p/x` tag on the line wins, then the folder the note sits in.
* A note belongs to the `#p/x` tag that comes first by name among its tags and
  names a project folder. Without one, it belongs to the project folder it sits in.
* Done counts the todos whose `✅` date falls in the year.
* Time adds up the `⏱` on those done todos. A done todo with no `⏱` adds nothing.
* Notes counts the notes written in the year that have a project.

With no row to draw, the section says `No project had a done todo or a note in 2026.`

### GitHub

See [GitHub](#github) below.

### Notes per month

One bar for each month, January to December, with the notes written in it. The
current month is drawn at full strength, and the other months are lighter. A
note counts on its day by the rule in
[What counts as a note written](/how-to/read-the-overview.md#what-counts-as-a-note-written),
the same rule the overview uses. The caption gives the total, as
`notes written per month, N in all`.

### Model use

One bar for each month, January to December, for the tokens Claude Code used in
it. A second set of bars shows the cost of those tokens in US dollars, at list
prices. Under them, a table has one row for each project, with its tokens and
cost for the year, tokens being input, output, cache write and cache read
together. When some tokens had no price, a line under the table gives them,
since the cost leaves them out.

The numbers come from the monthly notes the collector writes under the config
folder. [Model use format](/reference/model-use-format.md) describes them. The
collector runs on the computer that holds the Claude Code sessions:

```
mise run model-use -- ~/.claude/projects <vault>
```

Give both as absolute paths: the task runs in `backend/`.

It counts yesterday and today. For a backfill, pass `--from` with the first day,
such as `--from 2026-01-01`. With no usage line in the year, the section says
`No model use recorded in 2026.` and draws no number.

### Weight

A line of the weigh-ins over the year, with the 7-day average. The weight is the
log's kind with `last` in its line, the one [Log format](/reference/log-format.md)
describes. With no such kind, the section says `No weight kind in the log config.`
With no weigh-in in the year, it says `No weigh-ins in 2026.`

### Top tags

The ten tags that the notes written in the year carry most, with a count each.
A note counts a tag once, even when it repeats it. Ties sort by name. Each tag
shows its `#`. With no tags, the section says `No tags on the notes written this year.`

### The numbers

These five sit in the right column. Each is a plain count, except time.

* Todos done: the done todos in the year, by their `✅` date.
* Time logged: the time on those todos, the sum of their `⏱`. It is written as
  `45m`, `3h` or `12h 30m`.
* Notes made: every note written in the year, by the rule above.
* Flashcards answered: each card in a deck counts once, on the day of its last
  rating. A card rated again later in the year counts on that later day, and a
  card last rated after the year's end counts nowhere. The number is a lower
  bound, as [Read the overview](/how-to/read-the-overview.md#where-a-review-day-comes-from)
  says. Only cards in a deck count.
* Days logged: the days in the year whose `## Log` holds at least one line.

## The week review

The heading says `Week in review`. Under it sits the week's name and its days,
for example `2026-W43, Oct 19 to Oct 25`.

### Tiles

Four tiles sit in a row at the top.

* Todos done: the todos ticked done in the week, by their `✅` date.
* Time logged: the closed sessions under `## Time` in the week's seven daily
  notes, added up. A session still running counts nothing. A session that ends
  before it starts counts nothing too.
* Days within kcal: the days of the week with a food line within the kcal goal,
  shown as `N of 7`. A day of drinks only, or of weight only, does not count.
  Within means at or under a ceiling goal, at or over a floor goal. With no kcal
  goal, the tile says `no kcal goal`.
* Weight change: the last weigh-in on or before Sunday, less the last weigh-in
  before Monday. With no weigh-in before Monday, the first weigh-in of the week
  stands in for it. The change is shown to a tenth with its sign and unit, for
  example `-0.4 kg`. Where there is no change to read, as with one weigh-in in
  all, the tile shows no number. Its words say how many weigh-ins the week holds:
  none, one, or over the week.

When a read failed, the tile shows no number, and its words say why.

### GitHub line

One line under the tiles, `GitHub: 23 contributions this week`. See
[GitHub](#github) below.

### kcal per day

One bar for each day with a food line, Monday to Sunday, at its kcal. A day with no log
draws no bar, and nor does a day of drinks only, or of weight only. A food line of 0 kcal
draws a stub. The goal is a dashed line. Today's bar is at full strength.

### Todos per day

One bar for each day, the todos ticked done that day, by their `✅` date. The
caption gives the total.

### Done

The todos ticked done in the week, oldest first. A click or a tap opens the
todo's note at its line. With none, the section says `No todo ticked done this week.`

### Carried over

The open todos, neither done nor rejected, with a due date (`📅`) or a scheduled
date (`⏳`) in the window below. A todo counts on the earliest of those dates that falls in the
window. The window runs from Monday to the earlier of Sunday and yesterday, so a
todo dated today or later is not carried over yet. The list runs earliest date
first, and a click or a tap opens the todo's note at its line. With none, the
section says `Nothing carried over into today.`

### Flashcards

One bar for each day, the cards in a deck rated that day. Each card counts on the
day of its last rating, as in the year review. The caption says
`N cards rated this week, last rating only`.

## GitHub

The GitHub section shows how many contributions one GitHub user made each day.
The year review draws them as a grid, one square a day, and the week review
states the week's total. The review never shows the login or the token.

It is off until the backend has both a user and a token. Set them as
[GitHub settings](/reference/github-settings.md) describes. Until then the
section says:

`GitHub is off: the backend has no token.`

The same line shows when only one of the two is set.

If GitHub cannot be read, for example with a bad token or while GitHub is down,
the section says `GitHub could not be read.` and gives the status of the failed
read, such as `GET /api/github failed with 502`. The token is never in the words.

The backend keeps each day it reads in a file outside the vault. A day read on a
later day than itself is settled and is not asked for again. Any other day, today
among them, is asked again once the last read is an hour old. The cache file and
its location are in [GitHub settings](/reference/github-settings.md#kasten_github_cache_path).

## Related

* [Model use format](/reference/model-use-format.md): the monthly notes the model use section draws, and the prices behind its cost
* [Read the overview](/how-to/read-the-overview.md): the same counts on the overview's cards, and the streak rules
* [GitHub settings](/reference/github-settings.md): the three settings that switch the GitHub section on
* [HTTP API: notes](/reference/http-api/notes.md#get-apiwrittennotes): the route that dates the notes written
* [HTTP API: capture](/reference/http-api/capture.md#get-apigithub): the route that answers the GitHub counts
