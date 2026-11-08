---
type: Explanation
title: Shared lists
description: Why the shared shopping and todo lists are plain lines in two vault notes, how an item is given to a person and who ticked it, why a second gate and a /share prefix stand in front of them rather than a second user, what the second person can reach, and how parts, an edit, a delete, a conflict, a live update, an offline change, Alle and Meine, the look and Clear behave.
tags: [share, lists, security, todo]
status: stable
---

# Shared lists

kasten has one user. The shared lists are for two: pgoell and Alicia each
keep a shopping list and a todo list on a phone, and each can add and tick.
This page says why the lists are built the way they are.

## The lists are notes

Each list is a note in `05 Shared`: `Einkauf.md` and `Todo.md`. An item is a
plain checkbox line, `- [ ] Milch`, the same line the
[todo board](/explanation/the-todo-board.md) and Obsidian Tasks read. So a
list needs no table, no database and no second copy. A tick writes the line
the way [the todo format](/reference/todo-format/state-changes.md) does, with a
done date, so the board and Obsidian still count it done.

A note keeps its history in the vault's jj repository. Every change to a list
is one more step back, and nothing the app does is final.

## Parts

An item can have parts: todos indented under it, two spaces per level, as
[the todo format](/reference/todo-format/state-changes.md#subtasks) has them.
A big job such as financing a house is one item with a dozen steps, some for
each person, so the steps need to stay under the job and not become a dozen
items of their own. The app draws each part under its item, one step further
in, with its own tick and its own chip, and shows `1/3` after the item's words,
the closed parts out of all under it, as kasten's todo pane does. A chevron
folds an item's parts away; they show by default.

A tick on an item does what kasten's completion does: it ticks every part still
open, with today's date and no id, and leaves a part that is done or rejected as
it was. Unticking the item leaves its parts done, and a part ticks and unticks
alone. Finishing the whole job finishes its steps, while the job may have work
of its own that no step names. The `+` on an item turns the Eintrag field into
one for a part of it, until `×` or Escape turns it back.

A part shows only under an item the app lists, a `- [ ]` or `- [x]` line at the
margin. Parts under a `- [/]` line, or under a plain list item, stay out of the
app, as that line does.

## Ticks kasten keeps

A recurring item, one with `🔁` on its line, would stop its series if this path
ticked it: kasten writes the next occurrence when it is ticked. The backend
answers `422` with "Tick this one in kasten" for a tick on one, or on an item
with an open recurring part, and the app tells the person to tick it in kasten.
Unticking still works here.

## Edit and delete

A tap on an item's words opens them for editing in place. Enter or leaving the
field saves, Escape keeps the old words, and empty words save nothing. The save
writes only the words: the box, the indent, every field and a block id at the
end stay as they were, so a typo fixed or "Milch" turned into "2x Milch" keeps
its assignee and its dates. The fields go after the new words, so a tag that
sat after a field moves in front of it. This is why an edit is a route of its
own and not a delete and an add, which would lose the line's fields.

While the words are open, Löschen stands where the chip was. It takes the item
off the screen at once, with its parts, and shows "gelöscht" with Rückgängig for
five seconds before the delete is sent. An undo in place of a confirm dialog
keeps a slip cheap without asking every time. A delete still waiting is sent
when the next one comes or the app closes its screen, not dropped. A part goes
alone. As with Clear, the history keeps the lines.

## Words and the assignee

The app shows an item's words only. The fields kasten adds, such as the
recurrence `🔁`, the waiting `👤` and the dates, and a block id at the end of
the line are left out of the words. An item's assignee, the `👤 [[name]]` on
its line, comes through the share routes as the `assignee` field of each item.

The app draws it as a chip at the right of the row. The chip reads `Wer?` when
nobody is set, `Ich` when the item is for you, and the name otherwise. A tap
opens a small menu of the people, then Niemand. A pick writes `👤 [[Name]]` on
the line, and Niemand takes the `👤` off. The chip shows the pick at once, and a
refused pick shows the server's words. The line names the person by a link to
their note, not by a bare name, so [the person card](/explanation/people-in-the-vault.md)
lists the item the same way it lists any todo that links them.

## Who ticked

A done line names nobody. The line stays the todo line that the board and
Obsidian read, with no extra field for a person. The history records each save
instead. A write through the share routes names its person there: the gate sends
the signed-in address as `X-Auth-Request-Email`,
[`KASTEN_SHARE_PEOPLE`](/reference/configuration.md) maps it to a name, and the
save is recorded under `share:<name>`. When the server lists a done item, it reads
`jj evolog` for the latest change that ticked that line, and takes the writer and
the commit time from it. The app shows what it is given, so a tick by Alicia reads
`abgehakt von Alicia, Mo 18:04`.

Two cases show less. A tick made in kasten has a time but no name, so the line
reads `abgehakt Mo 18:04`. A write with no mapped address is recorded as
`share`, and shows the same way, with no name. The history read never writes to
the repository. If it fails, or the repository is missing, the item keeps its
tick and the line under it stays blank.

## Alle and Meine

Alle shows every item in the list. Meine shows the open items for you and the
ones for nobody. An item for Alicia stays out of your view, and an item nobody
has taken stays in it, so nothing open drops out of sight. This is the issue's
default. The filter applies to Erledigt too. An item shows when it or one of its
parts passes, and then with all its parts, so a step for you keeps its job in
view. The counts in the list switch count every open item in the list, parts
left out, whatever filter is chosen.

## How it looks

The lists page draws with the tokens of the main app, so its colours, type and
spacing match the rest of kasten. It is light by default and follows the phone's
colour scheme, changing when the phone does. It does not read the choice made in
the main app, which is stored under the main host's address and is not this
page's to read. The page keeps the default accent and does not pick a palette.

![The Einkauf list on a phone, with Alle selected](/assets/shared-lists/lists-phone-alle-light.png)

The menu opened from a chip that says Wer?:

![The chip menu of the Einkauf list on a phone](/assets/shared-lists/lists-phone-menu-light.png)

Erledigt with its ticks and their lines, in the dark scheme:

![The done items of the Einkauf list on a phone, in the dark scheme](/assets/shared-lists/lists-phone-done-dark.png)

The same list on a desktop:

![The Einkauf list on a desktop](/assets/shared-lists/lists-desktop-light.png)

## Why a second gate, not a second user

kasten has no users. The gate in front of it admits pgoell, and every `/api/`
route trusts whoever passes that gate. A second user would need a login in
kasten, a session store and a check on every route. That is the password store
the [security model](/explanation/security-model.md) declines to build.

So the second person comes in through a second gate. `liste.pgoell.com` has its
own oauth2-proxy with Google sign-in. It admits two addresses, read from a file
on the server, and nothing else. Its cookie lives on that host only, so a
session on the main host does not pass here.

The gate lets through only what the app needs. Caddy sends `/share/*` and the
app's own files to kasten, and answers every other path with `404`. The
`/share/` prefix is the only part of the backend that the second person's
requests reach.

## Two locks

The gate is one lock. The backend's host check is the second. When a request
arrives with the share host as its `Host`, the backend answers `404` to every
path outside `/share/`. That includes `/api/`, `/agent/`, `/.well-known/`,
`/docs` and `/openapi.json`, and it happens before any route runs.

Each lock covers a fault in the other. A route that Caddy sends by mistake still
finds the backend refusing it. A backend that forgets its check still sits
behind a gate that admits two people.

## What the second person reaches

Through the share host, the person reaches:

* ten routes under `/share/`, which read and write the notes in `05 Shared`
  and nothing else
* the app's own pages and files

The person cannot reach any other note, `/api/`, the agent routes, the
terminal or the chat pane. A name that resolves outside `05 Shared` answers
`404`, and so does a symlink that points out of it, or a name with a slash in
it. The event stream carries only the events for paths inside the folder,
because another note's path in a stream would leak that note's name.

## How a conflict is settled

Two phones can write to one list. Every write names the sha of the note it was
made against. If the note has changed since, the backend answers `409` with the
current sha and writes nothing.

The app then reads the list again and sends the change against the new sha. An
add is not sent twice when an answer is lost. Before a second send, the app
reads the list: if one more open item shows the text the read says the server
keeps for it, the first send landed and the app drops the write. The server says
it, not the app, so the app needs no copy of the editor's field reader, and an
add waits unsent while the read does not say. After three `409`s in a row the write waits
in the queue until the next trigger, such as the phone coming back online. A
tick names its line by
number, and the number comes from the fresh read, so a tick lands on the line
the person meant. A tick on a line that is already in the asked state answers
`200` and changes nothing.

## Live updates

The app keeps an event stream open on `/share/events`. A change to either list,
made in kasten or in the app, reaches the other phone within about two seconds.
If the stream drops, the app polls the list until the stream returns.

The stream is not compressed. A compressor holds the bytes back until it has
enough to send, and the list would then update late or not at all.

## Offline

A change made with no signal is kept in the browser, in the order it was made,
and sent when the connection returns. The queue survives a reload. A replay
that meets a `409` reads the list again and applies the change against the new
sha, as above.

## Clear

Clear removes every done item from the list, with its parts, and nothing else.
An item with a part still open stays, so no open work goes, and a done part of
an open item stays with it. The frontmatter,
the headings and the open items stay as they were. The removed lines stay in
the note's jj history, so
[recovering an earlier version](/how-to/recover-an-earlier-version.md) brings
them back.

## Related

* [HTTP API: shared lists](/reference/http-api/shared-lists.md): the ten routes, with what each takes and answers
* [Reverse-proxy routes](/reference/reverse-proxy-routes.md): the share host's table and its checks
* [Security model](/explanation/security-model.md): the second edge and the rest of the gate
* [The agent boundary](/explanation/the-agent-boundary.md): the other route into the vault, and how it is held
