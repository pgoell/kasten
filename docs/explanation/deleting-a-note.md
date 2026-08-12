---
type: Explanation
title: Deleting a note
description: Why a delete moves the note into a hidden folder instead of removing it.
tags: [design, vault, trash, jj]
status: stable
---

# Deleting a note

For most of kasten's life there was no way to delete anything. That was not an
oversight. Every other write in the app is recoverable: a save leaves the old
text in jj, a move leaves the note reachable at the path it left, and the vault
is a directory you can open in any other editor. A delete is the one write with
nothing behind it, so it waited until there was somewhere for the note to go.

## The note is not removed, it is moved

`DELETE /api/files/{path}` renames the note into `.trash/` inside the vault.
Nothing else happens. The bytes are on disk, at a path that says where they came
from and when they left:

```
.trash/00 Inbox/borges.md@2026-08-11T14-03-02.481337
```

Everything that reads the vault already refuses a hidden folder, and it refuses
it in four separate places: the file listing skips hidden entries without
walking into them, rg skips them, the event stream drops any path with a hidden
segment, and the path resolver behind every route refuses one outright. Those
four rules were written for the colocated jj repo, which must stay invisible for
the same reason. A delete borrows all four and adds none: the vault stops
holding the note the moment it moves, and no route can reach it afterwards.

So the note is gone by every definition the app has, and the only thing that
knows otherwise is a shell in the vault directory.

An image goes the same way, through `DELETE /api/assets/{path}`, and everything
below holds for it unchanged: the entry's name is the whole record, the restore
reads it back, and nothing asks first. That is the point of moving rather than
removing. The trash was written for notes and took an image the day images
arrived, with one rule added and none changed.

## The name is the whole record

There is no list of what was deleted, and nothing keeps one in step with the
files. An entry's name says where the note lived and when it went, which is
everything a restore and a purge need. `GET /api/trash` walks `.trash` and reads
the names.

That is the same bargain the vault itself makes. A record kept beside the files
is a record that can disagree with them; a record derived from the files cannot.
Move an entry out of the trash by hand and it stops being on the list by the
same act.

The moment is stamped to the microsecond because the list is ordered by it, and
two notes deleted in the same second are two rows that `<leader>du` has to tell
apart.

## Why not lean on jj

The vault is a jj repo, and jj already holds every version of every note. A
delete could have been a plain `unlink`, with `jj file restore` as the way back.
It is not, for one reason: jj is optional. `vcs.py` swallows every failure it
can, because a note that saved is worth more than the history of that save, and
kasten runs on a box with no jj at all. Recovery cannot depend on something the
write path is allowed to skip.

What jj gives on top is free. The move is a write like any other, so it is
bracketed by a change of its own, named after the entry rather than the note.
Naming it after the entry is what keeps a delete from amending the change
holding the edit before it: the last thing you typed stays reachable at `@-`,
and jj records the delete as the rename it is.

## Why nothing asks first

There is no confirmation dialog. The trash is the confirmation: the cost of a
mistyped `d` is one keypress, `<leader>du`, and a dialog on every delete would
cost one every time. A dialog also gives no way back once you have clicked
through it, which is the failure it was supposed to prevent.

`<leader>du` reads the trash rather than remembering what this tab deleted, so
it reaches a delete made in another tab, before a reload, or by hand in a
terminal pane.

## Why it does not keep forever

`KASTEN_TRASH_DAYS` is thirty days, and the purge runs at startup. A trash that
never empties is a second vault, holding notes you decided you did not want,
paid for in disk and in every backup of that disk.

Thirty days is long enough that noticing a mistake late still works, and the
purge is the one place in kasten that removes a note for good. It runs at
startup rather than on a timer because a delete is the moment the trash grows,
and a process that has not restarted in a month is not a reason to hold the
event loop for a scan nobody asked for. On such a process the trash keeps a
little longer than the setting says, which is the safe direction to be wrong in.

Even then, jj has the note where the vault does not.

## Related

* [The vault and the derived index](/explanation/vault-and-derived-index.md) - the rule this one falls out of
* [HTTP API](/reference/http-api.md) - the four endpoints, and what each refuses
* [Editor keys](/reference/editor-keys.md) - `<leader>df`, `<leader>du` and the tree's `d`
