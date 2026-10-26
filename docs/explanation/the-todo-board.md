---
type: Explanation
title: The todo board
description: Why the board is a view over todo lines that stay where they were typed, why a todo's project is read off its note's folder or a link on its line, and how a dragged card moves.
tags: [design, todos, board, projects]
status: draft
---

# The todo board

The todo pane answers one question: what is there to do, by when. The board
answers another: where does each piece of work stand, per project and across
projects. This page sets out the problem, the options weighed for it, what a
critique of them found, and the design chosen.

## The problem

Todos are typed where the user is: in today's daily note, in a meeting note
inside a project folder, in a person's note. The work they name belongs to a
project that lives somewhere else. The user wants:

1. an overview per project and across projects, a board with swim lanes;
2. client work, internal work and private work apart;
3. dependencies and parts still visible;
4. notes and docs per todo;
5. todos kept as single lines, and the vault still read by Obsidian Tasks.

The question underneath: what makes a todo belong to a project when it does
not live in the project's note, and should a todo move there, be mirrored
there, or stay where it was typed?

Four limits hold for every option:

* The line is the only source. No board file, no table, no second copy.
* Obsidian Tasks still reads every todo.
* No todo is moved or rewritten in bulk.
* A todo typed in a daily note keeps working there.

## What the live vault shows

On 2026-10-16 the live vault held 193 todo lines in daily notes and about 360
in the folders under `02 Projects`, `03 Areas` and `04 Ressources`, most of
those in meeting notes inside a project folder. Of the 27 open todos in daily
notes, 23 carried one of `#client`, `#internal` or `#private`, and 3 carried a
`[[link]]`. Projects are folders, `02 Projects/FDE/` with an `index.md`, not
notes of a type.

So the folder already answers the project for most todos, the kind tag already
answers client against internal for most of the rest, and the link is rare
today.

## Options for belonging

### A: read it off what is already there

A todo's project is, in order:

1. the project folder of the note it lives in, which is the first two folders
   of its path (`02 Projects/FDE`), for any note outside the periodic notes
   and the inbox;
2. else the project folder of the first `[[link]]` on its line that lands in
   one, so `- [ ] send the deck [[FDE]]` in a daily note belongs to FDE;
3. else the project of the todo it is a part of;
4. else no project.

Nothing is moved or mirrored. The user writes a link, which Obsidian already
reads as a link and Tasks ignores.

### B: a project tag

A todo carries `#p/fde` or `#project/fde`. The board groups on it, and Tasks
filters on it with `tags include`. Nothing is moved. Every todo in a project
note needs the tag too, or the board loses it, so the tag repeats what the
folder says.

### C: refile

A todo typed in a daily note is moved into its project's note, by hand or by
one key, the way org-mode refiles and Things moves an inbox item into a
project. The project note then holds every line, and the board groups on the
note. The daily note keeps a link back, or nothing.

## Options for the board

### 1: a mode of the todo pane

One key in the todo pane turns the list into columns, one per state, and lanes,
by project or by kind. It reads the answer the pane already holds, so the
parse, the tree, the parts count and the blockers come for free, and a move
writes through `cycleTodoInVault`, the call the pane's `O` `P` `X` `B` `W` `R`
make.

### 2: a pane of its own

A board is a fourth kind of pane beside a note, a terminal and the list, with
its own leader key and its own entry in the layout. More reach, and a second
copy of the reading the todo pane does.

### 3: a markdown board note

The Obsidian Kanban plugin's shape: a note whose headings are columns and whose
list items are cards. It breaks the first limit, the card being a second copy
of the line, so it was out before the critique.

## The critique

Four frames, each run by a fresh agent that saw only the problem, the options
and the limits.

| Frame | Verdict, as the frame wrote it |
| --- | --- |
| Pre-mortem | proceed with changes. Option A works for the ~360 todos inside project folders, but by the brief's own numbers it puts almost every daily-note todo under "no project", and those are the todos the user is asking about. |
| Steelman for | proceed with changes. A + 1 meets every hard limit and fits the 100-minute budget, but the data shows option A leaves most daily-note todos with no project, so the best version needs a way to triage them. |
| Steelman against | proceed with changes. Board option 1 holds up, but rule A alone gives a project to the todos that already had one and leaves most daily-note todos, the ones the user asked about, with "no project". |
| Outside view | proceed with changes. A + 1 matches how lasting tools do it: the board is a view over items with one project field. But rule A as written gives nearly every open daily-note todo "no project", which is the exact case the user asked about. |

A fifth agent read the four and decided: proceed with changes. Its findings,
in its order of weight:

1. Rule A leaves most open todos in daily notes with no project. Make "no
   project" a lane of its own and give it one key that adds a link (all four).
2. Only kasten knows a todo's project, so Obsidian Tasks and agents cannot
   see it (steelman against, pre-mortem).
