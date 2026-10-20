---
type: Reference
title: Editor keys, completion lists
description: The lists the editor offers while you type a link, a tag or a todo field, and the keys that take one.
tags: [editor, keyboard, completion, frontend]
status: stable
---

# Completion lists

## Completing a link

Type `[[` and the vault's notes and pages are offered, filtered as you go. A
note's row is its path without the `.md`, a page's keeps its `.html`, so `[[kast` reaches `projects/kasten` and typing a
folder narrows the same way it does in the finder.

| Key | Does |
| --- | --- |
| Down / Up | Move through the notes on offer |
| Tab / Enter | Take the highlighted one |
| Escape | Close the list and keep typing |

Taking one closes the link with `]]`, because typing `[[` does not: markdown's
close-brackets answers a `[` with nothing. A link you closed yourself gets no
second pair.

The whole vault goes into the list every time and CodeMirror scores the names
against what has been typed, which is the same fuzzy match [the note
finder](/reference/editor-keys/finding.md#the-note-finder) does by hand and one this does not have to repeat.

`[[wikilinks]]` are not part of any markdown flavour kasten loads, so
`frontend/src/lib/wikilink.ts` adds them to the parser, the way
`markdown-highlight.ts` adds `==highlight==`. What sits between the brackets is
a note's name rather than prose, so nothing in it is parsed as markdown, and a
link that runs past the end of its line is not a link.

## Completing a tag

Type `#` and the tags the vault already holds are offered, filtered as you go.
It is the same list [the note finder](/reference/editor-keys/finding.md#the-note-finder) would find by searching
for one, read off every note at once, so a tag is spelled the way you spelled it
last time rather than three ways across three notes.

| Key | Does |
| --- | --- |
| Down / Up | Move through the tags on offer |
| Tab / Enter | Take the highlighted one |
| Escape | Close the list and keep typing |

A `#` at the start of a line waits for a letter. That is where a heading is
opened, and `#` alone says nothing about which of the two you meant; `#f` says
it, and Ctrl+Space asks for the list outright on a line that has neither.
Everywhere else the list opens on the hash itself.

The vocabulary comes from `GET /api/tags`, one `rg` pass over the vault, and it
is read again whenever a note is written, so a tag invented an hour ago is on
offer. The archive is in it: what is filed away is out of a search because it is
not what you are looking for, and a tag is a word you are trying to spell the
same way twice.

What counts as a tag is the rule the editor draws one by, so `#!/bin/sh`,
`#anchor` in a URL and `note#2` are offered by nothing and coloured as nothing.
See [A tag has no mark to hide](/explanation/live-preview/embeds-and-the-rest.md#a-tag-has-no-mark-to-hide).

## Completing a todo field

Every field a todo carries is a glyph, and no glyph is on a keyboard. Type a
colon on a todo line and the fields that line has not got are offered by name:
`:due` writes the `📅`, `:high` writes the `⏫`, `:weekly` writes
`🔁 every week`. A field the line already carries is left off the list, so what
is on offer is what is left to write.

| Key | Does |
| --- | --- |
| Down / Up | Move through the fields on offer |
| Tab / Enter | Take the highlighted one |
| Escape | Close the list and keep typing |

The fields that take a value are written in two steps. Taking `due` leaves
`📅 ` and the cursor after it, and the days are offered there: `today`,
`tomorrow` and the seven weekdays, each drawn beside the date it means, a
weekday naming the next one. Typing `fri` and taking `friday` writes the date
itself, so what lands on the line is a date the format reads rather than a word
it cannot. `estimate` works the same way and offers `15m` up to `4h`; any other
duration is typed out.

`repeat` is the third of them. Taking it leaves `🔁 ` and offers the rules:
`every day`, `every week`, `every month`, `every year` and `every weekday`,
then the ones that name the day the line is due, such as
`every week on Friday`, `every 2 weeks on Friday`, `every month on the 14th`,
`every month on the 2nd Friday` and, where it is one, `every month on the last
Friday`. A line with no `📅` is read by its `⏳`, then its `🛫`, then today.
Typing narrows them, over the spaces a rule is written with. Any other rule
[the format reads](/reference/todo-format/time-and-repeats.md#recurrence) is typed out.
`daily`, `weekly` and `monthly` are still one press each.

Ctrl+Space opens the list without the colon, anywhere on a todo line. Without
one or the other nothing pops up while a todo is being written, which is what
the colon is for.

Four fields are deliberately absent. `➕`, `✅` and `❌` are kasten's own stamps,
and a done date written by hand is one
[the done log](/reference/todo-format/time-and-repeats.md#the-done-log) knows nothing about.
`🆔` has a key of its own, `<leader>i`. And a `⛔` names another todo's id,
which the line being typed cannot see: [`b` in the todo pane](/reference/editor-keys/todo-pane.md#the-todo-pane)
writes it.
