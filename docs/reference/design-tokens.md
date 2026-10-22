---
type: Reference
title: Design tokens
description: The token file the app is painted from, every colour of the light and the dark set, the graph's tag slots, type, space and motion, the contrast each pair holds, how light and dark are chosen and kept, and the fonts and their licenses.
resource: frontend/src/styles/kasten-theme.css
tags: [frontend, design]
status: stable
---

# Design tokens

Every colour, face, size and duration kasten draws with is a CSS custom property
in one file, `frontend/src/styles/kasten-theme.css`. The file is plain CSS, with
no Tailwind in it, so a page outside the app can read it as it stands. The light
set sits on `:root` and the dark set on `[data-theme="dark"]`; everything that
is not a colour sits on `:root` alone.

`app.css` imports the file and hands the colours to Tailwind as `k-*` and
`tg-*`, so `bg-k-paper` or `text-k-muted` in a component is the token itself.
The editor's CodeMirror theme (`lib/editor-theme.ts`) and the live preview's
styles name the tokens with `var()`, and follow a switch on their own. The
graph and the terminal draw on a canvas, which cannot read a variable, so they
read the tokens' values and read them again on every switch.

No component carries a hex colour of its own; `tests/theme-leftovers.test.ts`
fails on one. It exempts the token file, `lists.css` (the shared lists app,
which keeps its own palette until #810) and the white page `book-backing.ts`
puts behind a book's images.

## Colours

Backgrounds stay plain neutral. Colour shows only in accents, links,
highlights, tags and the graph.

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

The accent is Vandar Poel's blue (Sanzo Wada, *A Dictionary of Color
Combinations*, No. 296 and No. 151). The light highlight is Yellow Orange
`#f99d1b` at 22 %, the dark one Pale King's Blue `#a7d4e4` at 18 % (No. 167).

## Graph tag slots

Ten slots and `--tg-none`, which the graph colours a note's type with.

| Slot | Light | Dark |
|---|---|---|
| `--tg-1` | `#b05459` | `#ea9799` |
| `--tg-2` | `#5b8230` | `#9bbe7b` |
| `--tg-3` | `#307baf` | `#76b9ec` |
| `--tg-4` | `#9c5a8d` | `#da99c9` |
| `--tg-5` | `#7f7800` | `#bab567` |
| `--tg-6` | `#0f848a` | `#56c4ca` |
| `--tg-7` | `#8a639a` | `#c99fda` |
| `--tg-8` | `#a66218` | `#dfa26d` |
| `--tg-9` | `#338756` | `#7cc495` |
| `--tg-10` | `#7567b1` | `#b1a6ec` |
| `--tg-none` | `#9b9b99` | `#878783` |

[Panes and tabs](/reference/editor-keys/panes-and-tabs.md) lists which type
takes which slot.

## Contrast

WCAG 2 ratios, alpha colours blended over paper. `tests/theme-contrast.test.ts`
computes every pair from the token file and holds text at 4.5 or over and tag
dots at 3 or over.

| Pair | Light | Dark |
|---|---|---|
| ink on paper | 16.47 | 14.07 |
| muted on surface | 4.82 | 5.51 |
| link on paper | 5.33 | 8.2 |
| accent on surface | 4.62 | 7.4 |
| accent on its wash | 4.61 | 6.31 |
| status colours on paper, lowest | 5.06 | 8.37 |
| tag colours on bg, lowest | 4.09 | 8.23 |
| ink on highlight | 14.02 | 9.25 |
| link on highlight | 4.53 | 5.39 |
| muted on highlight | 4.74 | 4.01 |

Muted text on the dark highlight is the one pair under 4.5. It only happens
where grey meta text sits inside a mark; the test names it as the exception.

## Type, space and shape

