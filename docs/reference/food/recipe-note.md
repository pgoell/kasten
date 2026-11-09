---
type: Reference
title: Recipe note
description: The note a dish is written in, its frontmatter, the ingredient and step sections, how a German ingredient line is read for its amount and unit, how a line finds its food, the kcal and macros per serving, the card that shows them, and why a line is not counted.
resource: backend/tests/food/ingredient_cases.json
tags: [vault, recipes, food, format, backend]
status: stable
---

# Recipe note

One note per dish. kasten reads the ingredient lines, matches each to a food,
and works out kcal, protein, carbs and fat per serving. The note is the record:
nothing about a recipe lives anywhere else, and every number is worked out
again from its lines each time. `POST /api/recipe/nutrition` does the work; see
[HTTP API: food](/reference/http-api/food.md#post-apirecipenutrition).

```markdown
---
type: Recipe
servings: 4
time: 45 min
source: https://www.chefkoch.de/rezepte/…
tags: [prep, friert-ein, vegetarisch]
---
# Chili sin carne

## Zutaten
- 500 g Kidneybohnen, abgetropft
- 2 Zwiebeln
- 2 Dosen Tomaten (je 400 g), gehackt
- 2 EL Olivenöl
- 1 TL Kreuzkümmel 🏷 4337256380081
- Salz, nach Belieben

### Zum Servieren
- 150 g Schmand

## Schritte
1. Zwiebeln würfeln und im Öl glasig braten.
2. Bohnen und Tomaten dazu, 30 Minuten köcheln.
```

## Where a recipe sits

Any note whose frontmatter says `type: Recipe`, in any case, is a recipe. The
folder is yours to choose; a recipes folder per dish is the plan. A note
without that line shows no card, whatever its sections hold.

## The frontmatter

The fields are named after schema.org's `Recipe`. Each is optional.

| Field | Holds |
| --- | --- |
| `servings` | how many servings the lines make, a number above zero and under 1000; a comma counts as a point |
| `time` | the time it takes, as text, such as `45 min` |
| `source` | the URL the recipe came from |
| `tags` | tags such as `prep`, `friert-ein`, `schnell`, `vegetarisch`, in any of the three spellings [the tag format](/reference/tag-format.md) reads |

Without `servings`, the numbers are for the whole recipe and the card says so.

## The sections

1. `## Zutaten` (or `## Ingredients`) holds the ingredient lines, up to the
   next `# ` or `## ` heading. A `### ` heading inside it names a group, such
   as `### Sauce`, for the lines under it.
2. An ingredient line is a bullet at the start of the line: `- `, `* ` or `+ `,
   then the text. A todo box, `- [ ] ` or `- [x] `, is passed over, so a ticked
   line still counts.
3. `## Schritte` (or `## Zubereitung`, `## Steps`) holds the steps, one numbered
   line each: `1. ` or `1) `.
4. Headings read in any case. A line inside a fenced code block is neither an
   ingredient nor a step, and the frontmatter is no section.

The raw line stays the truth. kasten reads it and never rewrites it.

## Reading a line

A line is read from the left, in this order:

1. A barcode pinned anywhere with `🏷`, such as `🏷 4337256380081`, is taken out
   first. It names the food; see [Finding the food](#finding-the-food).
2. The amount: a number (`500`, `1,5`, `0.5`), a fraction (`1/2`, `½`), or a
   whole number and a fraction (`1 1/2`, `1½`). `ein`, `eine`, `einen`, `einer`
   are 1, `zwei` 2 and `drei` 3. A range, `2-3` or `2 bis 3`, counts its lower
   end.
3. `etwas`, `wenig`, `ein wenig`, `n. B.`, `nach Belieben` or `nach Geschmack`
   in place of an amount means the line has none.
4. The unit, after an amount, in any case, with an optional point:

   | Unit | Spellings | Grams per one |
   | --- | --- | --- |
   | g | `g`, `gr`, `Gramm` | 1 |
   | kg | `kg`, `Kilo`, `Kilogramm` | 1000 |
   | mg | `mg` | 0.001 |
   | ml | `ml`, `Milliliter` | 1 |
   | cl | `cl` | 10 |
   | dl | `dl` | 100 |
   | l | `l`, `Liter` | 1000 |
   | EL | `EL`, `Essl.`, `Esslöffel` | 15 |
   | TL | `TL`, `Teel.`, `Teelöffel` | 5 |
   | Prise | `Prise`, `Prisen`, `Prise(n)` | 0.5 |
   | Msp | `Msp.`, `Messerspitze` | 0.25 |
   | Stück, Dose, Packung, Bund, Zehe, Scheibe, Becher, Glas, Tasse, Handvoll | with their plurals, `Stk.`, `St.`, `Pck.`, `Pkg.`, `Päckchen`, `Dose(n)`, `Zehe(n)`, `Scheibe(n)` | a count: see below |

   A millilitre counts as a gram. A spoon is a level spoon of something about
   as dense as water, so oil and flour are a little off; write grams where it
   matters.
5. The food: the words up to the first comma, without anything in brackets.
6. The note: whatever follows the first comma, such as `abgetropft`.

A count unit, or an amount with no unit (`2 Zwiebeln`), weighs one serving of
the matched food per piece. A weight in brackets says what one weighs and wins
over the serving: `1 Dose Mais (285 g)`, `2 Dosen Tomaten (je 400 g)`,
`(ca. 400 g)`.

Every case the parser is tested against is a row of
`backend/tests/food/ingredient_cases.json`. A change to these rules is a change
to that table first.

## Finding the food

A line with a `🏷` barcode looks it up in
[the foods note](/reference/food/log-format.md#the-foods-note) first, then on
Open Food Facts, as a scanned barcode is. A line without one looks for a food of
your own by name:

1. The food words, in any case, against each name in `foods.md`.
2. The same with a plural or case ending taken off both sides (`en`, `n`, `e`,
   `s`), so `Zwiebeln` finds `Zwiebel` and `Tomaten` finds `Tomate`.
3. The same again without the first word, then without the first two, and so
   on, so `rote Paprika` finds `Paprika`.

The first food of that name in the note wins. A line never searches Open Food
Facts by its words: a search answers twenty products and only a person can pick
the right one. Pin the barcode, or add the food to `foods.md`, and the line
counts. No model guesses a number.

A food of your own weighs its serving when its line names one, as
`- Zwiebel: 80 g, 🔥 40 …`. An Open Food Facts product weighs the serving it
gives, and none when it gives none.

## The numbers

A counted line adds its food's figures per 100 g times its grams over 100. The
total sums the counted lines, each field over the lines that give it, and per
serving is the total over `servings`. Each is rounded to a tenth once, after the
sum.

## Why a line is not counted

Every line shows, counted or not, and one that adds nothing says why:

| Status | When | The card says |
| --- | --- | --- |
| `no_amount` | the line gives no amount: `Salz`, `etwas Mehl` | `no amount, not counted` |
| `no_match` | no food of yours has the name, or Open Food Facts has no product with the pinned barcode | `no food matches: add it to foods.md or pin a 🏷 barcode` |
| `no_weight` | a count with no bracketed weight, and the food names no serving | `no weight for one: add a serving in foods.md or (400 g) to the line` |
| `unreached` | Open Food Facts refused or did not answer for the pinned barcode, or kasten's limit of 15 reads a minute was used up | `Open Food Facts did not answer; try again in a minute` |

## The card

A recipe note in live preview shows a card under its title. From the top:

* the kcal, protein, carbs and fat per serving, or for the whole recipe without
  `servings`;
* a stepper, `−` and `+`, with the servings it shows. It scales each amount and
  each line's kcal in the card, and the note keeps its own number. Off the
  note's number, it says `the note says 4`;
* the ingredient lines in order, under their group, each as written with its
  quantity scaled and any `🏷` barcode left out, and its kcal or why it is not
  counted. A line matched to a food
  of another name shows that name on hover;
* `N of M lines counted`.

The card sends the open text 0.6 s after typing pauses, so the numbers follow
an edit before it is saved. An answer that a later request overtook is dropped.
A failed request is named in the card. `frontend/src/lib/log/recipe-card.ts`
draws it.
