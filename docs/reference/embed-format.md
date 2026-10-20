---
type: Reference
title: Embed format
description: The forms an embed is written in, how each part is read, how the target resolves, what is drawn for a note, a section, an image, a pdf, a missing target and the depth stub, how to open one, and what it does not do.
resource: frontend/src/lib/embed.ts
tags: [vault, links, format, frontend, editor]
status: stable
---

# Embed format

An embed draws one note inside another. It is a [wikilink](/reference/editor-keys/links.md#wikilinks)
with a `!` in front, the syntax Obsidian uses, so a vault read there draws the
same embeds.

```markdown
![[Reading list]]
![[Plan#Risks]]
![[Plan#Risks|the risks]]
![[screenshot.png]]
![[plan.pdf]]
```

## The forms

| form | draws |
| --- | --- |
| `![[note]]` | the whole note |
| `![[note#heading]]` | one section of the note |
| `![[note\|alias]]` | the whole note; the alias is ignored |
| `![[note#heading\|alias]]` | one section; the alias is ignored |
| `![[image.png]]` | the picture |
| `![[image.png\|200]]` | the picture, 200 pixels wide |
| `![[image.png\|200x100]]` | the picture, 200 wide and 100 high |
| `![[image.png\|words]]` | the picture, with the words as its alt text |
| `![[file.pdf]]` | the pdf's pages, in a box that scrolls |
| `![[file.pdf#page=3]]` | the same, scrolled to page 3 |

## How each part is read

**The target** is everything before `#` or `|`. It resolves by the rule a
wikilink follows:

* A target with a slash in it is a vault-relative path, taken as written.
  `.md` is added unless you typed it.
* A target with no slash is a name, looked for anywhere in the vault by file
  name, ignoring case. A note of that name at the vault root wins over one in a
  folder.

**The heading** follows `#`. It is matched against the note's headings ignoring
case and the spaces around it, so `![[Plan# risks ]]` finds `## Risks`.

**The alias** follows `|`. On a note it is read and then ignored: an embed draws
the note, not a name for it, so `![[Plan|the plan]]` and `![[Plan]]` draw the
same box. On an image it is read as Obsidian reads it: a number is the width in
pixels, `200x100` is the width and the height, and anything else is the alt
text. In a table the bar is written `\|`, and the backslash is not part of the
alias.

## What is drawn

The embed takes the place of its line, in a box.

* **A note** draws its body the way live preview draws a note, read only. The
  frontmatter block is left out.
* **A section** draws the heading line and everything under it, up to the next
  heading of the same or a higher level, or the end of the note. Lower headings
  stay inside: `![[Plan#Risks]]` on a `## Risks` keeps its `### Cost` and stops
  at the next `##` or `#`.
* **An image** draws the picture, as `![](path)` does, when the target names a
  file of one of the types the vault takes: `.png`, `.jpg`, `.jpeg`, `.gif` and
  `.webp`.
* **A pdf** draws its pages in a box of fixed height that scrolls, each page as
  wide as the box, so a phone gets pages it can read across. A page is drawn
  when it scrolls into view, not before. A pdf that will not load reads
  `Could not read plan.pdf` in the box. `![[plan.pdf#page=3]]` scrolls the box
  so page 3 is at its top; a page the pdf lacks, or any other heading, leaves
  page 1 there. The alias is ignored.
* **A missing target**, a note, a heading or a pdf the vault does not hold,
  draws a plain box saying `Not found`.
* **The depth stub.** Embeds nest, and stop at a depth of three. At that cap an
  embed draws a stub box in place of its note, so a note that embeds itself, or
  embeds a note that embeds it, stops there rather than drawing without end.

The box follows its note. When the note changes in the vault, by an agent's
write, an edit in another pane or a save, the embed draws again.

The source comes back by the [live preview](/explanation/live-preview.md) rules:
with vim on, insert or visual mode with the cursor on the line; with vim off,
the cursor on the line. The cursor never rests inside the hidden `![[...]]`.

The finder's preview pane shows `![[...]]` as source. It has no way to read
another note. A note opened before the vault's listing arrives shows its embeds
as source for that moment too, since a name cannot be resolved without it.

## Opening the note

| Gesture | Does |
| --- | --- |
| Ctrl+click, Cmd+click on a Mac | Open the embedded note in the pane the embed sits in |
| Tap, on a phone | The same |

A section embed opens the note at its heading. A pdf opens in a pdf pane beside
the note, as `gf` on `[[plan.pdf]]` does, at page 3 for `![[plan.pdf#page=3]]`.
A plain click does nothing to the embed.

## Out of scope

* **Block references**, `![[note#^id]]`.
* **Editing in place.** The embedded text is read only; open the note to change
  it.
* **Other files.** An epub, or any file that is neither a pdf nor one of the
  image types above, is not drawn.
