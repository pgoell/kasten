---
type: Reference
title: Week plan
description: The note a week's meals are planned in, the meal and training lines it holds, how a batch cooked once feeds later meals, the fridge warning, the card that draws the week as a grid with batches as bands, the protein on training days, and how the shopping button writes the cooked batches' ingredients into Einkauf.md.
resource: backend/src/kasten_backend/food/plan/__init__.py
tags: [vault, recipes, food, format, backend]
status: stable
---

# Week plan

One note per week, in the shared folder (`05 Shared/` by default), so two
people can plan it together. Each line names a day, a meal of that day, and
what is eaten. A dish cooked once in a batch feeds the meals after it, and
the card under the note's title draws the week as a grid with each batch as a
band down the days it covers. `POST /api/meal-plan` does the work; see
[HTTP API: food](/reference/http-api/food.md#post-apimeal-plan).

```markdown
---
type: Meal Plan
week: 2026-W46
---
# Woche 46

- Mo 🏋
- Mo lunch: from [[Chili sin carne]]
- Mo dinner: cook [[Linsen-Dal]] x4 👤 [[Alicia]]
- Di dinner: from [[Linsen-Dal]]
- Mi lunch: from [[Linsen-Dal]]
- Do lunch: Kantine
- Do dinner: cook [[Hähnchen-Bowls]] x5 👤 [[Pascal]]
- Fr lunch: from [[Hähnchen-Bowls]]
- Sa lunch: from [[Hähnchen-Bowls]]
```

## Frontmatter

| Field | Meaning |
|---|---|
| `type` | `Meal Plan`, in any case. The card shows on no other note. |
| `week` | The ISO week, `2026-W46`. It gives the days their dates, which the training days need. Without it the grid has days but no dates. |
| `fridge` | Days a batch keeps before a meal warns, 2 when absent. |

## Meal lines

A meal line is a bullet, then a day, a meal and a colon:
`- Mo dinner: cook [[Linsen-Dal]] x4`.

* The day is `Mo`, `Di`, `Mi`, `Do`, `Fr`, `Sa` or `So`, in any case. A full
  name such as `Mittwoch` reads too.
* The meal is `lunch` or `dinner`, or `Mittag` or `Abend`.
* `cook [[Recipe]] xN` cooks N servings once, the cook's own meal among them.
  `×4` reads as `x4`, and `kochen` as `cook`. With no `xN` the batch has no
  count, and its band says how many meals it feeds.
* `from [[Recipe]]` takes one serving from the latest batch of that recipe
  cooked before it in the week. `aus` reads as `from`. A `from` with no batch
  before it draws on one cooked the week before, and its band says so.
* `👤 [[Name]]`, or `👤 Name`, names the cook, as the shared lists do.
* Anything else after the colon, such as `Kantine` or `Essen gehen`, is a meal
  with no batch. It adds nothing to the shopping list.

A line that names no day and meal is passed over, so notes and headings can
sit between the meals. A link finds its recipe note as every wikilink does:
by name, anywhere in the vault.

## Training days

`- Mo 🏋`, or `- Mo training`, marks Monday as a training day. A day whose
daily note holds a training entry under `## Training` (see
[Training format](/reference/training-format.md)) is one too, when the plan
names its week.

## The card

The card sits under the note's `# ` title and follows typing, as the recipe
card does. It shows:

* The week and its dates, as `Woche 46 · 9.–15. Nov`.
* A grid of the seven days by Mittag and Abend. A cooked meal is filled, with
  its cook under it; a meal from a batch is tinted; any other meal is plain; a
  day with no meal shows a dashed `–`. A training day carries a `Training` chip.
* Each batch as a band in the Batches column, down the days from its cooking to
  its last meal, with what is left: `Mo–Mi · 1 übrig`, or `2 zu wenig` when the
  plan draws more servings than it cooks. Bands whose days overlap sit side by
  side.
* A meal on the third day in the fridge or later, with the default limit of 2
  days, is marked, and its band says `Sa ist Tag 3: einfrieren?`.
* `Protein an Trainingstagen` with the mean over the training days and the
  daily protein goal of the [log config note](/reference/food/log-format.md):
  `Ø 128 g · Ziel 120`. A day's protein is one serving of each recipe its
  meals name; a meal with no recipe adds nothing.
* The button `N in den Einkauf`, where N counts the foods the week's cooked
  batches need.

## The shopping list

The button writes the week's cooked batches into `Einkauf.md` in the shared
folder, through `POST /api/meal-plan/shopping`. Only `cook` meals bring
ingredients; a `from` meal adds nothing.

* Each ingredient is scaled from the recipe's `servings` to the batch's: 500 g
  for 4 servings is 750 g for `x6`. A recipe or batch with no servings is
  bought as the note says.
* Ingredients of the same food in the same unit are summed across recipes,
  each line linking back to its recipes:
  `- [ ] 5 Zwiebeln ([[Chili sin carne]], [[Linsen-Dal]])`.
* An open line already on the list for that food and unit takes the new
  amount and the new links. An open line that links the recipe already is left
  alone, so a second press adds nothing.
* A ticked line is never written over: the food gets a new open line.
* A new line goes under the heading of its aisle, `## Obst & Gemüse`, `## Kühlregal`,
  `## Vorrat` and so on, made at the end of the list when it is missing. A tin,
  a jar or a pack goes under `## Vorrat`; any other food goes by the words of
  its name, and `## Sonstiges` takes what no word places. The words are in
  `backend/src/kasten_backend/food/plan/aisles.json`.
* Quantities are written the German way: whole from 10 up, else to two places
  with a comma, as `1,5 TL Kreuzkümmel`.

The list stays a plain shared list: edit, tick or delete any line by hand, in
kasten or the lists app.
