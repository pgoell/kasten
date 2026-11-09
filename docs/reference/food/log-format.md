---
type: Reference
title: Log format
description: How a daily note logs water, coffee, alcohol and food as lines under ## Log, every kind and its fields, the config note that sets the card's kinds and daily goals, what does not parse, how a day adds up, and the table of cases the parser is tested against.
resource: frontend/src/lib/log/log-cases.json
tags: [vault, log, format, backend]
status: stable
---

# Log format

The day's water, coffee, alcohol and food are lines in its daily note, under
`## Log`. The line is the record, as a todo is: nothing about an entry lives
anywhere else, so Obsidian or `cat` shows all of it, and the note's date is the
entry's date. `GET /api/log` reads the lines and adds them up; see
[the HTTP API](/reference/http-api/log.md).

```markdown
## Log
- 💧 500 ml
- ☕ 1
- 🍺 2 0.5 l 5%
- 🍽 lunch: Skyr 250 g 🔥 160 kcal 🥩 27 g 🍞 10 g 🧈 0 g
```

## Where an entry sits

1. The daily note is `<periodic>/00 Daily/YYYY-MM-DD.md`, the note `<leader>gd`
   makes. A note in that folder named otherwise holds no entries.
2. An entry is a line under a heading that reads exactly `## Log`, at the
   start of the line, one space after the hashes, trailing spaces allowed, up
   to the next line that opens with `# ` or `## `. A `###` inside the section
   is part of it. A note may hold more than one `## Log`; each counts.
3. A line inside a fenced code block, in the section or around it, is no entry,
   and a `## Log` inside one opens no section. The frontmatter is no section
   either, and a fence it seems to open opens nothing in the note. A line of inline triple-backtick code, `` ```x``` ``, opens no fence either, so the log lines after it still count.
4. The line opens with `- ` at the start, with no indent, then the marker. A
   todo box, `- [ ] 💧 500 ml`, makes it a todo and no entry.

## The kinds

Every marker may carry the variation selector U+FE0F, so `☕️` reads as `☕`.
Spaces or tabs, one or more, part the pieces. A number is one to nine digits
with an optional decimal part of one to nine digits, and the decimal mark is a
point or a comma: `0.5` and `0,5` are the same. Units ignore case.

| Kind | Line | Fields |
| --- | --- | --- |
| water | `💧 500 ml`, `💧 0,5 l` | an amount above zero in `ml` or `l`, the space before the unit optional |
| coffee | `☕ 2` | a count, a whole number from 1 |
| alcohol | `🍺 2 0.5 l 5%` | a count from 1, then an optional volume per drink in `ml` or `l`, then an optional strength from 0 to 100 with `%` |
| food | `🍽 lunch: Skyr 🔥 160 kcal 🥩 27 g` | an optional meal and `:`, the words, then the fields |

Water, coffee and alcohol lines hold the marker and their fields and nothing
else: `- 💧 500 ml with lemon` does not parse. Alcohol's pieces come in the
order above.

An alcohol line's volume is per drink, so `🍺 2 0.5 l` is a litre. Where it
gives both a volume and a strength, it also carries the grams of alcohol:
count x volume in ml x strength / 100 x 0.789, the density of ethanol. So
`🍺 1 0.5 l 5%` is 19.7 g.

### The food line

1. After the marker, an optional meal: `breakfast`, `lunch`, `dinner` or
   `snack`, in any case, with `:` straight after it. `lunch Skyr` names no
   meal; its words are `lunch Skyr`.
2. Then the words, up to the first field. They may hold numbers and units,
   `Skyr 250 g`, since a field opens with its marker.
3. Then the fields, in any order, each at most once: `🔥` kcal, `🥩` protein,
   `🍞` carbs and `🧈` fat, each a marker and a number from 0, its unit (`kcal`
   or `g`) optional.
4. After the first field only fields follow. Anything else after it, or a
   field given twice, and the line does not parse.
5. A marker inside a code span, a wikilink or a markdown link is part of the
   words: `` 🍽 `🔥 9` toast 🔥 120 `` holds one field.
6. The line holds words or a field; `🍽` alone does not parse.

## What does not parse

A line that breaks a rule above stays a plain bullet and counts for nothing:
an unknown marker, a missing or zero amount, a count that is no whole number,
a number of ten digits or more, a strength over 100, a unit other than the kind's, trailing words on water,
coffee or alcohol, a marker inside a code span or a link (`` - `☕ 1` ``,
`- [[☕ 1]]`).

