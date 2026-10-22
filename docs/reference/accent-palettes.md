---
type: Reference
title: Accent palettes
description: The four accent palettes (poel, russet, peach and pansy), the tokens each one sets, how the generator draws the status and tag colours from Wada's combinations, and the contrast each one measures.
resource: frontend/scripts/palettes.ts
tags: [frontend, design]
status: stable
---

# Accent palettes

kasten has four accent palettes. A palette changes the accent, the link colour, the highlight and the status and tag colours. Poel is the blue the app has always had, and it is the default. Russet, peach and pansy are the other three.

A palette is the `data-palette` attribute on `<html>`. With no attribute, the page paints poel.

## What a palette sets

Each palette has two blocks in `frontend/src/styles/kasten-theme.css`: one for light, and one for dark, which also matches `[data-theme="dark"]`. Each block sets the same 19 names and no others:

- `--k-accent`, `--k-link`, `--k-accent-wash`, `--k-highlight` and `--k-mark`
- `--k-ok`, `--k-warn`, `--k-info` and `--k-danger`
- `--tg-1` to `--tg-10`

The grounds, the ink, the type and the space stay as they are. `--tg-none` stays too.

Poel's blocks copy the values that `:root` and the dark block already have, so poel is what 0.83.0 paints.

## The inputs

