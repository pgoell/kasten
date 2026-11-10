---
type: Reference
title: Recipe note
description: The note a dish is written in, its frontmatter, the ingredient, step and cooked sections, how a German ingredient line is read for its amount and unit, how a line finds its food, the kcal and macros per serving, the card that shows them, cook mode, the rating sheet, and why a line is not counted.
resource: backend/tests/food/recipes/ingredient_cases.json
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

## Gekocht
- 2026-10-27 gern wieder · mehr Chili, Reis war zu weich
- 2026-10-02 geht so
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
4. `## Gekocht` (or `## Cooked`) holds one line per time the dish was cooked;
   see [The meals cooked](#the-meals-cooked).
5. Headings read in any case. A line inside a fenced code block is neither an
   ingredient nor a step, and the frontmatter is no section.

The raw line stays the truth. kasten reads it and never rewrites it.

## The meals cooked

Each line under `## Gekocht` is a bullet, the day as `YYYY-MM-DD`, then
optionally the answer to "wieder kochen?" and a note after a `·`:

```markdown
- 2026-11-09 gern wieder · mehr Würze, Beilage anders
- 2026-10-27 geht so
- 2026-10-02 · mit Limette
```

1. The answer is `lieber nicht`, `geht so` or `gern wieder`, in any case, right
   after the day. Any other words there are the note.
2. The note is whatever follows, its leading `·` taken off.
3. A line with no day, or a day that does not exist such as `2026-02-30`, is
   passed over.

The card and cook mode read these lines. The rating sheet writes them; see
[The rating sheet](#the-rating-sheet).

## Importing a recipe

**Save as recipe** on the capture page, or
[POST /api/recipes/import](/reference/http-api/food.md#post-apirecipesimport),
writes a recipe note from a recipe page or a pasted caption:

* A page's schema.org `Recipe` data is read with recipe-scrapers. Most German
  recipe sites carry it.
* A caption goes to Claude in the shell first, which answers schema.org JSON
  ([Chat runner](/reference/chat-runner.md#reading-a-recipe)); that JSON is
  then read the same way.
* The note gets `type: Recipe`, `servings`, `time` in minutes and `source`
  where known, the title as its heading, the ingredient lines under
  `## Zutaten`, a `### ` heading for each group the page names, and the steps
  under `## Schritte`.
* Entities such as `&amp;` are decoded, `800.0 g` is written `800 g`, and a step
  that only says `Schritt 1` is left out. Every other line stays as the page
  wrote it.

## Reading a line

A line is read from the left, in this order:

1. A barcode pinned anywhere with `🏷`, such as `🏷 4337256380081`, is taken out
   first. It names the food; see [Finding the food](#finding-the-food).
2. The amount: a number (`500`, `1,5`, `0.5`), a fraction (`1/2`, `½`), or a
   whole number and a fraction (`1 1/2`, `1½`). `ein`, `eine`, `einen`, `einer`
   are 1, `zwei` 2 and `drei` 3. A range, `2-3` or `2 bis 3`, counts its lower
   end, and the card keeps both.
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
`backend/tests/food/recipes/ingredient_cases.json`. A change to these rules is a change
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

* a line of facts: the newest answer from
  `## Gekocht`, how often the dish was cooked and how long ago it was last,
  `time`, and the site `source` names, as
  `gern wieder · cooked 6×, last 12 days ago · 70 min · chefkoch.de`. A fact
  the note does not give is left out;
* the kcal, protein, carbs and fat per serving, or for the whole recipe without
  `servings`;
* a stepper, `−` and `+`, with the servings it shows. It scales each amount and
  each line's kcal in the card, and the note keeps its own number. Off the
  note's number, it says `the note says 4`;
* the ingredient lines in order, under their group, each with its kcal or why it
  is not counted. At the note's servings a line shows as written, any `🏷`
  barcode left out. Stepped, it shows the scaled number, both ends of a range
  scaled, then the rest of the line: `2-3 Zwiebeln` at 1.5 times is
  `3-4.5 Zwiebeln`, and `½ TL` at 2 times is `1 TL`. A line matched to a food
  of another name shows that name on hover;
* `N of M lines counted`;
* under `Last cooked`, the three newest lines of `## Gekocht`, as
  `27 Oct · gern wieder · mehr Chili`;
* `Cook`, which opens cook mode at the servings the stepper shows. With no
  steps it is greyed out.

The card sends the open text 0.6 s after typing pauses, so the numbers follow
an edit before it is saved. An answer that a later request overtook is dropped.
A failed request is named in the card. `frontend/src/lib/log/recipe/recipe-card.ts`
draws it.

## Cook mode

Cook mode covers the whole window in the dark theme and shows one step at a
time. `frontend/src/lib/log/recipe/cook-mode.ts` draws it.

* The screen stays on: cook mode holds a screen wake lock while it is open, and
  takes it again when you come back to the tab. The top right says
  `Screen stays on`, or `The screen may turn off` where the browser refuses,
  as it may on low battery.
* A bar of one segment per step shows how far you are, over
  `Chili sin carne · Step 3 of 6` and the step in large serif type.
* Under `For this step · 6 servings`, the ingredients the step names, scaled to
  the servings. A step names an ingredient when one of its capitalised words
  is a word of the food or its last part after at least three letters, with a
  plural ending taken off both: `Bohnen` finds `Kidneybohnen`, `Öl` finds
  `Olivenöl`, `Zwiebeln` finds `Zwiebel`, and `Ei` does not find `Reis`.
* A step that names a time gets a timer button, `Start 8:00 timer`. The first
  time in the step counts: `8 Minuten`, `30 Min.`, `1,5 Stunden`, `2 Std.`,
  `45 Sekunden`, and for a range such as `10-12 Minuten` its lower end. A press
  pauses and resumes it. One timer runs at a time, so starting another replaces
  it. Away from its step, a chip at the top shows the time
  left and leads back. At zero the phone vibrates and a tone plays.
* `Last time:` and the newest note from `## Gekocht`.
* `Back` and `Next step`, 64px high; on the last step `Next step` reads `Done`
  and closes. The arrow keys move too, and Escape closes; see
  [Editor keys](/reference/editor-keys.md#cook-mode).

## The rating sheet

The food sheet lists your recipes first, under `Recipes`, by title, with their
kcal per serving. A recipe with no `servings` counts the whole dish as one.
Picking one opens the serving step, where you set how many servings you ate;
`Log this food` writes the food line at the recipe's numbers per serving, as
`- 🍽 lunch: Chili sin carne 🔥 540 kcal 🥩 32 g 🍞 62 g 🧈 14 g`. The list comes
from [GET /api/recipes](/reference/http-api/food.md#get-apirecipes); when it
cannot be read, the sheet lists no recipes and the foods still work.

Once the line is in, the rating sheet rises and asks `<title>, cook again?`:

* three faces, `Lieber nicht`, `Geht so` and `Gern wieder`; `Done` waits for one;
* chips for what to change, `mehr Würze`, `weniger Salz`, `zu trocken`,
  `Beilage anders` and `größere Portion`, and `+ own note` for words of your
  own;
* `Done` writes the line at the end of the recipe's `## Gekocht`, making the
  section at the end of the note when there is none:
  `- 2026-11-09 gern wieder · mehr Würze, Beilage anders`, dated by the daily
  note the meal went on. It reads the note
  from the vault first and writes only over what it read. A write that fails
  says why in the sheet and leaves it open.

`Later`, Escape or a tap beside the sheet skips it. A rating skipped before
19:00 comes back once at 19:00 if kasten is still open, or on the first note
opened after 19:00 that day. One skipped after 19:00 comes back on the next note
opened that evening. The second showing says so, and skipping it drops the
rating. A rating not given by the end of the day is dropped. The waiting rating
lives in the browser, so another device does not see it.
`frontend/src/lib/log/recipe/rate-sheet.ts` draws it.