## How a day adds up

| Kind | Totals |
| --- | --- |
| water | `ml` |
| coffee | `count` |
| alcohol | `count`, `ml` (lines with a volume), `grams` (lines with both a volume and a strength) |
| food | `kcal`, `protein`, `carbs`, `fat` in grams, each over the lines that give it |

A day whose note holds a `## Log` answers every kind, zero where nothing was
logged, except a last kind with no line that day, which is `null`. A day without
a `## Log` is absent, not zero. Totals are rounded to one
decimal once, after the sum, half to even as Python's `round` does: 0.25 g is
0.2 g. An alcohol entry's own `grams` is rounded the same way.

## The card

A daily note in live preview shows a card under the title and a one-line weather row. From the top, the card holds:

* The big number: kcal left for the day, with `eaten of goal, at most` under it and one bar. With no kcal goal it shows kcal eaten, with no `left` and no bar. Past the goal it reads `N kcal over`, with the bar full and the warning colour beside the words.
* Rings for protein, carbs and fat. Each has a text label and its goal written out, as `of 120 g, at least`. A macro with no goal shows its grams and no `of`.
* A quick button per kind in the config note, each with its total and a goal meter.
* `+ Food`, the main button.
* The day's entries under breakfast, lunch, dinner and snack, with kcal for each meal and protein, carbs and fat for each entry. A food line with no meal sits under `No meal`. An empty meal offers `Copy yesterday's <meal> (<n> lines)`, shown only when yesterday's note has lines for that meal.
* A fold at the bottom with the raw `## Log` lines.

A tap on `Copy yesterday's <meal>` writes each of yesterday's lines for that meal into today's note, as yesterday holds them, never rebuilt. The copy is one change at the end of `## Log`, so `u`, undo and the card's `Undo` take every copied line back at once. Yesterday's note does not change. The offer waits for yesterday's read and shows only once it answers with lines.

A tap writes
`- 💧 250 ml`, `- ☕ 1` or `- 🍺 1` at the end of `## Log`, making the section
at the end of the note where there is none. The field beside the buttons takes
another amount for the next tap: `500` on water writes `- 💧 500 ml`, and
`2 0.5 l 5%` on alcohol writes `- 🍺 2 0.5 l 5%`. An amount that does not
parse as that kind writes nothing, and the card says why.

