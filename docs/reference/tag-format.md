---
type: Reference
title: Tag format
description: The one rule every part of kasten reads a #tag by, the characters a tag holds, what ends one, where a hash is no tag, and the table of cases each reader is tested against.
resource: frontend/src/lib/tag-cases.json
tags: [vault, tags, format, frontend, backend]
status: stable
---

# Tag format

A tag is a word with a hash in front, `#kasten`. Every part of kasten that reads
one reads it by the rule on this page, the way Obsidian does: the editor that
colours it, tag completion, the todo pane, saved views and board lanes, `#agent`,
flashcard decks, `GET /api/tags`, the graph and its tag filter, and the mention
finder that leaves a name inside a tag alone.

## The rule

1. A tag is `#` and then a run of tag characters: a letter, a number, `_`, `-`
   or `/`. A letter is any Unicode letter (`\p{L}`), so `#café` and `#日本` are
   tags. A number is any Unicode number (`\p{N}`): a digit, and also `Ⅳ`, `½`
   and `²`.
2. The run holds at least one character that is not a number. `#1on1`,
   `#2026-10-13-x` and `#10-13-01` are tags; `#1984`, `#Ⅳ`, `#½` and `#²` are
   not. `#Ⅳx` is a tag, and so are `#_x` and `#-`.
3. Any other character ends the tag. `(#p/fde),` carries `#p/fde`, and `#x.`,
   `#y:` and `#z!` carry `#x`, `#y` and `#z`.
4. The character in front of the hash is not a letter, a number, `_` or `/`. So
   `note#2x`, `https://a.io/p#x` and `²#x` carry no tag.
5. A hash inside a code span, a fenced code block, an indented code block, an
   HTML comment, a wikilink or a markdown link (its text or its address) is no
   tag. A fence opened with tildes is a fence too, and one nobody closed runs to
   the end of the note. An indented block is code as CommonMark reads it, four
   spaces or a tab after a blank line; a line indented under a list item goes
   on with the item and keeps its tags. A comment may run over several lines.
6. A line that opens with `<!--`, three spaces in front at most and outside
   code, starts an HTML block, as CommonMark reads it. The block ends with the
   first line holding `-->`, that whole line included, or else with the note,
   and no hash in it is a tag. So `<!-- x --> #a` carries no tag, while
   `text <!-- x --> #a` carries `#a`: a `<!--` after other text is a comment
   and no more. A `<!--` in code opens nothing.

`# Heading`, a hash and a space, opens a heading and is no tag.

A hash in the frontmatter, `color: "#fff"`, is no tag. As in Obsidian, the
block's `tags` field names tags instead: `tags: [agent, design]`, a list of
`- agent` lines, or one value, each with a hash or without, and each a tag only
when the rule above makes `#` and the value one. The frontmatter is the block
`frontmatter.py` reads: three dashes at the start of line 1, with nothing after
them but spaces or tabs, open it, and the next line of three dashes closes it.
So ` ---`, a space in front, opens no block, and a note whose block never
closes has none. The editor draws no tag from
the field; `GET /api/tags` and the graph read it.

A deck tag is a tag by this rule that is `#flashcards` or starts
`#flashcards/`, so `(#flashcards/es)` names the deck `es` and `#flashcardsx`
names none. The deck reader skips rule 5 in part: it reads no deck tag in an
HTML comment or any code block, fenced or indented, but still reads one in the
frontmatter or on a line under an HTML block such as `<img>`. See
[Flashcard format](/reference/flashcard-format.md).

## The cases

`frontend/src/lib/tag-cases.json` holds the cases above, each a text and the
tags it carries in order. Every reader runs the whole table in its own tests,
frontend and backend both. A reader that reads one line at a time runs the cases
of one line; a reader that reads a whole note runs them all. A change to the
rule is a change to that table first. The `tags` field has no row there, since
the editor draws nothing from it; its cases sit in the backend's
`test_tag_rule.py`.