The accent and the highlight of each palette come from the issue (#778). They are inputs, and the generator never changes them. The link is the accent. The wash is the accent at 11 % in light and 14 % in dark. The mark is the highlight.

| Palette | Accent light | Accent dark | Highlight light | Highlight dark | Wada numbers |
|---|---|---|---|---|---|
| poel | `#316f90` | `#82b9d9` | `#f99d1b` 22 % | `#a7d4e4` 18 % | 296, 151 |
| russet | `#9a5143` | `#e59c8d` | `#62c6bf` 30 % | `#62c6bf` 24 % | 345 |
| peach | `#b93100` | `#fd8e70` | `#eeb480` 30 % | `#eeb480` 24 % | 303, 310 |
| pansy | `#a83f5d` | `#f48da5` | `#f9c1ce` 30 % | `#f9c1ce` 24 % | 273 |

## How the status and tag colours are picked

Russet, peach and pansy draw their status and tag colours from Wada's colours (Sanzo Wada, *A Dictionary of Color Combinations*). The generator in `frontend/scripts/palettes.ts` does this:

1. It finds the Wada colours in a combination with the palette's number. These are the direct neighbours.
2. It finds every colour in a combination with a neighbour's combination. This is the pool. It drops the palette's own colour (Hay's Russet, Peach Red or Pansy Purple), any grey with chroma under 0.04, and any colour within 20 degrees of the accent's hue, so no status or tag reads as the accent.
3. It picks one colour per slot, in this order: `--k-danger`, `--k-warn`, `--k-ok`, `--k-info`, then `--tg-1` to `--tg-10`. Each slot takes the unused colour nearest in hue to poel's value for that slot. A tie goes to the higher chroma, then to the name. Light and dark use the same colour, so each slot keeps its meaning across palettes.
4. It sets each pick's lightness so the colour reaches its target on its ground. Status sits on paper, tags on the page background. The target is 5 for status and 4.5 for tags in light, and 8 for both in dark. Chroma is capped at 0.12 in light and 0.10 in dark. A colour outside sRGB loses chroma, and keeps its lightness and hue, so nothing clips to pure red.

The picks are in the table below.

## Running the generator

From `frontend/`:

```sh
bun scripts/palettes.ts
```

It prints the CSS for the region between the `palettes:begin` and `palettes:end` comments in `kasten-theme.css`. Then it prints the tables on this page. Paste each one between its markers. `frontend/tests/palette-generator.test.ts` fails when either file drifts from the generator.

## Bars and measures

The bars are these. Light accent on paper, 5. Light accent on surface, 4.6. Dark accent on paper, 6. Every other text pair, 4.5 (AA). Status and tags of the three new palettes stay under their chroma caps. The measures are WCAG ratios, with each alpha colour blended over its backdrop, as `frontend/tests/theme-contrast.test.ts` does. A cell under its bar shows the number and the bar. A chroma over its cap shows the number and the cap.

The issue's values are kept where a bar misses, and the tests name each miss:

- Poel, light: the lowest tag is 4.09 on the background. This is the value 0.83.0 already paints.
- Poel, dark: muted text on the highlight is 3.98. This is the #777 exception.
- Russet, peach and pansy, dark: muted text on the highlight misses. Peach and pansy also miss with link text on the highlight. The dark highlights are the issue's values, so the fix is a choice for the issue, not a change made here.
- Russet, peach and pansy: a few slots take the nearest hue the pool leaves, so they sit off poel's hue for that slot. The widest gaps are pansy's `--tg-9` (poel 155, pick 210), pansy's `--tg-2` (131 against 96) and russet's `--tg-1` (18 against 348). The hue columns of the picks table show every gap.

<!-- palettes:begin -->
| Measure | poel light | poel dark | russet light | russet dark | peach light | peach dark | pansy light | pansy dark |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Accent on paper | 5.33 | 8.20 | 5.58 | 7.85 | 5.79 | 7.69 | 5.74 | 7.62 |
| Accent on surface | 4.62 | 7.40 | 4.84 | 7.09 | 5.02 | 6.95 | 4.97 | 6.89 |
| Link on paper | 5.33 | 8.20 | 5.58 | 7.85 | 5.79 | 7.69 | 5.74 | 7.62 |
| Accent on its wash | 4.60 | 6.30 | 4.80 | 6.09 | 4.88 | 6.02 | 4.89 | 5.96 |
| Ink on highlight | 14.04 | 9.19 | 13.53 | 8.53 | 13.98 | 8.20 | 14.64 | 7.70 |
| Link on highlight | 4.54 | 5.35 | 4.59 | 4.76 | 4.91 | 4.48 (under 4.5) | 5.10 | 4.17 (under 4.5) |
| Muted on highlight | 4.74 | 3.98 (under 4.5) | 4.57 | 3.70 (under 4.5) | 4.72 | 3.56 (under 4.5) | 4.94 | 3.34 (under 4.5) |
| Lowest status on paper | 5.06 | 8.37 | 5.03 | 8.01 | 5.00 | 8.00 | 5.01 | 8.00 |
| Lowest tag on bg | 4.09 (under 4.5) | 8.23 | 4.50 | 8.00 | 4.50 | 8.00 | 4.50 | 8.01 |
| Highest chroma of status and tags | 0.120 | 0.126 | 0.119 | 0.100 | 0.120 | 0.100 | 0.119 | 0.100 |

| Palette | Slot | Poel hue | Wada colour | Wada hue | Light | Light hue | Dark | Dark hue |
|---|---|---:|---|---:|---|---:|---|---:|
| russet | --k-danger | 32 | Eosine Pink | 10 | #aa5062 | 9 | #eb9aa6 | 10 |
| russet | --k-warn | 74 | Cream Yellow | 74 | #956200 | 74 | #d7a867 | 74 |
| russet | --k-ok | 155 | Dull Viridian Green | 162 | #007c54 | 162 | #6ec099 | 162 |
| russet | --k-info | 243 | Blue | 248 | #2970ad | 248 | #7cb5eb | 248 |
| russet | --tg-1 | 18 | Eupatorium Purple | 348 | #a75683 | 347 | #de95bb | 347 |
| russet | --tg-2 | 131 | Blackish Olive | 140 | #647660 | 140 | #9db199 | 140 |
| russet | --tg-3 | 243 | Olympic Blue | 254 | #4c73a4 | 255 | #84aee1 | 254 |
| russet | --tg-4 | 336 | Dusky Madder Violet | 329 | #955e91 | 329 | #d298ce | 329 |
| russet | --tg-5 | 106 | Lemon Yellow | 106 | #7a7300 | 105 | #b2ae61 | 106 |
| russet | --tg-6 | 201 | Green Blue | 200 | #007e83 | 200 | #4dbbc0 | 199 |
| russet | --tg-7 | 316 | Light Mauve | 316 | #8a6299 | 317 | #c69cd6 | 317 |
| russet | --tg-8 | 62 | Golden Yellow | 62 | #a46116 | 62 | #db9f6a | 62 |
| russet | --tg-9 | 155 | Chromium Green | 144 | #587957 | 144 | #90b58f | 144 |
| russet | --tg-10 | 291 | Blue Violet | 293 | #7765b3 | 293 | #afa2e7 | 292 |
| peach | --k-danger | 32 | Corinthian Pink | 15 | #975d61 | 15 | #e09fa3 | 15 |
| peach | --k-warn | 74 | Cream Yellow | 74 | #956200 | 74 | #d7a867 | 74 |
| peach | --k-ok | 155 | Cobalt Green | 155 | #407856 | 156 | #82bd96 | 155 |
| peach | --k-info | 243 | Helvetia Blue | 243 | #2672a6 | 243 | #74b7e9 | 242 |
| peach | --tg-1 | 18 | Eosine Pink | 10 | #af5465 | 10 | #e695a1 | 10 |
| peach | --tg-2 | 131 | Night Green | 131 | #557c2a | 131 | #93b673 | 131 |
| peach | --tg-3 | 243 | Vandar Poel's Blue | 234 | #397798 | 234 | #74b3d6 | 234 |
| peach | --tg-4 | 336 | Cotinga Purple | 336 | #9d5a8d | 336 | #d797c7 | 336 |
| peach | --tg-5 | 106 | Olive | 106 | #797325 | 105 | #b2ae61 | 106 |
| peach | --tg-6 | 201 | Green Blue | 200 | #007e83 | 200 | #4dbbc0 | 199 |
| peach | --tg-7 | 316 | Light Mauve | 316 | #8a6299 | 317 | #c69cd6 | 317 |
| peach | --tg-8 | 62 | Golden Yellow | 62 | #a46116 | 62 | #db9f6a | 62 |
| peach | --tg-9 | 155 | Cossack Green | 144 | #497d48 | 144 | #82b980 | 144 |
| peach | --tg-10 | 291 | Blue Violet | 293 | #7765b3 | 293 | #afa2e7 | 292 |
| pansy | --k-danger | 32 | Peach Red | 36 | #aa543c | 37 | #eb9d87 | 36 |
| pansy | --k-warn | 74 | Cinnamon Buff | 72 | #956212 | 72 | #d9a769 | 71 |
| pansy | --k-ok | 155 | Sea Green | 178 | #007b6a | 179 | #5dc1ac | 178 |
| pansy | --k-info | 243 | Olympic Blue | 254 | #486f9f | 254 | #89b3e6 | 254 |
| pansy | --tg-1 | 18 | Sudan Brown | 40 | #9e624e | 39 | #dc9c85 | 41 |
| pansy | --tg-2 | 131 | Pale Lemon Yellow | 96 | #7f7132 | 97 | #baab6c | 96 |
| pansy | --tg-3 | 243 | Salvia Blue | 256 | #5f728c | 256 | #97adc9 | 255 |
| pansy | --tg-4 | 336 | Aconite Violet | 326 | #955d98 | 325 | #d099d1 | 326 |
| pansy | --tg-5 | 106 | Naples Yellow | 93 | #836f2a | 93 | #beaa65 | 94 |
| pansy | --tg-6 | 201 | Calamine BLue | 199 | #207d81 | 199 | #63b9bc | 198 |
| pansy | --tg-7 | 316 | Light Mauve | 316 | #8a6299 | 317 | #c69cd6 | 317 |
| pansy | --tg-8 | 62 | Golden Yellow | 62 | #a46116 | 62 | #db9f6a | 62 |
| pansy | --tg-9 | 155 | Cerulian Blue | 210 | #007d8c | 209 | #50b9ca | 210 |
| pansy | --tg-10 | 291 | Violet | 291 | #7467b0 | 290 | #ada3e8 | 290 |
<!-- palettes:end -->

## Credit

The Wada colour data comes from [github.com/mattdesl/dictionary-of-colour-combinations](https://github.com/mattdesl/dictionary-of-colour-combinations), under the MIT licence, Copyright (c) 2020 Matt DesLauriers. The licence text is in the header of `frontend/scripts/wada.ts`.
