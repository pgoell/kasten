---
type: Explanation
title: Moving a note
description: Why a move rewrites links before it renames, why a drop asks and the prompt does not, why index entries move only when they were written, and why a folder kasten makes gets an index.
tags: [design, vault, links, okf, file-tree]
status: stable
---

# Moving a note

A note's path is its name, and other notes hold that name in their links. So a
move is never one file changing. It is every file that pointed at the one that
moved, and every file inside a folder that moved, and the index that listed it.
This page is about why kasten does each of those the way it does.

## Why the links are rewritten before the rename

The order looks backwards. The note has not moved yet, and the links are
already pointing at where it is going. It has to be this way round, for two
reasons.

A bare `[[borges]]` is resolved against the listing of the vault, and it only
names the note while the note is still where the link was written to find it.
Rename first and the listing has changed under the link: `[[borges]]` may now
find another note of that name, or none. Reading the links against the vault as
it stood is the only way to know which ones meant this note.

A moving folder is the other reason. The notes holding the links are often the
ones inside it, and after the rename none of them is at the path the rewrite
would write to. So the plan is worked out against the old paths, written to the
old paths, and then the folder is renamed with the rewritten notes inside it.

Both happen inside one jj change, so the rewritten links are part of the move
rather than an edit that happened to follow it.

## Why markdown links follow too

For a long time only wikilinks followed a move. A markdown link was something
you had promised to keep up by hand, and the index guide told agents to list as
few notes as they could for that reason.

An `index.md` is nothing but markdown links, because a reader outside kasten
does not know what a wikilink is. Every folder kasten makes now gets one, so a
move that left markdown links alone would break an index on nearly every move.
That made it worth doing.

A markdown link breaks two ways where a wikilink breaks one. It is read from the
folder of the file holding it, so moving the file breaks it as surely as moving
its target. Both rewrite it. A link between two files that moved together is
left alone, because it still lands where it did, and that is what keeps a moved
folder's own index working.

A link that does not need to change keeps its spelling. One that does is written
the short way from where it now sits. Only four characters are escaped, `%`,
space, `(` and `)`, the ones that end or garble a link, so an accented name
stays readable in the raw file.

## Why a drop asks and the prompt does not

A rename from the prompt does not ask. You typed the new path and pressed
Enter, and that was the decision. A drop in the tree asks, with a list of every
file the move would rewrite.

A drag is easy to make by accident. A hand that meant to click slides a row
onto its neighbour, and the move it makes rewrites notes you are not looking
at, some of them nowhere near the folder you meant to touch. The list is what
lets you see that before it happens.

That is the opposite of the reasoning in [Deleting a note](/explanation/deleting-a-note.md),
which has no confirm because the trash undoes a stray key at once. A move has no
`<leader>du`. The way back is a second move, with rewrites of its own, and
finding which notes the first one touched means reading jj, which is optional.

The list comes from `GET /api/move-preview`, which calls the function the move
calls to plan its writes and then writes nothing. A preview with a rule of its
own would sooner or later list one file and the move rewrite another.

## Why an entry moves only when it was listed

When a note leaves a folder whose `index.md` lists it, the line goes with it,
description and all, to the index of the folder it lands in. When the old index
never listed it, nothing is added anywhere.

An index is curated. Somebody chose what went in it, and wrote a line about
each thing. A note missing from one may be missing on purpose, and putting an
entry for it in the new folder's index would be kasten writing an opinion you
did not hold. Carrying a line someone already wrote moves their choice to where
it now belongs; inventing one makes a choice for them.

The thing that moved has to be the thing listed. An `index.md` or a `log.md`
that moves carries nothing, because neither is an entry in another index.

## Why a folder kasten makes gets an index

That rule sits beside another that looks like its opposite: every folder kasten
makes, by a create, an agent's write or a move, gets an `index.md` the moment it
exists.

The difference is who wrote it. A new folder has no curator yet, so there is no
choice to override, only a gap. The listing is bare, a heading and a bullet per
thing in the folder, with no descriptions, because a description is the part
only a person can write. It is written once. A folder that was already there
keeps what it had, and an index does not grow when a note is added to its
folder. Once written, it is yours to keep, and a list kasten added to on every
create would soon hold lines nobody chose.

A new folder is the one thing added to an index that is already there. The
index above it gains a bare line for the folder, because a folder kasten made
is not one somebody chose to leave out, and without the line nothing would
lead a reader down into it. Even then only an index that is already a list of
markdown links takes the line. One written as prose is somebody's note, and a
bullet tacked on at its end would be noise in it.

A moved folder's index takes the folder's new name as its heading when the
heading was the old name, because that heading was only ever the name. One
written in other words is somebody's title and stays.

## Why the backfill waits to be asked

`mise run index:backfill` gives every folder below the root that has no index
the same bare listing. It runs when you run it, never at startup, unlike the
pass that writes a `type` into every note.

A startup pass would make deleting an index impossible. Delete one you did not
want, restart the backend, and it is back; delete it again, and it comes back on
the next deploy. The type pass can run at startup because a note with no `type`
is never what anyone meant. A folder with no index often is.

## Why a lone index is pruned

A move or a delete that empties a folder takes the folder away, so the tree does
not fill with folders that hold nothing. Before indexes, empty meant empty.

Now nearly every folder holds an `index.md`, and a folder holding only that
would never count as empty again. So a folder with its index and nothing else is
treated as empty, and the index goes with it. A listing of nothing lists
nothing.

The text is not lost. The move or the delete that emptied the folder is one jj
change, and the index is in the one before it. After a move, the entry naming
the folder that went is taken out of the index above, so no index points at a
folder that is not there.

## What this does not cover

kasten can only follow a move it makes. A note moved with `mv` in a terminal
pane, or by any other tool, leaves every link to it as it was, and every entry
naming it in an index. The guide kasten writes into the vault for agents says
so.

## Related

* [HTTP API](/reference/http-api.md#patch-apifilespath): the move routes, the preview, and the rules for links and entries
* [Editor keys](/reference/editor-keys.md#dragging-a-row): dragging a row, and the keys in the confirm
* [Mise tasks](/reference/mise-tasks.md#vault-maintenance): `index:backfill`
* [OKF in the vault](/explanation/okf-in-the-vault.md): why the vault is a bundle with indexes in it at all
* [Deleting a note](/explanation/deleting-a-note.md): the other write that takes a folder away