3. "The first two folders" makes areas and resources projects (all four).
4. The user's words point at refiling, which done one todo at a time is not
   bulk (pre-mortem, both steelmen).
5. Lanes by kind work today and should come first (three frames).
6. The time box will run over; leave drag out (outside view).
7. A mode of the pane beats a pane of its own: one write path (steelman for).

Of the outside view's survey: Obsidian Tasks and Dataview group by path,
folder or tag and draw no board; the Kanban plugin keeps the card in the
board note, which is option 3; Logseq reads a page reference or the block a
task sits under; Things gives each task one project or area and an inbox to
sort from; Linear gives each issue one project and draws status columns with
project lanes. A + 1 is the Logseq, Things and Linear shape: a rule plus an
inbox, drawn as Linear draws it.

Option B lost because every todo in a project note would need the tag the
folder already gives. Option C, as the core, lost because the limits forbid
moving todos in bulk and a daily todo has to keep working where it is; one
refile at a time stays open, see below.

## The design

A + 1, changed where the critique pointed.

Every frame found the same hole: rule A gives a project to the todos that
already sit in one, and leaves the todos typed in a daily note in "no
project", which is the case the user asked about. The pre-mortem asked for
the split on live data before building. On 2026-10-16 the live vault held 132
open todos outside the archive: 100 in a folder under `02 Projects` or
`03 Areas`, 31 in periodic notes and 1 elsewhere. With 3 of the periodic ones
linked, about 29 of 132, or 22%, land in no project. That is under the 30% the
pre-mortem named as the line, so A stands, with three changes the frames
agreed on.

### What makes a todo belong

In this order:

1. The note it lives in sits in a project folder. A project folder is a
   folder directly under `02 Projects` or `03 Areas`: `02 Projects/FDE` and
   `03 Areas/06 Allianz Direct` are projects, `04 Ressources/03 Workshops` is
   not. The critique found that "the first two folders" made every resource
   folder a project; an area stays one because client work lives there.
2. Else the first `[[link]]` on the line that lands in a folder under
   `02 Projects`. So `- [ ] send the deck [[02 Projects/FDE/index|FDE]]` in
   a daily note belongs to FDE, and stays in the daily note. Under
   `02 Projects` only, because a daily todo names people far more often than
   projects, and the people live in `03 Areas/08 People`: `[[Louise]]` on a
   line would otherwise file the todo under people.
3. Else the project of the todo it is a part of.
4. Else no project, a lane drawn first, as the inbox is in Things: it is the
   pile still to sort.

Nothing moves and nothing is mirrored. The link is a link Obsidian already
reads and Tasks ignores, so both still read the line as before.

### One key to sort a todo

Every frame asked for a cheap way to give a todo its project from where it
was typed. `p` on a card lists the folders under `02 Projects`, and picking one adds a
link to that folder's `index.md` into the todo's words, through the write the
pane's `i` makes. One line, the user's own press, so no limit breaks. This is
option C's refile without the move: the todo stays in the daily note, and
the board files it.

### Lanes by kind first

23 of the 27 open todos in daily notes carry `#client`, `#internal` or
`#private`, so the lanes the board opens on are those three and a fourth for
the rest. `g` switches to lanes by project and back. A part with no kind tag
of its own takes its parent's, as a part already takes `#client` in the list.

### The board

A mode of the todo pane, `c`, for the reason the steelman gave: the board
reads the answer the pane holds, and a move goes through the write the state
keys make, so done runs the completion walk with no second copy of it.

* Columns: open, doing, review, waiting, blocked, done and rejected. `[w]` has
  its own column because kasten writes it. Review sits after doing because it
  is the next step in an agent's walk, the last stop before done. Done and
  rejected show the last seven days, as `d` does in the list.
* Every todo is a card, a part too, naming the todo it is part of. A card
  shows the words, the priority, the due date, the parts count and what it
  waits for.
* `h` `l` move between columns and `j` `k` between cards, Enter opens the
  line, and `O` `P` `V` `W` `B` `X` `R` move the card. The filter line and the
  views narrow the board as they narrow the list.
* On a phone the board shows one column at a time, with a tab per column.
  A tap on a card opens it; its `⋯` holds the states and `project`.
* The first board left drag and drop out, as the outside view advised: the
  keys and the strip already moved a card. It came later, below.

### The project on the backend, and the tag that overrides it

