---
type: Reference
title: HTML theme contract
description: How an HTML page in the vault opts in to kasten's theme, what kasten adds to such a page, the messages that carry a theme switch, the fallback layer for a file opened outside kasten, what a page may and may not do, how to check one, and the token table.
resource: backend/src/kasten_backend/html_page.py
tags: [frontend, backend, design, html]
status: stable
---

# HTML theme contract

A page opts in with one tag in its `<head>`:

```html
<meta name="kasten-theme" content="tokens">
```

Attribute names and values are compared without case. A meta tag inside a comment, or inside a script's text, does not count.

## What kasten adds

Every page, opted in or not, gets the page script at the very start, right after the doctype, so the page keeps standards mode. A page with no doctype gets it at byte 0. The script takes its own reference to `window.parent` before any page code runs, and its key listener goes on `window` before the page adds any of its own. A page without the tag gets only that and the links script at the end, nothing about colour or fonts.

For a page that opts in, kasten also does the following.

- When the pane sends a known theme and palette, it writes `<html data-theme="…" data-palette="…">` before the page script. The page's own `<html>` attributes merge onto it, and the first value of each attribute wins, so the page cannot set `data-theme` itself.
- It inserts two inline `<style>` elements at the end of `<head>`, or straight after the meta tag when there is no `</head>`. One holds the Reader fonts (Newsreader, Instrument Sans and JetBrains Mono, latin subset, as `data:` URLs). The other holds all of `kasten-theme.css` as a normal stylesheet with no layer.
- The styles go inline, not linked, because the frame has an opaque origin. Its requests reach the login gate as cross-site, so the `SameSite=Lax` login cookie is not sent, and a font request goes out with `Origin: null` and no credentials. A link would work in dev and fail behind oauth2-proxy. The page policy allows this with `font-src data:` and `style-src 'unsafe-inline'`.
- Nothing is injected when the theme or palette is missing or not a known value. "Open in a browser tab" sends no query, so the page shows with its own fallback layer, as a file opened outside kasten does.

Every page, opted in or not, gets a mark when a passage is taken from it. The page script adds a highlight named `kasten-taken` and a constructed stylesheet that styles it: the `--k-mark` background and a 1 px underline in `--k-accent`. A page that does not opt in has no `--k-mark`, so the mark takes the light value. The page's markup is not touched. The marks stay while the page is open, and Undo takes the last one away.

## Messages

The pane loads the page at `/api/html/<path>?theme=<light|dark>&palette=<poel|russet|peach|pansy>`. It takes both values when it opens the page. A switch does not change the address, so the page does not reload, and its scroll and open details stay.

- The page script posts `{kasten: 'hello'}` to its parent on start.
- The pane answers with `{kasten: 'theme', theme}` and `{kasten: 'palette', palette}`. It posts both again when the frame loads and on every switch.
- The page script sets `data-theme` or `data-palette` on `<html>` only when the message comes from its parent, the value is one of the known ones, and the page carries the meta tag.

Selecting and taking use four more messages:

- The page script posts `{kasten: 'selection', text, heading, anchor, rect}` when the selection changes: after a mouse up, after Shift with an arrow, Home or End, while a touch selection moves, and on a scroll. `heading` is the nearest `h1` to `h6` above the selection's start, in the same article, section or card. `anchor` is the story id the page prints as `a.sid` in that article, or else the nearest `id`. `rect` is the selection's box in the frame's own pixels. A cleared selection posts `text: ''` and `rect: null`.
- The page script posts `{kasten: 'key', key: 'y'}` only while text is selected. With no selection, `y` is the page's own letter.
- The pane posts `{kasten: 'take'}` once the passage is safe in today's dump. The page script marks the selection with `kasten-taken`.
- The pane posts `{kasten: 'untake'}` when Undo takes the dump line out of the daily note. The page script removes the last mark.

The pane acts on a selection only while the frame holds the focus, and on a `y` only while a passage is held. The page script answers `take` and `untake` on every page, opted in or not.

## Fallback layer

A file opened outside kasten has no kasten stylesheet, so it carries a copy of the tokens in a layer named `kasten-fallback`. Rules outside a layer win over rules inside one, so inside kasten the injected file wins. The light set sits on `:root`. The dark set sits under `prefers-color-scheme: dark` when `data-theme` is not light, and under `[data-theme=dark]`.

The layer holds every token of the table at the end of this page. The example keeps three. The page's own rules name tokens only, with `var(--k-*)`:

```css
@layer kasten-fallback {
  :root {
    --k-bg: #f6f6f4;
    --k-ink: #1c1c1b;
    --k-link: #316f90;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --k-bg: #141414;
      --k-ink: #e8e7e4;
      --k-link: #82b9d9;
    }
  }
  :root[data-theme="dark"] {
    --k-bg: #141414;
    --k-ink: #e8e7e4;
    --k-link: #82b9d9;
  }
}

/* Outside the layer: the page names tokens only. */
body {
  background: var(--k-bg);
  color: var(--k-ink);
}

a {
  color: var(--k-link);
}
```

