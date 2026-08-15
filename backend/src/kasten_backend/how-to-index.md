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

* [Reading this vault](99%20Misc/01%20Config/reading-this-vault.md) - how the links here resolve
* [Inbox](00%20Inbox/) - notes with nowhere to be yet
* [Periodic](01%20Periodic/) - the day, week, month, quarter and year
```

Four rules for the links:

1. **Markdown links, not `[[wikilinks]]`.** An index is read by tools that have
   never heard of this vault, and a wikilink means nothing to one.
2. **Relative to the file the index sits in.** A folder's index links its own
   folder's contents.
3. **Encode the spaces.** `99 Misc/` is written `99%20Misc/`. This vault's
   folders have spaces in their names and a raw space breaks the link.
4. **A trailing slash for a folder, the full filename for a note.**

Group entries under `##` sections when there are enough of them to want
grouping. An index of six lines does not need sections.

## Prefer folders to notes

Nothing maintains these links. Kasten rewrites `[[wikilinks]]` when a note
moves, and it does not touch markdown links, so every link written here is one
you have promised to fix by hand.

Top-level folders are renamed almost never, and a note is renamed often. So list
folders, and list a note only when it is worth the risk of the link going stale.
Renaming a folder means editing every index that named it.

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
