---
type: Explanation
title: OKF in the vault
description: Why the vault is an Open Knowledge Format bundle, what one field bought, and what still does not conform.
tags: [design, vault, okf, frontmatter]
status: stable
---

# OKF in the vault

[Open Knowledge Format](https://github.com/GoogleCloudPlatform/knowledge-catalog)
is a description of a directory of markdown files: what the files are called,
what the block at the top of one may say, and which two names mean something
other than a note. The vault was most of that already, because the vault is a
directory of markdown files and always has been. This page is about the gap
that was left and what closing it cost.

## One field is the whole of it

Every note now says what kind of thing it is:

```markdown
---
id: 019fd761-2599-71ba-b6d0-7b0d8e0a7367
created: 2026-08-06T14:01:35+00:00
type: Note
modified: 2026-08-06T14:01:35+00:00
---
```

That is the adoption. No schema, no validator, no second file listing what a
type may be. `type` is written once, on a note's first write, and nothing
overwrites one that is already there, whoever put it there.

The reason to want it is that `type` is the field a reader outside kasten keys
off. A note is a file, and a file says nothing about whether it holds a clipping,
a day's log or an idea you have been circling for a year. An agent reading the
vault from a terminal, an importer, or a person opening the folder in another
editor, all of them get the answer from the note rather than from a folder name
that will be wrong the first time a folder moves.

`Note` is the default and it is the honest one. A note somebody typed into an
empty buffer is a note, and inventing a better answer from its path would be a
rule about paths.

## What that costs, and it is a real cost

A writer that knows what it is making says so in the text it hands over, and
everything else gets the default. So the type a note ends up with is decided by
the door it came in by, and two notes that are the same kind of thing can
disagree because they were made in different ways. A note made by following a
dangling link is a `Note`, where the same note made by a periodic key says
`Periodic Note`.

Living with that is the call. The alternative is a rule that reads a type off a
path, and every such rule is wrong the first time a folder is renamed. A type
you disagree with is one line to edit, and nothing ever writes over it again.

## The pass over the notes already there

The vault held thousands of notes with no `type` in them, and a field only new
notes carry is a field nothing can rely on. So there is a pass, in
`backend/src/kasten_backend/okf.py`, that runs at startup and writes `type: Note`
into every note that has none.

It is not a save. Going through `PUT` would have been less code and would have
rewritten `modified` on every note in the vault, which would have dated your
whole history today. The pass writes the one line and touches nothing else: no
`modified`, no `id`, no creation date. A note written before kasten has a real
creation date somewhere and this pass does not know it, so `id` and `created`
arrive on that note's next actual save.

It works out every rewrite before it writes anything, so a boot on a vault that
needs nothing leaves no empty change in the history. When there is something to
write it takes one jj change for the whole pass rather than one per note, and it
is idempotent: the second run finds nothing and returns.

`mise run okf:backfill` is the same code from a terminal, over any vault you
name.

## The two reserved names

`index.md` is a listing of the bundle and `log.md` is its history. Neither is a
concept document, so kasten writes no block into either, at any level of the
vault. [Note frontmatter](/reference/note-frontmatter.md#the-two-reserved-filenames)
states the rule and what follows from it.

The consequence worth naming here is that a file called `index.md` has no `id`.
Everything else in the vault is nameable two ways, by path and by id, and these
two are nameable one way. That is correct rather than unfortunate: a listing is
about where things are, so a name that survives a move would be naming the wrong
thing.

## Why the vocabulary is a note

The types a note may carry, and the relation names a note writes between notes,
are listed in `99 Misc/01 Config/01 Agents/Ontology.md`. That is a note in the
vault, not a config file and not a schema, and the difference is the whole
design.

Nothing validates a relation. An unknown name works: it is a relation, it draws
as a label, and it groups in the backlinks panel under its own spelling. Writing
`invented-yesterday:: [[Embeddings]]` is legal the moment you type it, and adding
it to the vocabulary is one line in a note rather than a release.

That also means the ontology inspector already exists. It is that note, open in
a pane, edited with the keys you edit every other note with.

The editor's completion reads the note, and the two alternatives are both worse:

* **A hardcoded table** would drift from the note. Somebody adds a relation to
  the note, the completion goes on offering the old six, and now there are two
  answers to what the vault's vocabulary is.
* **The names already written in the vault** would spread a typo instead of
  catching it. Write `dpeends-on` once and it is on the list forever, offered
  beside the right one, and the second typo is a completion away.

Reading a note nobody validates is the honest version: the list is what somebody
decided it should be, rather than what has happened to be typed.

The note is written into a vault that does not hold one, at startup, the way the
format guides are. The readers are not all inside the app, so a key press could
not be what writes it. Delete it and it comes back on the next boot, which is
the bargain the guides and the saved views note already make.

## What conforms and what does not

Conforming, today:

* Every note carries a `type`.
* `index.md` and `log.md` carry no block kasten wrote, and may carry
  `okf_version` alone.
* Links resolve by a rule written down, in the note at
  `99 Misc/01 Config/reading-this-vault.md`, which the backend writes into a
  vault that does not hold it. A bundle whose links only resolve inside the app
  that wrote them is not a bundle anybody else can read, and that note is what
  makes the wikilinks readable from outside.

Not conforming, and left that way on purpose: a note renamed onto `index.md` or
`log.md`. It keeps the block it had, and the bundle stops conforming until
somebody converts the file by hand. Kasten could delete the block for you, and
will not: that would delete an id and a creation date you own, and it would not
be enough anyway, because the body has to become a listing or a log for the file
to mean what its name says.

A fresh vault gets no `index.md` at all. A consumer may not reject a bundle for
missing one, `okf_version` is optional, and generating a listing would mean
kasten owning a file you are meant to edit.
