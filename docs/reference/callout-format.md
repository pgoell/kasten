---
type: Reference
title: Callout format
description: The line a callout opens with, the thirteen types and their aliases, the title, the fold sign, nesting, where a callout is drawn as a box, and when its source shows.
resource: frontend/src/lib/callout.ts
tags: [vault, format, frontend, editor]
status: stable
---

# Callout format

A callout is a blockquote whose first line opens with `[!type]`. kasten reads
it the way Obsidian does and draws it as a box with a coloured edge, an icon
and a title (#422).

```markdown
> [!warning]- Mind the gap
> The body is every line after the first,
> and can hold any markdown a quote can.
```

## The first line

`> [!type]`, then an optional fold sign, then an optional title.

| Part | Written | Read as |
| --- | --- | --- |
| Type | `[!warning]`, `[!WARNING]`, `[!Warning]` | The same type: case does not matter |
| Fold sign | none | The callout does not fold |
| Fold sign | `+` | The callout folds and starts open |
| Fold sign | `-` | The callout folds and starts shut |
| Title | text after the type and the fold sign | The title as written |
| Title | nothing | The type in title case: `[!warning]` is titled `Warning` |

No space goes between `]` and the fold sign: `[!faq]- Why?`.

## The types

Each type answers to its aliases too, and an alias is drawn as the type it
stands for. A type not in this table is still a callout, drawn as a note.

| Type | Aliases |
| --- | --- |
| `note` | |
| `abstract` | `summary`, `tldr` |
| `info` | |
| `todo` | |
| `tip` | `hint`, `important` |
| `success` | `check`, `done` |
| `question` | `help`, `faq` |
| `warning` | `caution`, `attention` |
| `failure` | `fail`, `missing` |
| `danger` | `error` |
| `bug` | |
| `example` | |
| `quote` | `cite` |

## Folding

A callout with a fold sign draws an arrow beside its title. A click or a tap
on the arrow or the title folds or unfolds the box, and leaves the cursor
where it was. The fold lives on the screen alone: it leaves the file as it is,
and the sign you wrote decides how the callout starts the next time the note
opens.

The cursor never rests in a shut body. A move down from the title lands on
the line under the box, or stays on the title when the callout ends the note;
a move up from below lands at the end of the title.
The search pane draws a shut callout open when the hit is inside it.

## Nesting

A callout may sit inside another, one more `>` for each level:

```markdown
> [!note] Outer
> > [!bug] Inner
> > Body of the inner one
```

A callout may also sit inside a list item or inside a plain quote.

## Where it is drawn

| Place | What you get |
| --- | --- |
| The editor | The box, in live preview |
| An [embed](/reference/embed-format.md) | The box, as in the embedded note |
| The preview pane | The box |
| Copy as Slack | The title as a bold line, `> *Mind the gap*`, then the body quoted |
| Copy as Teams | The title as a bold paragraph at the head of the quote, then the body |

kasten has no print view and no reading view, so there is no other place.

## When the source shows

A callout reveals whole, as a fenced code block does. In vim normal mode the
box is drawn. With the cursor anywhere in the callout in insert or visual mode,
or with vim off, every line of it shows as the markdown you wrote, `>` and
`[!type]` included. [Live preview and the vim mode](/explanation/live-preview.md)
says why the mode decides.
