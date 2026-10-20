---
type: Explanation
title: Reading a pdf beside a note
description: What reading a pdf beside a note costs over an epub, why the reader builds its own overlay and search for the pdf renderer, and where the vendored pdf.js comes from.
tags: [design, vault, reader, pdf]
status: stable
---

# Reading a pdf beside a note

## What a pdf costs

Everything above is true of a pdf, and none of it was free. foliate renders one
through a second renderer, the one it keeps for books whose pages are pictures,
and that renderer hands out a page and nothing else: no overlay to draw on, no
index saying which page you are looking at, and no way to build a page's
document without drawing it. Three of the four things the reader does had to be
built over the top of it.

**The overlay is hung by hand.** foliate's own `Overlayer` is a standalone
class, so the pane makes one per page and hangs it inside pdf.js's text layer,
which sits over the page and shares its coordinate space. It is scaled by the
inverse of the transform pdf.js puts on the page, because pdf.js lays a page out
at the screen's device pixel ratio and scales the whole document back down, so
on a retina screen one layout pixel is half a client pixel while the rectangles
a selection answers with are client pixels. That is the sort of thing that works
on the machine it was written on and nowhere else, so it is read off the
computed transform rather than assumed.

**A resized pane doubles the page's words, and the pane undoes it.** foliate
re-renders a page whenever its box changes, and pdf.js appends its text layer to
whatever the container already holds rather than replacing it. Measured in
Chromium: two spans become four and the page reads twice. Left alone, every
highlight would anchor to the copy the words had already left, `indexOf` taking
the first of the two. The pane throws away every generation but the newest,
using the marker foliate itself appends when a render finishes.

**`gf` reads the pages without drawing them.** A pdf's sections carry no
document to search, so the seek opens the same bytes a second time through
pdf.js and asks each page for its text content, which parses the page and draws
nothing. It is opened with the same character maps and fonts the page on screen
was, or a document whose fonts need them, which is most CJK, would answer with
text that is not what you can see. It costs a second reading of the whole file
where the epub arm costs a section at a time, and it is spent on a keypress
rather than on anything you are watching.

**Closing the pane frees the worker, which the library does not.** foliate's
`close` frees its renderer and stops, and nothing in it ever calls the book's
own `destroy`, which for a pdf is the document and the worker parsing it. An
epub cost nothing by that, holding a zip reader already closed. A pdf costs a
worker per file, so the pane frees the book itself on the way out, and it does
it in the same place it closes the renderer: a pane shut while the file is still
opening has no book to free at that moment and is handed one a second later,
which is the case a second call site would have missed.

One cost is not paid, and is written down here instead of fixed. A passage taken
out of a pdf lands in the note one line per line of the pdf, because that is
where a pdf breaks its lines and a pdf puts no space between one line and the
next. Joining them would read better and would stop the passage being found
again, the words on the page having no space there either. The words are the
anchor, so the words win.

## Where pdf.js comes from

foliate vendors its own build of pdf.js, and the parts of it a page needs at
runtime, a web worker, two stylesheets, the character maps a CJK document wants
and the fourteen fonts a pdf may name without embedding, are files rather than
imports. foliate reaches them with a URL built out of `import.meta.url`, which
Vite rewrites into a glob over a pattern it then refuses, so out of the box the
dev server dies on the module and the build resolves every one of those URLs to
the string `undefined`. Nothing says so: the page just never draws.

So `vite.config.ts` replaces that one line with a fixed base, `/pdfjs/`, and
stages the five names into `public/` where the dev server serves a directory
untouched and the build already copies one. The copy is not laziness about a
`/@fs/` path straight at `node_modules`: everything served that way goes through
the transform pipeline, which turns a `.css` into a javascript module, and
foliate fetches those two stylesheets as text. An unstyled text layer lays every
span at the left edge, so the page still draws and every selection takes the
wrong words, which is the worst way for it to fail.

Production adds one line to `nginx.conf` for the same reason. nginx's own
`mime.types` has no row for `.mjs`, so the worker would go out as
`application/octet-stream` and Chrome refuses a module worker whose type is not
javascript. That failure is invisible in development, which is why it is written
down here.
