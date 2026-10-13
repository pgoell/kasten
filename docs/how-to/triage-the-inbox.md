---
type: How-to Guide
title: Triage the inbox
description: Open the inbox triage, read the folder it proposes for a note, move the note, type another place, skip a note, ask again, and undo a move.
tags: [inbox, triage, agent, chat, notes]
status: stable
---

# Triage the inbox

You want to file the notes in the inbox into the folders they belong in, one
note at a time. The inbox triage shows one note with the place Claude proposes
for it. You move the note with one key or one button, or skip it.

It needs a Claude Code login in the shell container, as the chat pane does.
[Run a skill from the chat pane](/how-to/run-a-skill-from-the-chat-pane.md) says
how to sign it in.

## Open the pane

Press `<leader>gi`. The pane takes the focused pane, as `<leader>gs` does for
the review. Its tab is named `triage`.

The header shows where you are, `1 of 12`, and the note's path. Below it is the
note's text.

Press `q`, or click `Close (q)`, to close the pane.

## Read a proposal

Under the text, the proposed place shows in colour: the folder and the note's
file name. One line of reason sits beneath it. Claude takes a moment, and the
pane says `Asking where this belongs` until it answers. The proposal for the
next note is asked for ahead, so `j` usually shows it at once.

Claude picks only from the folders that hold a note in the vault. The inbox,
the archive and the periodic notes folder are not on the list. To file a note
in a new folder, type the path instead ([below](#type-another-place)).

If the folder proposed is no longer in the listing, the pane shows `The proposal was no folder to move to. Press r to ask again, or e to type a place.` Enter does nothing.

If the vault has no folder to file into, the pane shows `No folder to file into. Press e to type a place.` No proposal is asked for.

## Move a note

Press Enter, or click `Move (Enter)`. The note goes to the proposed place under
the same file name. There is no confirmation. The note leaves the inbox list,
and the next note takes its place. Other panes that hold the note follow it to
its new path.

Enter does nothing until the proposal has arrived.

The move is the ordinary note move. [Moving a note](/explanation/moving-notes.md)
says what it changes.

## Type another place

Press `e`, or click `Edit (e)`. A field opens with the proposed path, or with
the note's own path when there is no proposal. Change it to the full path,
which ends in `.md`, and press Enter. Escape closes the field and leaves the
note where it is. `Cancel (Esc)` does the same.

Enter does nothing when the path does not end in `.md` or is the note's own
path. The field stays open.

## Skip a note

Press `j`, or click `Next (j)`, to go to the next note. Press `k`, or click
`Previous (k)`, to go to the previous one. Skipping moves nothing. The note
stays in the inbox, and the pane starts again at the top of the inbox the next
time you open it.

Walking past a note while Claude is still answering for it stops that answer.

## Ask again

Press `r`, or click `Ask again (r)`. Claude answers for this note once more.
Ask again does nothing while Claude is still answering.

A proposal that has arrived is kept for the life of the page. Walking back to
the note with `k` does not ask again. Only `r` does, and a page reload clears
every proposal.

## Open a note

Press `o`, or click `Open (o)`. The note replaces the triage in the focused
pane. Press `<leader>gi` in that pane to bring the triage back.

## When a move is refused

The pane keeps the note and shows `Could not move to <path>. Something may
already be there.` under the proposal, where `<path>` is the place you tried.
Press `e` and type another path.

## When no proposal comes

The pane shows the failure under the note, in the form `POST /chat/propose failed with 502. Press r to ask again, or e to type a place.` The number is the status:

* `502`: Claude gave no usable answer, or the proxy could not reach the runner.
  Claude gave no usable answer when its run ended in error or named no folder
  on the list. A runner that cannot be reached is not running, and
  [Troubleshoot self-hosting](/how-to/troubleshoot-self-hosting.md#the-chat-pane-does-not-connect)
  says how to start it.
* `500`: the runner's query failed. The runner's log holds the cause.

If every note fails, check that Claude Code has a login in the shell container.
[Run a skill from the chat pane](/how-to/run-a-skill-from-the-chat-pane.md) says
how to sign it in. Then press `r`.

## Undo a move

Move the note back. Press `<leader>rf` to open the rename prompt, and set the
note's folder to the old one.

If no save came after the move, you can also reverse the last change in jj.
[Recover an earlier version of a note](/how-to/recover-an-earlier-version.md#undo-the-last-thing-that-happened)
shows how.

## Things to know

* The first 8000 characters of the note go to Claude, with the ontology note and
  the list of folders. Each folder comes with up to five note names.
* The proposal does not appear in the chat pane, and it does not change the chat
  session.
* The queue holds every note under the inbox folder, at any depth, except
  `index.md` and `log.md`. Notes in subfolders such as `02 Books` are in it too.
* The prod example sets `KASTEN_FLASHCARDS_PATH` to the inbox, so imported Anki
  decks show in the queue. Skip them with `j`.

## Related

* [Editor keys](/reference/editor-keys.md#the-triage-pane): every key in the pane
* [Moving a note](/explanation/moving-notes.md): why a move rewrites links first
* [The chat pane](/explanation/the-chat-pane.md#why-the-triage-asks-outside-the-session): why the proposal is a separate call