| Token | Value |
|---|---|
| `--k-serif` | Newsreader, then Georgia |
| `--k-sans` | Instrument Sans, then system-ui |
| `--k-mono` | JetBrains Mono, then ui-monospace |
| `--k-text-12` … `--k-text-64` | 12, 13, 15, 19 (reading), 23, 27, 36, 46, 64 px |
| `--k-leading-heading`, `--k-leading-ui`, `--k-leading-reading` | 1.1, 1.5, 1.6 |
| `--k-leading-display`, `--k-track-display` | 1.04, -0.018 em (the 46 and 64 px sizes) |
| `--k-track-title`, `--k-track-heading`, `--k-track-body`, `--k-track-label`, `--k-track-kbd` | -0.017, -0.016, 0, +0.006, +0.02 em |
| `--k-space-4` … `--k-space-64` | 4, 8, 12, 16, 24, 32, 48, 64 px |
| `--k-radius-4`, `--k-radius-6`, `--k-radius-8` | 4, 6, 8 px |
| `--k-measure` | 680 px |

Each size also has a class, `text-k-12` to `text-k-64`, which carries its own
leading and tracking, so a component names one class. The 46 and 64 px sizes
take the display pair, the 36 and 27 px sizes the title pair, the 23 px size the
heading pair, the 19 px size the reading leading, and the 12, 13 and 15 px sizes
the UI leading and label tracking. `tracking-k-kbd` and `tracking-k-label` set
the tracking alone.

## Motion

The values of #798, which builds the press feedback, the spring helper and the
sheet on them.

| Token | Value | Use |
|---|---|---|
| `--k-press-scale` | 0.97 | A button held down |
| `--k-press-in`, `--k-press-out` | 100 ms, 160 ms | Into the press and back |
| `--k-hover` | 150 ms | Hover |
| `--k-ease-out` | `cubic-bezier(0.23, 1, 0.32, 1)` | Press and hover |
| `--k-spring-response`, `--k-spring-damping` | 0.32 s, 1 | Default spring |
| `--k-spring-flick-damping` | 0.8 | Only after a flick |
| `--k-spring-sheet-open`, `--k-spring-sheet-close` | 0.35 s, 0.3 s | Sheet open, close and spring back |
| `--k-spring-tab`, `--k-spring-split`, `--k-spring-card` | 0.32 s, 0.34 s, 0.26 s | Tab underline, split pane enter, card fly-off |
| `--k-stagger`, `--k-stagger-cap` | 22 ms, 6 | List entrance, never past the sixth item |
| `--k-theme-fade` | 240 ms | The cross-fade between light and dark |

A press marks the control under the pointer with `data-pressed`, which
`lib/press.ts` sets and clears, and `app.css` gives a marked control the press
scale. A row with the `k-row` class tints instead, because a full-width row
scaled down looks broken. `k-enter` brings a list's rows in one after another,
by their `--i` index, and stops the delay at the sixth row.

`k-glass` is the only see-through surface: the tab strip, drawn at 84 % of
`--k-bg` over an 18 px blur, with one `k-hairline` under it. Sheets, panels and
cards stay solid.

Three media queries take the extras away. `prefers-reduced-motion` drops the
press scale and the entrance. `prefers-reduced-transparency` makes the glass
solid and drops its blur. `prefers-contrast: more` does both, and draws the
hairline in `--k-ink`.

## Light and dark

`Toggle light and dark mode` in [the command palette](/reference/editor-keys/leader.md#the-command-palette)
switches the theme and keeps the choice in `localStorage` as `kasten.theme`
(`light` or `dark`), per device. With no choice made, the system's
`prefers-color-scheme` decides, and a change of it follows at once. A switch in
one tab reaches every other open tab. A browser that refuses storage still
switches, for as long as the page is open.

The switch cross-fades through a view transition, and lands at once under
`prefers-reduced-motion`. `public/theme.js` sets `data-theme` on `<html>`
before the first paint, so a page never flashes the other theme while it loads,
and the browser bar's `theme-color` follows `--k-bg` on every switch.

## Fonts

All three are served from kasten itself, out of the `@fontsource-variable`
packages: the policy allows fonts from kasten's own origin only
(`font-src 'self'`), the app works offline as an installed app, and no font
host learns when a note is opened.

| Face | Package | License |
|---|---|---|
| Newsreader | `@fontsource-variable/newsreader` | SIL Open Font License 1.1 |
| Instrument Sans | `@fontsource-variable/instrument-sans` | SIL Open Font License 1.1 |
| JetBrains Mono | `@fontsource-variable/jetbrains-mono` | SIL Open Font License 1.1 |
