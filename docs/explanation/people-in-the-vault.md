---
type: Explanation
title: People in the vault
description: Why a person is a note with a type rather than a record, why their card counts links and never names, what that costs the vault as it stands, and why nothing was indexed to build it.
resource: frontend/src/lib/person.ts
tags: [vault, people, links, frontend]
status: stable
---

# People in the vault

A vault about work is mostly about people. The meeting was with somebody, the
todo is waiting on somebody, the thing that got finished was finished for
somebody. Those three facts are written in three different corners of the vault
and nothing gathered them, so answering "where am I with Tobias" meant
remembering which notes to open.

The person card answers it. What is worth explaining is not the card, which is
three lists, but the three decisions under it.

## A person is a note with a type

`type: Person` in the frontmatter, in the folder people already sat in. Not a
table, not a contacts file, not a field on every note that mentions them.

The vault is the source of truth and a person is a thing you write about, so
they get what everything else you write about gets: a note, with prose in it and
links out of it. The type is the one bit added on top, and it does one job,
saying which notes draw a card. Everything else about a person, who they work
for, what they are like, what you owe them, stays prose, because prose is what a
note is for and no schema was ever going to hold it.

This is the same move [the archive](the-archive.md) makes. A folder rather than
a field, a convention rather than a mechanism, because the vault has to stay
readable by `cat` when kasten is not running.

## The card counts links, never names

A line is on somebody's card when it carries a `[[wikilink]]` that resolves to
their note. `ask Max about the script` is on nobody's card. `ask [[Max Bosch]]
about the script` is on his.

The alternative was matching the name as text, and it is tempting because it
would have worked on the vault as it stood, where about a third of the open
todos name somebody in prose and none of them linked one. It was refused, and
the reason is the vault's own contents: two colleagues share the first name Max,
one surname is an ordinary German word, and a first name is a substring of other
words. Matching text would put one person's work on another person's page, and a
card is exactly the kind of screen you read without checking. A card that is
sometimes wrong about who owes what is worse than a card that is empty, because
an empty one tells you it is empty.

So the rule is the one the editor already has. `wikiLinkPath` resolves a target
against the vault listing, which is what makes `[[borges]]` and
`[[reading/borges]]` the same note and a second Borges in another folder a
different one. The backlinks panel decides what links to a note this way, and
the card decides what names a person the same way, on purpose: two answers to
one question would be two answers to drift apart.

## What it costs, and who pays

Nothing links anybody yet. On the day the card shipped, no open todo in the
vault carried a person's link, so every card is empty until the writing changes.
That is the real cost of the rule, and it is paid by the writing rather than the
code: `How-To-TODO` in the vault now asks agents to write the link, and the done
log copies the words of a todo, so a person linked once shows on their card
while the work is open and again when it is done.

This is worth stating plainly rather than hiding behind a heuristic. The card
does not guess, so it is only as good as the links, and the vault is where the
links have to appear.

## Nothing was indexed to build it

There is no table behind this. The card asks `GET /api/todos` for every checkbox
line in the vault and `GET /api/search` for every line carrying the person's
name, which are the two answers the todo pane and the backlinks panel already
hold in the query cache, and it does the reading in the browser.

That follows [the vault and the derived index](vault-and-derived-index.md). The
vault is small, ripgrep is fast, and a feature that would have been the first
reason to build an index is not a good reason to build one. If a card ever feels
slow, the thing to measure is the scan, and the answer then is an index for
every list rather than a table for this one.