Two of the items the critique left for later came next (#395, #394).

`GET /api/todos` now answers each todo with its `project`, worked out on the
backend by the rule above. The board reads it from there and no longer holds a
copy of the rule, so an agent that reads the endpoint sees the lane the board
draws. The backend had found the lines and parsed none of them, for the reason
two parsers in two languages drift. This rule needs only a todo's indent, its
tags and its links, and the backend already reads links by a rule both sides
test against one file of cases, so the cost is small and the answer is one.

A `#p/x` tag on a todo comes before every step of that rule, the folder
included, and Obsidian Tasks can filter on it with `tags include #p/x`. So the
full order is:

1. A `#p/x` tag on the todo, else on the nearest todo it is a part of. A part
   is the same work as the todo above it, as it already is for a kind tag.
2. The note's project folder.
3. The first link on the line into a folder under `02 Projects`.
4. The project of the todo it is a part of.
5. No project.

How a tag names a folder:

* `x` names a folder directly under `02 Projects`, as a link does and as `p`
  offers. Not areas: their folder names carry a number, `06 Allianz Direct`,
  which nobody types as a tag.
* Case does not count, and a hyphen or an underscore in the tag stands for a
  space in the folder name: `#p/japan-honeymoon-2027` names
  `02 Projects/Japan Honeymoon 2027`.
* `#p/x/y` names `x`: a project is one folder deep, and the rest is the user's
  own grouping inside it.
* A tag is read as Obsidian reads one, so `#p/fde.` at the end of a sentence
  names `fde`.
* A tag that names no folder is passed over, as a link to a note that is not
  there is: a typo would otherwise make a project nobody made.
* With two tags on a line, the first that names a folder wins, as the first
  link that lands does.

### The refile key

`m` on a row or a card moves one todo into its project's note, for a user who
wants the line there (#396). On a phone the row's `⋯` holds `refile`. It is
option C done one press at a time, so no bulk move happens.

* The project is the one `GET /api/todos` answers, so the key files a todo
  where the board draws it. The note is `<project>/index.md`, the note `p`
  links to.
* The todo moves with its parts, every line indented under it, as they stand.
  It lands under `## TODOs`, the section a new todo lands in, and a plain
  bullet stays behind in its place: the todo's words and a link to the
  project's note. Not a checkbox, or Tasks would count the todo twice.
* The project's note is written first, then the note the todo left. A write
  that fails between the two leaves the todo in both notes, never in none,
  and the notice says so.
* Each note is written once, in its note's write queue, with the guards a
  link from the backlinks panel has: a note open to type in, being saved, or
  holding text a failed save left is not written, and the notice says why.
* A todo with no project moves nowhere: the notice names the two ways to give
  it one, `p` and a `#p/x` tag. A todo already in its project's note stays.
* A project's folder with no `index.md` gets one, holding the todo. The
  folder is there by construction, since the backend names only folders it
  found, and `p` already links to that note, so the note is the one the user
  was going to make. Obsidian makes a missing note the same way when a link
  to it is followed.
* The way back is the history pane's restore on each of the two notes. `u`
  in an editor does not reach it: the move went through the vault, not
  through the buffer, as every key in the pane does.

### Drag and drop

A card can be dragged, as in Obsidian's Kanban plugin (#397). Drag adds a way
to move a card; the keys and the strip stay as they are.

* A drop on another column sets the state, through the write the state keys
  make, so done still runs the completion walk.
* A drop on another lane, with lanes by project, refiles the todo into that
  project's note through the refile key's path: the project's note first, the
  note the todo left only when it is unchanged. There is no second move.
* A drop on the cell the card left, a drop outside the board, and a drag
  that Escape cancels write nothing.
* A drop that changes the lane and the column at once writes nothing and
  says so: it would be two moves, and a half done one is harder to read than
  none. A drop on "No project", or on a lane other than the one a `#p/x` tag
  on the todo names, writes nothing either, since the tag would draw the
  card back where it was. With lanes by kind only the column counts: a drop
  writes no kind tag.
* Order inside a column is not kept. The board has no stored order, the
  cards follow the vault, and a position written into the note would be a
  second source of truth beside the line.
* On a phone a long press picks the card up. A finger that moves before
  then swipes the column, and lifts nothing. The card drops on a column's tab
  or on a lane of the column shown.
* A write that fails leaves the card where it was, since the board draws the
  vault and not the drag, and the notice says so.

### Why the phone board swipes

Seven columns do not fit at 390 px, the width of a common phone. So the phone
shows one state at a time, with a tab per state that carries its count, and the
whole board stays in view as a row of numbers. A swipe to the next state is how
a finger turns a page, so the column moves with the finger. A tap on a tab does
the same for anyone who would rather point.

### Why the swipe stays on the column

The page scrolls up and down, and the system takes a touch from the screen's
edge. A swipe that began anywhere else would fight both. Keeping the swipe on
the column leaves each of the others its own gesture. A long press lifts a
card, and a finger that moves first swipes, so one touch never does both.

### Why Rejected folds

Rejected is the state a todo leaves when it is dropped, and nothing moves on
from it. Most of the time nobody needs to look at it. On a desktop it folds
away, and one click opens it when it is wanted.

### Why shared lists are hidden by default

The lists in `05 Shared`, such as the shopping and the household lists, are
notes the user keeps for everyday things. Mixed into the work list, a shopping
item due today sits beside the work due today, and the work gets lost in it.
So the lists are hidden by default. The Shared lists toggle shows them when the
user wants them. The setting is kept per device.
