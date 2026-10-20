---
type: Reference
title: Log format
description: How a daily note logs water, coffee, alcohol and food as lines under ## Log, every kind and its fields, what does not parse, how a day adds up, and the table of cases the parser is tested against.
resource: frontend/src/lib/log-cases.json
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
   either, and a fence it seems to open opens nothing in the note.
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
logged. A day without one is absent, not zero. Totals are rounded to one
decimal once, after the sum, half to even as Python's `round` does: 0.25 g is
0.2 g. An alcohol entry's own `grams` is rounded the same way.

## One parser

The backend reads the lines and parses them, in `backend/src/kasten_backend/log.py`.
Todos go the other way, the backend handing raw lines to the editor's parser,
but `GET /api/log` answers with totals, so the parser lives where the sum is
made, and nothing else reads the format. Nothing is stored in Postgres: every
answer is read from the notes.

## The cases

`frontend/src/lib/log-cases.json` holds one row per case: a line and the entry
it parses to, or `null` for a plain bullet. The parser runs the whole table in
its tests. A change to the format is a change to that table first, and a later
reader or writer of the format runs the same rows.
