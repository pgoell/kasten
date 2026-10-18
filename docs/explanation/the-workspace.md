---
type: Explanation
title: The workspace
description: Why each browser and phone reopens the panes, splits and tabs it had open, why the layout lives in the browser and not the vault, why a phone and a laptop keep apart by pointer rather than by width, what is kept and what is not, and what a reload does with a gone note, a link and a broken save.
resource: frontend/src/lib/workspace.ts
tags: [workspace, panes, phone, storage]
status: stable
---

# The workspace

Close the tab and open kasten again, and you find the window as you left it:
the same tabs, the same splits, the same note in each pane, the focus where it
was, the zoom on or off, the file tree open or shut. Each note opens at the
cursor and the scroll it had. This page says why that state lives where it
does, and what it leaves out.

## In the browser, not the vault

The layout goes in the browser's `localStorage`, one copy per browser, and
never into the vault. That was a choice, and Obsidian made the same one: it
keeps `workspace.json` for the desktop and `workspace-mobile.json` for the
phone, beside the notes but apart from them.

The vault holds notes. A phone and a laptop open the same notes in different
ways, three panes on a wide screen and one at a time under a thumb, and
neither way is a fact about the notes. Kept in the vault, every move of a pane
would be a write, a change in the history and a sync between devices that
want different things. Kept in the browser, the phone and the laptop each
keep their own and never fight.

The cost is that a new browser starts clean. Nothing follows you from the
laptop to the phone, which is the point.

## By pointer, not by width

There are two keys, one for a mouse and one for a finger. kasten picks by the
primary pointer, the CSS `(pointer: coarse)` query, not by how wide the window
is.

Width changes while you work: you drag a desktop window narrow, or turn a
phone on its side. Had kasten picked by width, a narrow desktop window would
load the phone's layout, and dragging it wide again would leave it there. The
pointer stays put for the life of the page. A laptop with a touch screen still
has a mouse as its primary pointer, so it keeps the desktop's layout.

A phone draws one pane at a time, as
[kasten on a phone](/explanation/kasten-on-a-phone.md) says, but its saved
layout keeps the splits. Turn the phone into a wide tablet and they are there.

## What is kept, and what is not

Kept: the tabs and which one is on screen, the splits in each tab, what each
pane shows (a note, a terminal, the todo pane, a book, a pdf and its page, a
graph and so on), which pane has the focus, whether the tab is zoomed, and
whether the file tree is open.

Not kept:

* The text of any note. The vault holds that. Text you typed and kasten has
  not yet written has its own key, `kasten.held.2`, and its own rules.
* The line a search or a link opened a note at. That belonged to the open that
  asked for it, and a reload is not that open again. The cursor comes back
  from the note's own position instead.
* How many times this page opened a pdf. A reload starts the count again.

Panes have no handle to drag, so a split always draws its panes in equal
shares. The shape of the tree is the size, and nothing else needs saving.

## Last write wins

Every change to the layout writes the whole of it, over whatever was there.
Two tabs open in one browser share one key, and the tab you touched last is
the one the next reload finds. kasten does not listen for the other tab's
writes: merging two layouts would draw a window neither tab had open.

## A note that is gone

A pane can name a note you have since moved or deleted, on another device or
in the shell. kasten draws the pane anyway, and it says `Could not open` and
the path. It does not drop the pane or rewrite the saved layout, so nothing
moves under you. Close the pane or open another note in it.

## A link opens on top

A URL that names a note, `?note=`, wins over the saved layout. kasten restores
the layout first and then opens that note in the focused pane, so a link from
elsewhere lands where you look. A plain reload names the focused pane's note,
which is already there, so it changes nothing.

## A broken save starts clean

kasten reads the saved layout only when it has exactly the shape kasten writes:
known pane kinds, known fields, no pane twice, a focus inside its own tab. A
layout from an older version, a write cut short or another app's key fails
that check. kasten then removes the key and starts with one empty pane. Half
of a layout would draw a window nobody had open.

A browser that blocks site data cannot keep the layout at all, and kasten
starts clean on every load there.

## The keys

All three live in `localStorage` and hold no note text:

* `kasten.workspace.1`: the layout under a mouse.
* `kasten.workspace.coarse.1`: the layout under a finger.
* `kasten.positions.1`: the cursor and the scroll of the 200 notes you left
  last, by path. A note opened at a given line goes there instead.

The number in each key is the shape's version. A new shape takes a new key,
and the old one is left unread.
