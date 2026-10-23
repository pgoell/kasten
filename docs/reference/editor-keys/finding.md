---
type: Reference
title: Editor keys, finding notes
description: The note prompt, the note finder, the note search and the periodic notes, with the keys that open and answer each.
tags: [editor, keyboard, finder, search, periodic, frontend]
status: stable
---

# Finding and dating notes

## Periodic notes

Five keys open the note covering today, one per stretch of time. They finish the
`g` group: `d` for the day, `w` for the week, `q` for the quarter and `y` for the
year, and `m` for the month because `go` is spent on the panel above.

The paths below are on the default layout. `KASTEN_PERIODIC_PATH` moves
`01 Periodic`, and with it all five; see
[the vault's folders](/reference/configuration.md#the-vaults-folders). The same
holds for every inbox, image and config path on this page.

| Key | Note | Path |
| --- | --- | --- |
| `<leader>gd` | Today | `01 Periodic/00 Daily/2026-08-06.md` |
| `<leader>gw` | This week | `01 Periodic/01 Weekly/2026-W32.md` |
| `<leader>gm` | This month | `01 Periodic/02 Monthly/2026-08.md` |
| `<leader>gq` | This quarter | `01 Periodic/03 Quarterly/2026-Q3.md` |
| `<leader>gy` | This year | `01 Periodic/04 Yearly/2026.md` |

The key opens the note if the vault holds it and makes it if it does not, so
there is one key rather than a key to make and another to open. The date is read
at the press: a tab left open overnight opens the new day's note.

A note the key makes starts with a heading and one line of links, under the
frontmatter every note carries. The daily note carries its weekday too, because
a date alone does not say which day it was.

```markdown
# 2026-08-06 Thursday

[[01 Periodic/00 Daily/2026-08-05]] | [[01 Periodic/01 Weekly/2026-W32]] | [[01 Periodic/00 Daily/2026-08-07]]
```

Three links: back one, up to the note holding this one, and on one. The year has
no note above it, so a yearly note carries two.

The links are written whether or not the notes on either side exist yet, which
is what makes the chain walkable in both directions. Tomorrow's note is a note
nobody has written, so the editor draws it dotted and `gf` on it makes it. That
is also why nothing goes back to rewrite the note behind: a note made this way
already points forwards.

The week is the ISO one, counted from its Thursday, so 2027-01-01 opens
`2026-W53` rather than a week of 2027. The month above a week is that Thursday's
month for the same reason: `2026-W53` links up to `2026-12`, not to `2027-01`.

A capture into [today's dump](/reference/editor-keys/capture.md#capturing-into-todays-dump) makes the daily note
the same way when the vault has none, on the server rather than in the browser.

### The weather card

A daily note draws the day's weather under its line of links, one strip per
town in [`KASTEN_WEATHER_PLACES`](/reference/configuration.md#kasten_weather_places).
Each strip carries:

- the town, the day's low and high, the rain in mm and the highest chance of
  rain, and sunrise, sunset and hours of daylight
- a sky icon every three hours
- the temperature as a line, its low and high labelled
- the chance of rain as bars below it, darker the more rain falls
- night shaded from sunset to sunrise, and a `now` line on today's note

Hover a strip to read one hour. The card is drawn, not written: the note's
text holds nothing for it, so an agent reading the note does not see it. It
shows in the rendered view only, and not on a day the forecast does not reach,
which is more than 92 days back or 15 ahead. See
[`GET /api/weather`](/reference/http-api/capture.md#get-apiweather).

## The note prompt

`<leader>cf`, `<leader>rf` and the tree's `c` and `r` open the same prompt over
the editor: one to make a note, one to move a note that is there, one to move a
folder. Type where it goes, relative to the vault root, and `.md` is added
unless you typed it. A folder takes no `.md`, because a folder has a name and
not a suffix. Under the input sits the list of the vault's folders, ranked
against what you have typed, best first, and never more than twenty rows. A
folder move leaves the folder itself and everything inside it out of that list,
since neither is a place it can go.

The header says which of the three you are in, `new note`, `rename note` or
`rename folder`.

| Key | Does |
| --- | --- |
| Down / Up | Move the highlight through the folders |
| Ctrl+N / Ctrl+P | The same two, the way vim's completion moves |
| Tab | Take the highlighted folder, leaving the caret after its slash |
| Enter | Make it or move it, per the line under the list |
| Escape | Close the prompt and give the focus back |

Clicking a folder does what Tab does. Either way the folder replaces the whole
input rather than joining what is there, because the whole input was the query
it was ranked against.

That same rule is what empties the list once you have typed the note's own
name: `reading` matches `reading/`, and `reading/borges` matches no folder at
all. Tab is for before you name the note, not after.

The line under the list says what Enter will do, and Enter does what it says.
It reads `creates folder reading/` for a folder the vault does not have yet, or
`moves 12 notes` for a folder about to take its subtree somewhere else, or why
the path is refused, so `name the note` for one ending in a slash. It says
nothing where the input already spells out the whole story. An input naming
nothing leaves Enter with nothing to do. A write the vault refused leaves the
typed path where it is and says `could not create the note`, `could not rename
the note` or `could not rename the folder`, so the next Enter tries again.

A path that is already taken is the one line the modes read differently.
Making a note there is opening it, so the line says `already exists, Enter
opens it`. Moving a note there would write over it, which the vault refuses, so
the line says `a note is already there` and Enter does nothing, and a folder
onto a folder says `a folder is already there` for the same reason. The
exception is the path a rename starts on, its own: Enter closes the prompt
rather than refusing, because leaving a name alone is not a collision.

Escape hands the focus back where it came from, the editor or the tree.
Opening a note is the exception: the focus goes to the editor, in normal mode,
so you can type into a new note at once. A rename that leaves the editor where
it is hands the focus back the same as Escape, so renaming from the tree keeps
you in the tree.

## The note finder

`<leader>ff` and the tree's `f` open the finder over the editor. It is the other
way round from the prompt: there the input is the answer and the list completes
it, here the list is the answer and the input only filters it. Nothing typed
into the finder has to name a path, and the finder never writes.

| Key | Does |
| --- | --- |
| any character | Narrow the list to the notes the query reads into |
| Down / Ctrl+j / Ctrl+n / Tab | Move the highlight down one row |
| Up / Ctrl+k / Ctrl+p / Shift+Tab | Move the highlight up one row |
| Enter | Open the highlighted note |
| Escape | Close, and hand the focus back |

A click or a tap on a row opens it, as Enter on it would. In a window narrower
than 768px the list takes the whole panel, and the preview is neither read nor
drawn; the same holds for [the note search](#the-note-search).

Tab walks the list rather than completing anything, the way it does in a
terminal fuzzy finder. There is nothing here to complete: Enter opens the row
under the highlight whatever the input says. It is answered even with an empty
list, which is the one place the key would otherwise take the focus out of the
panel and not bring it back.

Ctrl+j and Ctrl+k are vim's `j` and `k`. A bare `j` or `k` is a letter of a
name, so it types into the filter.

The list ranks every note in the vault, then shows the best twenty. The query
reads as a subsequence, so `kap` finds `projects/kasten/api-design.md`. A run of
letters scores above the same letters scattered, a letter opening a folder name
scores above one buried in it, and a letter landing in the note's own name
scores above one that only matched the folder, so `arch` finds
`kasten/architecture.md` before `archive/march.md`. Typing a folder still
narrows, which is what `kasten/arch` is for.

Beside the list sits the note under the highlight, rendered the way the editor
renders it: headings sized, lists drawn, marks hidden. The pane shows the note
as opening it will, which is what makes two notes easy to tell apart. Nothing
in it can be typed into, and the keys stay with the input. The text arrives a
moment after the highlight stops moving, which is
what keeps a held Ctrl+n from reading every row it passes. A note that cannot be
read says `could not read this note`, and Enter still opens it.

The line underneath says `no notes match` for a query that reads into nothing,
and `the vault has no notes` for a vault with nothing in it yet. Enter does
nothing in either case.

### The book finder

`<leader>fb` opens the same panel over the books alone: the notes with an
`.epub` beside them, a note with a `.pdf` being a document and not a book. Each
row shows the book's name and its folder, and the archive stays out unless
`<leader>a` is on. The keys are the note finder's: the arrows, Ctrl+j and
Ctrl+k, Ctrl+n and Ctrl+p, and Tab walk the list, and a bare `j` or `k` types
into the filter. Enter, or a tap on a row,
opens the book in the focused pane in place of what it held, at the note's
`reading:` place, and leaves the note shut. A book already open in a pane of
the tab gets the focus instead of a second reader. With vim off, and on a
phone, the palette row `Find a book` opens the finder.

## The note search

`<leader>fg` and the tree's `s` open search over what is written in the notes,
rather than over their names. Telescope spells the pair this way, `find_files`
and `live_grep`, which is where `ff` and `fg` come from. Nothing typed here has
to name a path, and search never writes.

| Key | Does |
| --- | --- |
| any character | Narrow to the lines holding the query |
| Down / Ctrl+n / Tab | Move the highlight down one row |
| Up / Ctrl+p / Shift+Tab | Move the highlight up one row |
| Enter | Open the note on the line the match is on |
| Escape | Close, and hand the focus back |
| Click a bar | Narrow the results to that week, or clear it |
| Click a folder or a tag | Narrow to it, or clear it |
| Click Include the archive | Turn the archive in or out, as `<leader>a` does |

The page is one panel, wide and tall on a desktop and the whole screen on a
phone. A large serif field holds the query. Beside the lines, a column 220
pixels wide lists the folders and the tags the answer holds, each with its
count, and the archive with its own count. One folder and one tag can be
chosen at a time, and a second press on the chosen one clears it. The counts
are of the whole answer, so a choice narrows the lines and leaves the numbers
beside the other choices alone. On a phone the column folds into a `Filters`
button above the histogram.

Above the results is a histogram: one bar for each of the last fourteen ISO
weeks, the current week last, scaled to the busiest of them. Each bar carries
its week, such as `W38`, and the current week is marked. Hovering a bar shows
its count. Clicking a bar narrows the results to the lines written that week,
and the line above the results says how many lines and notes that is. `All
weeks` clears the choice, and a second click on the chosen bar does too. A line
with no date counts in no week, and a line older than fourteen weeks is listed
under `All weeks` only.

The chosen week sits in the URL as `?week=2026-W38`, so a reload keeps it and a
link can name one. Closing the page clears it, and a week that is not a real
ISO week opens nothing.

The list shows the best sixty lines the choices leave, grouped by note under
the note's title and path, in the order of each note's best line. Each line
shows its number and its text, with every place the query occurs in the accent.
Enter opens the note with the cursor on the highlighted line, centred rather
than scrolled just barely into view.

The vault answers with at most 2,000 lines. When a query reaches that, the
status line says the counts are of the first 2,000 lines.

The work is split in two, and the split is the whole design. The backend finds
the lines holding the query literally, which is the part a browser cannot do
without every note loaded into it. The browser ranks what came back, which is
the part that has to answer per keystroke. It has to be this way round: a
subsequence match is what makes the finder feel fuzzy over note names, and it
means nothing over prose, where an eight letter query still reads into 15% of
the lines in a vault. So a subsequence never chooses the lines here, only their
order.

That split is also why typing keeps narrowing. Reading the vault waits for the
typing to settle, but the lines already in hand are ranked against every
keystroke, so the list tightens while the next scan is still out rather than
freezing until it lands.

The line underneath says `type to search every note` before anything is typed,
`reading the vault` while a scan is out, and `no notes match` when the vault
holds nothing that matches. See [GET /api/search](/reference/http-api.md) for
what the backend does and does not look at.