## Where to copy kasten-theme.css from

Plugins inline the file into their fallback layer at build time. It sits at a stable path:

- In a browser, through the login gate: `/api/kasten-theme.css`.
- From the shell container: `$KASTEN_API/api/kasten-theme.css`.
- On the host: the repo file `frontend/src/styles/kasten-theme.css`.

The backend serves its copy at `GET /api/kasten-theme.css`, and a test holds that copy equal to the frontend file byte for byte. An older copy still works.

## The rules

- May: any layout, any token anywhere, `color-mix(in srgb, var(--k-warn) 14%, transparent)` for tints, SVG with `currentColor` or `var(--k-*)`, page-local variables that point to tokens, `prefers-reduced-motion`.
- May not: hex, rgb or named colours outside the fallback layer. Loading fonts or naming font families. Setting `data-theme` or reading the system theme inside Kasten. Redefining `--k-*` outside the fallback layer. Fixing the page height or catching Space, `?` or Escape. Fixed bars over the top of the page. Styling `::highlight(kasten-taken)` or `::selection`, or stopping `mouseup`, `selectionchange`, `keyup` (Shift with arrows), `pointerdown` and `scroll`, which the page script listens to. Using `y` as a shortcut while text is selected. `localStorage`, cookies or calls to the vault.
- How to check a page: switch the theme half way down, scroll stays. Open the file directly in light and dark system mode. Grep the CSS for `#`, `rgb(` and quoted `font-family` outside the layer.

## What kasten closes for you

Two holes that #785 left in the page script are closed.

- A page could cut the script off. The script used to sit at the end of `<body>`, and a page's own top-level `var parent = …` cut it off from its parent. The script now runs first and takes its reference to `window.parent` before any page code.
- A page could keep Space, `?` and Escape from kasten. The script's capture listener on `window` now comes before any the page adds, so it sees each key first.

## The token table

The values are those of the default palette, `poel`. [Accent palettes](/reference/accent-palettes.md) gives the values of the other three, and [Design tokens](/reference/design-tokens.md) gives the contrast each pair holds.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--k-bg` | `#f6f6f4` | `#141414` | Page background |
| `--k-paper` | `#fbfbfa` | `#1a1a1a` | Cards, boxes, panels |
| `--k-surface` | `#ebebe8` | `#232323` | Chips, inputs, tab hover |
| `--k-ink` | `#1c1c1b` | `#e8e7e4` | Body text, headings |
| `--k-ink-soft` | `#3b3b39` | `#c6c5c1` | Secondary running text |
| `--k-muted` | `#666663` | `#9a9995` | Meta lines, captions, labels |
| `--k-rule` | `#e1e1de` | `#2c2c2c` | Hairlines |
| `--k-rule-strong` | `#1c1c1b` | `#e8e7e4` | Rule under a section head, top of a table |
| `--k-inset` | `rgba(28,28,27,.06)` | `rgba(232,231,228,.08)` | Code blocks, placeholders |
| `--k-accent`, `--k-link` | `#316f90` | `#82b9d9` | Links, kickers, active markers |
| `--k-accent-wash` | `rgba(49,111,144,.11)` | `rgba(130,185,217,.14)` | Accent tint behind a chip or box |
| `--k-highlight`, `--k-mark` | `rgba(249,157,27,.22)` | `rgba(167,212,228,.18)` | Selection, marked and taken passages |
| `--k-ok` | `#247b4b` | `#7acd97` | Fine, added |
| `--k-warn` | `#8d5e09` | `#e7aa53` | Needs a look |
| `--k-info` | `#4a6d89` | `#97bddb` | Neutral notice |
| `--k-danger` | `#9a5143` | `#f19f8f` | Broken, removed |
| `--k-shadow` | `0 1px 2px rgba(0,0,0,.05),0 12px 32px rgba(0,0,0,.09)` | `0 1px 2px rgba(0,0,0,.3),0 16px 40px rgba(0,0,0,.45)` | Floating things only |

Graph tag colours are tokens too, ten slots plus `--tg-none`. Light: `#b05459 #5b8230 #307baf #9c5a8d #7f7800 #0f848a #8a639a #a66218 #338756 #7567b1`, none `#9b9b99`. Dark: `#ea9799 #9bbe7b #76b9ec #da99c9 #bab567 #56c4ca #c99fda #dfa26d #7cc495 #b1a6ec`, none `#878783`. Which tag gets which slot comes from config.

Type: `--k-serif` Newsreader, `--k-sans` Instrument Sans, `--k-mono` JetBrains Mono, with Georgia, system-ui and ui-monospace behind them. Sizes 12, 13, 15, 19 (reading), 23, 27, 36, 46, 64 px. Leading 1.1 headings, 1.5 UI, 1.6 reading. Space steps 4 to 64 px, radius 4, 6, 8 px, measure 680 px.