The tap is an edit of the note's buffer, which autosave writes as it writes
typing, so `u` or Ctrl+Z takes it back as well as the card's `Undo`. `Undo`
takes out the last tap's line while that line is still as the tap wrote it. A quick add is one change like a tap, and a copy of yesterday's meal is one change with all its lines.
The totals are the open note's lines, so yesterday's note shows yesterday.
The palette has one `Log <name>` per kind, `Log water`, `Log coffee` and
`Log alcohol` with no config note, which writes the kind's tap line into today's
note from anywhere; see [the command palette](/reference/editor-keys/leader.md#the-command-palette).

The card's `+ Food` button opens the food search: a bottom sheet on a phone, and
a panel on the right with a scrim on a desktop. Its sections come in this order:
`Mine`, your own [foods](#the-foods-note); `Recent`, the foods the last 30 days
logged; and `Open Food Facts`. The first two need no search. Type two characters
or more and the search runs once the typing pauses, on Open Food Facts. A barcode
of eight to fourteen digits reads that one food. `Scan`, beside the field,
opens the rear camera (the front one where there is none) and reads EAN-13,
EAN-8, UPC-A and UPC-E codes; a UPC-E code is looked up as its twelve-digit
UPC-A. `Stop` ends the scan. The camera also stops on a read, when the sheet
closes, and when the tab or app goes to the background. A read opens the product
as a typed barcode does.

A pick opens the serving step. It has the chips `100 g`, `150 g`, `1 serving`
and `250 g`, the amount in grams or servings, and a meal. The meal starts from
the hour: breakfast from 5 to 10, lunch from 11 to 14, dinner from 17 to 21, and
a snack at other hours. A live preview shows the kcal for the amount, the kcal
left after it, and protein, carbs and fat, each with a meter against today's
goal. The exact line it writes sits under the preview, in mono. `Log this food`
writes that line at the end of `## Log`. On a phone the preview and the button
stay pinned at the foot of the sheet.

`Escape`, also from inside the search field, a tap on the scrim, a drag of the
sheet down and `Log this food` close the sheet. Only `Log this food` writes, and
a close stops the camera and gives the focus back to the note. The card's totals
show the food's kcal, protein, carbs and fat once a food line is there.

Quick add takes a number of kcal. Type it in the quick add field and tap `Add`.
The line `- 🍽 <meal>: 🔥 250 kcal` goes to the end of `## Log`, under the meal of
the hour, and a picker beside it changes the meal. The line has no words, which a
food line may have. Zero, a negative number, text and a number of ten digits or
more write nothing, and the card says why.
The palette's `Log food` opens the same search on a daily note, and from any
other pane opens today's note first, making it when there is none.

## The config note

The card's kinds and goals come from `99 Misc/01 Config/log.md`, in the config
folder ([`KASTEN_CONFIG_PATH`](/reference/configuration.md#the-vaults-folders)).
The frontend reads it the first time a daily note's card is drawn in a pane,
as it reads `decks.md`. The backend reads it once per request, for the kinds of
your own: `GET /api/log` counts each one in `totals.mine`. With no note, that
field is left out of the answer.

```markdown
- 💧 water: 250 ml, min 2000
- ☕ coffee: 1
- 🍺 alcohol: 1, max 2
- 🍵 tea: 1 cup, min 3
- 🍽 food: kcal max 2200, protein min 120, carbs max 250, fat max 70
```

Only lines that start with `- ` at column 0 are read. The frontmatter and every
other line are ignored. Each `- ` line is a kind or broken.

A kind line is `- <emoji> <name>: <tap>[ <unit>][, min <n> | , max <n>]`, or the
last kind's form below. The mark is one symbol, a character whose Unicode
category is `So` (an emoji is one), and U+FE0F may follow it. A letter or a digit
is no mark, so `- x tea: 1 cup` and `- 7 tea: 1 cup` are broken. The tap is the
amount one tap writes: a number, written as the log format writes numbers, above
zero. `min N` is a floor, met at or above N. `max N` is a ceiling, passed only
above N. N is above zero.

- 💧 is water. Its unit is `ml` or `l`. The goal is in that unit, and the card
  compares it with the day's total in ml.
- ☕ coffee and 🍺 alcohol take no unit and a whole-number tap. Their goal is
  compared with the count. A different unit on either is broken.
- Any other emoji is a kind of your own. Its tap writes `- <emoji> <tap>[ <unit>]`.
  So `- 🍵 tea: 1 cup, min 3` puts `+ 🍵 1 cup` on the card, and a tap writes
  `- 🍵 1 cup` at the end of `## Log`.
- A log line of that kind is `- <emoji> <number>[ <unit>]`, the whole line. The
  unit is required, in any case, when the kind has one. The day's total is the
  sum, rounded to a tenth once.
- In the card's amount field, a bare number takes the kind's unit, so `2` on
  tea writes `- 🍵 2 cup`. Text that is no amount writes nothing, and the card
  says why.
- A last kind is `- <emoji> <name>: [<unit>, ]last[, min <n> | , max <n>]`, so
  `- ⚖ weight: kg, last` or `- ⚖ weight: last`, with no unit when none is
  given. `last` is read in any case, and the word is never a unit. It takes no
  tap, so a tap writes nothing and the card asks for the amount, as `Type the
  weight in kg`. A goal is allowed after it. Its log lines read as any kind of
  your own, so `- ⚖ 82.4 kg` is one.
- A last kind's day total is not a sum. It is the amount of the day's last line
  that parses for the kind, as written with no rounding, so `82.45` stays
  `82.45`. A day with a `## Log` and no such line has no total, and the answer
  gives `null`. Lines that do not parse are passed over, so a broken line after
  a good one keeps the good one.

A food line is `- 🍽 food: kcal max 2200, protein min 120, carbs max 250, fat max 70`.
Its fields are kcal, protein, carbs and fat, each `min` or `max`, each at most
once. It adds no button. It sets the food goals, and a food goal shows on the
card before the first food.

These lines are broken, and the card skips them:

- a line that does not match the forms above
- 🍽 on a kind line
- 🔥 🥩 🍞 🧈 as a kind's emoji
- an emoji that an earlier line already took, since the first keeps it
- a zero tap or goal
- a kind with neither a tap nor `last`
- `last` with a tap (`- ⚖ weight: 80 kg, last`), on 💧, ☕ or 🍺, after a goal
  (`- ⚖ weight: kg, max 85, last`), or twice
- an unknown or repeated food field
- a second food line

The card names each broken line as `Skipped line N of log.md: <text>`. The
other lines still work.

With no note, or a note that cannot be read, the card shows the three kinds of
[the card](#the-card) as before (water 250 ml, coffee 1, alcohol 1) and no
goals. A note that is there lists exactly its kinds. One without a `☕` line
shows no coffee button. The `+ Food` button always shows.

A kind's total shows its goal beside it, as `💧 1500 / 2000 ml`. A met floor
adds ` ✓`, a passed ceiling adds ` ⚠` in the warning colour, and a floor shows
a bar of its progress.

A tap in the moment before the note answers writes the default kinds' line.
The card, the palette's `Log <name>` entries and the log pane follow an edit to
`log.md` without a reload, and go back to the three default kinds when it is
deleted. An edit made while the page's event stream was down reaches them when
the stream opens again. A read of `log.md` that a later write overtook is not
drawn, even when the later read fails: the card and the palette then keep what
they had, the default kinds where nothing had arrived yet, until the next write,
draw of the card or stream open.

## The foods note

Foods of your own, the ones Open Food Facts lacks, are lines in
`99 Misc/01 Config/foods.md`, in the config folder. The food search reads the
note each time it opens. [Add a food of your own](/how-to/add-a-food-of-your-own.md)
shows how to add one.

```markdown
- ja! Choco Chips: 30 g, 🏷 4337185123456, 🔥 486 🥩 6.4 🍞 61 🧈 23
- Skyr: 🔥 62 🥩 11
```

Only lines that start with `- ` at column 0 are read, past the frontmatter. A
line is, in order:

1. the name, then `:` and a space. A name may hold a colon: the line splits at
   the first colon after which the rest reads;
2. optionally the serving, a number and `g`, then `,`. Without it the serving
   is 100 g;
3. optionally `🏷`, a barcode of 8 to 14 digits, then `,`;
4. the fields, as a [food line](#the-food-line) writes them: `🔥` kcal, `🥩`
   protein, `🍞` carbs and `🧈` fat, each at most once, in any order, at least
   one. The figures are per 100 g, as a pack's nutrition table prints them.

A `- ` line that breaks a rule is named in the search as
`Skipped line N of foods.md: <text>`, and the other lines still list.

The search lists your own foods first, in the `Mine` section, where the name holds the
typed words or the typed text is the barcode. A recent food with the same name
as one of yours is listed once, as yours. A scanned barcode is looked up in the
note before Open Food Facts is asked. A pick opens the serving step at the
food's serving, with the figures scaled from 100 g.

`Add food` in the search opens a form for the name, the serving, the four
figures per 100 g, and the barcode. It takes the typed query as the name, and a
barcode Open Food Facts did not know as the barcode. `Save` adds one line at the
end of the note, making the note where there is none, then opens the food at the
serving step. It writes the name without field markers, `🏷` and line breaks,
the serving and figures to a tenth. Two foods with the same name both list.
Nothing edits or removes a line but you, in the note.

`frontend/src/lib/log/my-foods.ts` reads and writes the note, and `food-add.ts` holds the add form. The backend does not
read it.

## Two parsers

The backend reads the lines and parses them, in `backend/src/kasten_backend/log.py`,
and `GET /api/log` answers with totals from it. The card reads the drink and
food lines of the open buffer with `frontend/src/lib/log/log-lines.ts`, so a tap
counts at once rather than after the save. Both read every row of the table
below, food included, and the card shows the food totals too. Nothing is stored
in Postgres: every answer is read from the notes.

The config note has two readers: `frontend/src/lib/log/log-kinds.ts` for the card,
and `backend/src/kasten_backend/log_config.py` for `GET /api/log`. Both run the
same table, `frontend/src/lib/log/log-config-cases.json`, so they cannot part ways
unnoticed. `log-cases.json` is unchanged.

`foodLine` in that module writes the line the card's food search logs. It
rounds kcal to a whole number and the grams to one decimal. It cleans the words
of field markers, backticks, `[[ ]]`, line breaks and a meal word's colon, so
the line parses back to the same words and fields.

## The cases

`frontend/src/lib/log/log-cases.json` holds one row per case: a line and the entry
it parses to, or `null` for a plain bullet. The parser runs the whole table in
its tests. A change to the format is a change to that table first, and a later
reader or writer of the format runs the same rows.
