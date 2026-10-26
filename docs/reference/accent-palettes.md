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

Russet, peach and pansy draw their status and tag colours from Wada's colours (Sanzo Wada, *A Dictionary of Color Combinations*). The generator in `frontend/scripts/palette-picks.ts` does this:

1. It finds the Wada colours in a combination with the palette's number. These are the direct neighbours.
2. It finds every colour in a combination with a neighbour's combination. This is the pool. It drops the palette's own colour (Hay's Russet, Peach Red or Pansy Purple), any grey with chroma under 0.04, and any colour within 20 degrees of the accent's hue, so no status or tag reads as the accent.
3. It picks one colour per slot, in this order: `--k-danger`, `--k-warn`, `--k-ok`, `--k-info`, then `--tg-1` to `--tg-10`. Each slot takes the unused colour nearest in hue to poel's value for that slot, among those at least 20 degrees in light hue from every colour already picked for the palette. Only when none is left at 20 degrees does the fallback run. It takes a colour at least 20 degrees from every status colour if one is left, and otherwise the colour farthest from the earlier picks. The picks table marks that slot `(fallback)`. A tie goes to the higher chroma, then to the name. Light and dark use the same colour, so each slot keeps its meaning across palettes. `--k-warn` takes only colours at least 60 degrees in light hue from the accent (#1001). The pick fits accent and warn to nearly the same contrast on paper, and caps chroma, so hue is the one axis left to tell them apart; 60 degrees is a sixth of the wheel, the step from red to yellow. Without it, russet and peach took Cream Yellow, an ochre about 40 degrees from their red accents.
4. It sets each pick's lightness so the colour reaches its target on its ground. Status sits on paper, tags on the page background. The target is 5 for status and 4.5 for tags in light, and 8 for both in dark. Danger has its own target: 9 in light and 5.5 in dark. Each sits darker than the accent, so danger still reads apart from it when a red palette leaves no hue room. In dark, the lowest status on paper is therefore danger, at 5.5. Chroma is capped at 0.12 in light and 0.10 in dark. A colour outside sRGB loses chroma, and keeps its lightness and hue, so nothing clips to pure red.

The picks are in the table below.

## Running the generator

From `frontend/`:

```sh
bun scripts/palettes.ts
```

It prints the CSS for the region between the `palettes:begin` and `palettes:end` comments in `kasten-theme.css`. Then it prints the tables on this page. Paste each one between its markers. `frontend/tests/palette-generator.test.ts` fails when either file drifts from the generator.

## Bars and measures

The bars are these. Light accent on paper, 5. Light accent on surface, 4.6. Dark accent on paper, 6. Every other text pair, 4.5 (AA). Status and tags of the three new palettes stay under their chroma caps. The measures are WCAG ratios, with each alpha colour blended over its backdrop, as `frontend/tests/theme-contrast.test.ts` does. A cell under its bar shows the number and the bar. A chroma over its cap shows the number and the cap. The warn hue gap row gives the degrees between warn and the accent of the same palette and theme; a gap under 60 shows `(under 60)`. Warn meets 60 in every palette. The danger hue gap row gives the same for danger, with no bar. Danger misses 60 in russet, peach and pansy, so the lightness row gives the gap in OKLab lightness, and it shows `(under 0.08)` only where the hue gap also misses 60. The lowest of those gaps is 0.092, in dark russet and pansy.

The issue's values are kept where a bar misses, and the tests name each miss:

- Poel, light: the lowest tag is 4.09 on the background. This is the value 0.83.0 already paints.
- Poel, dark: muted text on the highlight is 3.98. This is the #777 exception.
- Russet, peach and pansy, dark: muted text on the highlight misses. Peach and pansy also miss with link text on the highlight. The dark highlights are the issue's values, so the fix is a choice for the issue, not a change made here.
- Russet, peach and pansy: the pool runs out for some slots, which take the fallback. The fallback slots are russet's `--tg-8`, `--tg-9` and `--tg-10`, peach's `--tg-10`, and pansy's `--tg-5` to `--tg-10`. Pansy's `--tg-10` sits 14.7 degrees from `--k-danger` in light, because no colour left was clear of every status colour. That pair stays, and the test names it. The hue columns of the picks table show every hue. The last table lists every pair of picks under 20 degrees apart in light hue, with the gap. Poel's own status and tag pairs under 20 degrees also stay, since poel keeps 0.83.0's values; the test names them.

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
| Lowest status on paper | 5.06 | 8.37 | 5.04 | 5.53 | 5.01 | 5.53 | 5.01 | 5.53 |
| Lowest tag on bg | 4.09 (under 4.5) | 8.23 | 4.50 | 8.00 | 4.50 | 8.00 | 4.50 | 8.01 |
| Highest chroma of status and tags | 0.120 | 0.126 | 0.119 | 0.100 | 0.120 | 0.099 | 0.120 | 0.100 |
| Warn hue gap to accent | 160.7 | 160.9 | 63.4 | 63.6 | 60.3 | 62.3 | 65.9 | 65.8 |
| Danger hue gap to accent | 157.3 | 157.0 | 22.2 | 22.0 | 21.5 | 21.0 | 29.8 | 30.8 |
| Danger lightness gap to accent | 0.004 | 0.021 | 0.109 | 0.092 | 0.114 | 0.094 | 0.111 | 0.092 |

| Palette | Slot | Poel hue | Wada colour | Wada hue | Light | Light hue | Dark | Dark hue |
|---|---|---:|---|---:|---|---:|---|---:|
| russet | --k-danger | 32 | Eosine Pink | 10 | #7d283c | 10 | #c97b87 | 10 |
| russet | --k-warn | 74 | Pyrite Yellow | 96 | #806b00 | 95 | #c3b064 | 96 |
| russet | --k-ok | 155 | Dull Viridian Green | 162 | #007c54 | 162 | #6ec099 | 162 |
| russet | --k-info | 243 | Blue | 248 | #2970ad | 248 | #7cb5eb | 248 |
| russet | --tg-1 | 18 | Eupatorium Purple | 348 | #a75683 | 347 | #de95bb | 347 |
| russet | --tg-2 | 131 | Blackish Olive | 140 | #647660 | 140 | #9db199 | 140 |
| russet | --tg-3 | 243 | Antwarp Blue | 225 | #177a9a | 226 | #5eb6d7 | 225 |
| russet | --tg-4 | 336 | Light Mauve | 316 | #8a6299 | 317 | #c69cd6 | 317 |
| russet | --tg-5 | 106 | Ecru | 75 | #816e55 | 74 | #bca88d | 75 |
| russet | --tg-6 | 201 | Green Blue | 200 | #007e83 | 200 | #4dbbc0 | 199 |
| russet | --tg-7 | 316 | Dull Violet Black | 293 | #7569a3 | 293 | #afa3e0 | 293 |
| russet | --tg-8 (fallback) | 62 | Ochraceous Salmon | 58 | #976640 | 58 | #d5a078 | 58 |
| russet | --tg-9 (fallback) | 155 | Dusky Madder Violet | 329 | #955e91 | 329 | #d298ce | 329 |
| russet | --tg-10 (fallback) | 291 | Benzol Green | 187 | #007f77 | 187 | #51bcb1 | 186 |
| peach | --k-danger | 32 | Corinthian Pink | 15 | #6d363c | 14 | #be8185 | 15 |
| peach | --k-warn | 74 | Sulpher Yellow | 97 | #766d48 | 96 | #b9b188 | 98 |
| peach | --k-ok | 155 | Cobalt Green | 155 | #407856 | 156 | #82bd96 | 155 |
| peach | --k-info | 243 | Helvetia Blue | 243 | #2672a6 | 243 | #74b7e9 | 242 |
| peach | --tg-1 | 18 | Laelia Pink | 354 | #966277 | 354 | #d49bb1 | 354 |
| peach | --tg-2 | 131 | Night Green | 131 | #557c2a | 131 | #93b673 | 131 |
| peach | --tg-3 | 243 | Deep Indigo | 263 | #5e7197 | 264 | #96acd4 | 262 |
| peach | --tg-4 | 336 | Aconite Violet | 326 | #955d98 | 325 | #d099d1 | 326 |
| peach | --tg-5 | 106 | Orange Citrine | 76 | #926927 | 76 | #cfa463 | 77 |
| peach | --tg-6 | 201 | Green Blue | 200 | #007e83 | 200 | #4dbbc0 | 199 |
| peach | --tg-7 | 316 | Dull Violet Black | 293 | #7569a3 | 293 | #afa3e0 | 293 |
| peach | --tg-8 | 62 | Sea Green | 178 | #00806d | 177 | #58bca7 | 178 |
| peach | --tg-9 | 155 | Pale King's Blue | 222 | #4d7786 | 223 | #86b2c1 | 221 |
| peach | --tg-10 (fallback) | 291 | Ochraceous Salmon | 58 | #976640 | 58 | #d5a078 | 58 |
| pansy | --k-danger | 32 | Peach Red | 36 | #7e2b15 | 36 | #c97e69 | 36 |
| pansy | --k-warn | 74 | Cinnamon Buff | 72 | #956212 | 72 | #d9a769 | 71 |
| pansy | --k-ok | 155 | Sea Green | 178 | #007b6a | 179 | #5dc1ac | 178 |
| pansy | --k-info | 243 | Olympic Blue | 254 | #486f9f | 254 | #89b3e6 | 254 |
| pansy | --tg-1 | 18 | Aconite Violet | 326 | #955d98 | 325 | #d099d1 | 326 |
| pansy | --tg-2 | 131 | Pale Lemon Yellow | 96 | #7f7132 | 97 | #baab6c | 96 |
| pansy | --tg-3 | 243 | Cerulian Blue | 210 | #007d8c | 209 | #50b9ca | 210 |
| pansy | --tg-4 | 336 | Violet | 291 | #7467b0 | 290 | #ada3e8 | 290 |
| pansy | --tg-5 (fallback) | 106 | Calamine BLue | 199 | #207d81 | 199 | #63b9bc | 198 |
| pansy | --tg-6 (fallback) | 201 | Light Mauve | 316 | #8a6299 | 317 | #c69cd6 | 317 |
| pansy | --tg-7 (fallback) | 316 | Dark Soft Violet | 286 | #6e6ba5 | 285 | #a7a5e4 | 285 |
| pansy | --tg-8 (fallback) | 62 | Olive Ocher | 93 | #886e00 | 92 | #c1aa5e | 93 |
| pansy | --tg-9 (fallback) | 155 | Naples Yellow | 93 | #836f2a | 93 | #beaa65 | 94 |
| pansy | --tg-10 (fallback) | 291 | Seashell Pink | 51 | #8d6955 | 50 | #caa38d | 51 |

| Palette | Pair under 20 degrees | Gap |
|---|---|---:|
| russet | --tg-1 and --tg-9 | 17.7 |
| russet | --tg-4 and --tg-9 | 12.9 |
| russet | --tg-5 and --tg-8 | 16.5 |
| russet | --tg-6 and --tg-10 | 12.6 |
| peach | --tg-5 and --tg-10 | 18.0 |
| pansy | --k-danger and --tg-10 | 14.7 |
| pansy | --tg-1 and --tg-6 | 8.6 |
| pansy | --tg-2 and --tg-8 | 4.5 |
| pansy | --tg-2 and --tg-9 | 4.0 |
| pansy | --tg-3 and --tg-5 | 10.1 |
| pansy | --tg-4 and --tg-7 | 5.0 |
| pansy | --tg-8 and --tg-9 | 0.5 |
<!-- palettes:end -->

## Credit

The Wada colour data comes from [github.com/mattdesl/dictionary-of-colour-combinations](https://github.com/mattdesl/dictionary-of-colour-combinations), under the MIT licence, Copyright (c) 2020 Matt DesLauriers. The licence text is in the header of `frontend/scripts/wada.ts`.
