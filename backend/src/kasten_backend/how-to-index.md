---
type: Reference
---

# How to write an index and a log

For agents working in this vault, whether you run in kasten's own terminal pane
or on a machine outside it.

This vault is an Open Knowledge Format bundle. Two filenames mean something
other than a note in one: `index.md` lists what is in a folder, and `log.md`
records what changed. Every other file is a note. This page says what goes in
those two, because the rest of the vault's guides are about notes and neither of
these is one.

## Neither one carries a block

Kasten writes no `---` block into a file called `index.md` or `log.md`, at any
level of the vault, and neither should you. A note has an `id`, a `created`, a
`modified` and a `type`; these two have none of that, and a listing is named by
where it sits rather than by a field inside it.

One exception, and only at the vault root: `index.md` there may carry
`okf_version` and nothing else.

```markdown
---
okf_version: "0.2"
---
```

It is optional. A bundle with no root index at all still conforms, so do not
write one just to have one.

## An index is a list of links with descriptions

A heading, then one bullet per entry: a markdown link, a space-hyphen-space,
then what the thing is.

```markdown
# The vault

* [Reading this vault]({{config|url}}/reading-this-vault.md) - how the links here resolve
* [Inbox]({{inbox|url}}/) - notes with nowhere to be yet
* [Periodic]({{periodic|url}}/) - the day, week, month, quarter and year
```

Four rules for the links:

1. **Markdown links, not `[[wikilinks]]`.** An index is read by tools that have
   never heard of this vault, and a wikilink means nothing to one.
2. **Relative to the file the index sits in.** A folder's index links its own
   folder's contents.
3. **Encode the spaces.** A raw space ends the link, so a folder called
   `Reading List/` is written `Reading%20List/`. Any name with a space in it
   needs this, a folder's or a note's.
4. **A trailing slash for a folder, the full filename for a note.**

Group entries under `##` sections when there are enough of them to want
grouping. An index of six lines does not need sections.

## What kasten keeps up for you

A move made in kasten, from the app, keeps these links working. When a note or
a folder moves, kasten rewrites every relative markdown link in the vault that
pointed at it, and every one inside it that the move would break, the way it
rewrites `[[wikilinks]]`. If the old folder's index has an entry for what moved,
the line goes to the new folder's index, description and all, and is gone from
the old one. A folder emptied by the move goes, its index with it, and so does
the entry naming it in the index above.

Every folder kasten makes, for a note written by you, by the app or by an agent,
gets an `index.md` the moment it is made: the folder's name as a heading and a
bullet per thing in it, with no descriptions. The outermost new folder is also
added to the index of the folder above it, as a bare `* [name](name/)` at the
end, when that index is already a list of markdown links; an index written as
prose is left alone. A folder that already existed keeps whatever it had, and
its index does not grow when a note is added to it. A moved folder's index
takes the folder's new name as its heading, if its heading was the old name.
So an index kasten wrote is a start, not a finished listing. Write the
descriptions in, and add an entry for each note you put in a folder that has
one.

## Prefer folders to notes

What kasten cannot see, it cannot fix. A note moved with `mv` in a shell, or
with any tool other than kasten, leaves every markdown link to it pointing at
nothing, and the entry in the old index stays where it was. If you move files
yourself, the links are yours to fix by hand.

Top-level folders are renamed almost never, and a note is renamed often. So list
folders, and list a note when it is worth the entry: one moved outside kasten
is one more link to fix.

## A log is dated sections, newest last

```markdown
# Log

## 2026-08-14

* **Creation**: Added the reading list.

## 2026-08-15

* **Update**: Split the reading list by year.
```

An `##` heading per date in `YYYY-MM-DD`, and one bullet per thing that changed.
Say what changed and why, not which files moved: the history already knows the
files.

## Turning a note into one of these

If you rename a note onto `index.md` or `log.md`, the block it had stays where
it is, and the file stops being a valid part of the bundle until you finish the
job by hand. Two steps, both yours:

1. Delete the `---` block. Kasten will not do this for you, because deleting it
   throws away an `id` and a creation date that are yours.
2. Rewrite the body as a listing or a log, in the shape above. A note's prose is
   not a listing just because the file is now called `index.md`.

Going the other way is automatic. Rename an `index.md` to anything else and
kasten gives it a full block at its new path, because it is a note again.

## Related

Wikilinks here, not markdown links, because this is a note rather than an index
and kasten keeps a wikilink pointing at its target when the target moves.

* [[reading-this-vault]], how a wikilink resolves to a file
* [[Ontology]], the types a note may carry and the relations between notes
