---
type: Explanation
title: Shared lists
description: Why the shared shopping and todo lists are plain lines in two vault notes, why a second gate and a /share prefix stand in front of them rather than a second user, what the second person can reach, and how a conflict, a live update, an offline change and Clear behave.
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

* six routes under `/share/`, which read and write the notes in `05 Shared`
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
add repeats safely, because it only appends a line. A tick names its line by
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

Clear removes every done line from the list, and nothing else. The frontmatter,
the headings and the open items stay as they were. The removed lines stay in
the note's jj history, so
[recovering an earlier version](/how-to/recover-an-earlier-version.md) brings
them back.

## Related

* [HTTP API: shared lists](/reference/http-api/shared-lists.md): the six routes, with what each takes and answers
* [Reverse-proxy routes](/reference/reverse-proxy-routes.md): the share host's table and its checks
* [Security model](/explanation/security-model.md): the second edge and the rest of the gate
* [The agent boundary](/explanation/the-agent-boundary.md): the other route into the vault, and how it is held
