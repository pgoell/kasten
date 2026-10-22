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
- Russet, peach and pansy: the rule that keeps status off the accent's hue leaves no red or amber in the pool. Danger is olive and warn is blue on these palettes. They are distinct from the accent, but they do not read as danger or warn. Check them by eye.

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
| Lowest status on paper | 5.06 | 8.37 | 5.00 | 8.01 | 5.00 | 8.01 | 5.01 | 8.01 |
| Lowest tag on bg | 4.09 (under 4.5) | 8.23 | 4.50 | 8.00 | 4.50 | 8.00 | 4.50 | 8.00 |
| Highest chroma of status and tags | 0.120 | 0.126 | 0.120 | 0.100 | 0.120 | 0.100 | 0.120 | 0.100 |

| Palette | Slot | Wada colour | Light | Dark |
|---|---|---|---|---|
| russet | --k-danger | Blackish Olive | #7a6b53 | #beae94 |
| russet | --k-warn | Cream Yellow | #0075a0 | #68bae3 |
| russet | --k-ok | Blue Violet | #2e7b3f | #81be89 |
| russet | --k-info | Citron Yellow | #a4517a | #e59abc |
| russet | --tg-1 | Light Brown Drab | #836d59 | #bfa791 |
| russet | --tg-2 | Deep Lyons Blue | #ab5c2d | #e19b75 |
| russet | --tg-3 | Olive Buff | #90647b | #cd9eb5 |
| russet | --tg-4 | Pale King's Blue | #6f6e90 | #a8a8cc |
| russet | --tg-5 | Lemon Yellow | #9d5995 | #d498cb |
| russet | --tg-6 | Green Blue | #007c94 | #55b8d1 |
| russet | --tg-7 | Light Mauve | #187b96 | #5fb7d3 |
| russet | --tg-8 | Golden Yellow | #007e7d | #4dbbb9 |
| russet | --tg-9 | Dull Violet Black | #487c51 | #81b889 |
| russet | --tg-10 | Dull Viridian Green | #308045 | #7aba86 |
| peach | --k-danger | Cossack Green | #826a1b | #c7ae63 |
| peach | --k-warn | Cream Yellow | #0075a0 | #68bae3 |
| peach | --k-ok | Burnt Sienna | #407933 | #8cbd81 |
| peach | --k-info | Helvetia Blue | #a15478 | #e69abb |
| peach | --tg-1 | Pompeian Red | #a75f1f | #dd9d6e |
| peach | --tg-2 | Night Green | #aa5d29 | #e09c72 |
| peach | --tg-3 | Citron Yellow | #a8557e | #e095b7 |
| peach | --tg-4 | Cotinga Purple | #6d69b1 | #a6a5e9 |
| peach | --tg-5 | Olive | #965e8f | #d498cb |
| peach | --tg-6 | Green Blue | #007c94 | #55b8d1 |
| peach | --tg-7 | Light Mauve | #187b96 | #5fb7d3 |
| peach | --tg-8 | Golden Yellow | #007e7d | #4dbbb9 |
| peach | --tg-9 | Brown | #4e7c4b | #87b782 |
| peach | --tg-10 | Blue Violet | #337f43 | #7cb984 |
| pansy | --k-danger | Peach Red | #6c7200 | #afb66a |
| pansy | --k-warn | Cinnamon Buff | #007698 | #61bbde |
| pansy | --k-ok | Sudan Brown | #5f743c | #a1b87d |
| pansy | --k-info | Pale Lemon Yellow | #786399 | #bca6e0 |
| pansy | --tg-1 | Pompeian Red | #a75f1f | #dd9d6e |
| pansy | --tg-2 | Deep Indigo | #8f694e | #cca387 |
| pansy | --tg-3 | Naples Yellow | #7668a4 | #afa3e2 |
| pansy | --tg-4 | Olive Ocher | #7466b4 | #ada3e8 |
| pansy | --tg-5 | Ivory Buff | #5f709a | #97abd8 |
| pansy | --tg-6 | Light Mauve | #187b96 | #5fb7d3 |
| pansy | --tg-7 | Calamine BLue | #257b8c | #66b7c7 |
| pansy | --tg-8 | Golden Yellow | #007e7d | #4dbbb9 |
| pansy | --tg-9 | Dark Soft Violet | #61793d | #99b475 |
| pansy | --tg-10 | Violet | #457e3f | #83b87e |
<!-- palettes:end -->

## Credit

The Wada colour data comes from [github.com/mattdesl/dictionary-of-colour-combinations](https://github.com/mattdesl/dictionary-of-colour-combinations), under the MIT licence, Copyright (c) 2020 Matt DesLauriers. The licence text is in the header of `frontend/scripts/wada.ts`.
