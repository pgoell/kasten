---
type: Reference
---

# Reading this vault

This vault is an Open Knowledge Format bundle. Every note is a markdown file and
the directory is the source of truth, so `rg`, an editor and `cat` are enough to
read the whole of it.

Notes point at each other with `[[wikilinks]]`. A link names a note rather than
a place, which is what lets a note move between folders without breaking every
link written to find it. That leaves one question a reader outside the app
cannot answer by looking: which file `[[borges]]` means. This note answers it.

## How a link resolves

Given `[[target]]`, in this order:

1. Trim the spaces around the target, then add `.md` unless it already ends in
   exactly that, lowercase. `[[Borges.MD]]` is a target named `Borges.MD` and
   becomes `Borges.MD.md`.
2. If that exact spelling, case and all, is a file in the bundle, that is the
   note. Nothing below runs.
3. If the target holds a slash, it is a path from the bundle root, and that is
   the answer whether or not a file is there.
4. Otherwise take the first file whose name matches, ignoring case, walking the
   bundle's paths in sorted order.
5. If nothing matches, the link points at a note nobody has written yet, at the
   bundle root.

Step 4 is the one to get right. A note at the root does not win by being at the
root; it wins at step 2, by being spelled exactly. Sorted paths put
`00 Inbox/borges.md` before `borges.md`, so `[[BORGES]]`, which matches neither
exactly, finds the inbox note.

## What the block at the top holds

Four of its fields belong to kasten and the rest are yours. `id` names the note
when its path cannot, `created` and `modified` are dates, and `type` says what
kind of thing the note is. Everything else in the block comes through a save
unread.

Two filenames carry no block at all: `index.md`, which lists the bundle, and
`log.md`, which is its history. Kasten writes nothing into either, at any level
of the vault, so a file named that way never gets an `id`.
