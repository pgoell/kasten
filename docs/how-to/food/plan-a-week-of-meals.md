---
type: How-to Guide
title: Plan a week of meals
description: Save recipes, set food goals for training days, plan the week by hand or with /meal-planner, send the cooked batches to the shopping list, cook with cook mode, log and rate what you ate, and see the week in the lists app.
tags: [food, recipes, meal-plan, shopping, training]
status: stable
---

# Plan a week of meals

You want to plan next week's meals, cook in batches, shop for them and log
what you ate. This page walks through one week. Each step links to the
reference page that says exactly what kasten reads and writes.

## Save your recipes

A recipe is a note with `type: Recipe` in its frontmatter.

* **From a recipe site:** open `/capture` on your phone, paste the link, such
  as one to Chefkoch, and tap **Save as recipe**. The note lands in `Rezepte`.
* **From Instagram, TikTok or YouTube:** paste the post's caption with its
  link, or share the post to kasten, and tap **Save as recipe**. Claude reads
  the caption; kasten never opens the post itself. When a recipe site turns
  kasten away, do the same with the recipe's text.
* **By hand:** write a note with `type: Recipe` and `servings: 4` in the
  frontmatter, the ingredients under `## Zutaten` and the steps under
  `## Schritte`.

Open the note. The card under the title shows kcal and protein per serving
and each line it could not count. Fix a line it could not count, or add the
food to your foods note, so the numbers are right.
[Recipe note](/reference/food/recipe-note.md) has the format.

## Set your goals

Open `99 Misc/01 Config/log.md` and set the everyday goals and those of a
training day:

```markdown
- 🍽 food: kcal max 2200, protein min 120
- 🍽 training: kcal max 2600, protein min 160
```

On a day whose note has an entry under `## Training`, the log card shows the
training goals. [The config note](/reference/food/log-format.md#the-config-note)
has the rules.

## Plan the week

### With the planner

1. Open the chat pane with `<leader>cc`, or tap `chat` on a phone.
2. Tap `/meal-planner`. Type `/meal-planner this` to plan the current week
   instead of the next.
3. The first time, it asks who eats, your protein goal, your budget and which
   meals you are away, and keeps the answers in
   `99 Misc/01 Config/Essensplanung.md`. Edit that note whenever they change.
4. Answer its questions about the week: evenings away, who cooks, which dishes.
5. It writes `05 Shared/Woche <NN>.md` and says which batches it planned and
   whether the training days reach their protein goal.

[The planner skill](/reference/food/meal-plan.md#the-planner-skill) lists
what it reads.

### By hand

Make a note in `05 Shared/` with `type: Meal Plan` and the week, then one line
per meal:

```markdown
---
type: Meal Plan
week: 2026-W47
---
# Woche 47

- Mo 🏋
- Mo dinner: cook [[Linsen-Dal]] x4 👤 [[Alicia]]
- Di lunch: from [[Linsen-Dal]]
- Mi lunch: from [[Linsen-Dal]]
- Do dinner: Essen gehen
```

`cook [[Recipe]] x4` cooks four servings once. `from [[Recipe]]` eats one of
them later. [Meal lines](/reference/food/meal-plan.md#meal-lines) has every
form.

### Check the plan

Open the week's note. The card under the title shows:

* each batch as a band down the days it feeds, with what is left or missing;
* a warning on a meal on the third day in the fridge, so you can freeze it;
* the mean protein on training days against your goal.

Change a line until the bands and the protein look right.

## Shop

Tap `N in den Einkauf` on the plan's card. The ingredients of every cooked
batch, scaled to its servings, go into `05 Shared/Einkauf.md` under their
aisle. Tapping again adds nothing twice. Tick and edit the list as before, in
kasten or the lists app.
[The shopping list](/reference/food/meal-plan.md#the-shopping-list) says how
lines merge.

## Cook

Open the recipe and tap `Cook`. Cook mode shows one step at a time in large
type, keeps the screen on, and offers a timer where a step names a time. Set
the servings on the card first: cook mode scales the amounts to them.
[Cook mode](/reference/food/recipe-note.md#cook-mode) has the details.

## Log and rate

1. On the day's note, tap `+ Food` on the log card.
2. Pick the recipe under `Recipes`, set how many servings you ate, and tap
   `Log this food`.
3. The rating sheet asks `cook again?`. Pick a face, add what to change, and
   tap `Done`. The answer goes under the recipe's `## Gekocht`, where the
   planner reads it next week.

Tap `Later` to rate in the evening instead.
[The rating sheet](/reference/food/recipe-note.md#the-rating-sheet) says when
it comes back.

## See the week in the lists app

The lists app's `Essen` tab shows the meals from today through the next six
days, with who cooks. Anyone you share the lists with sees it there. Tap a
dish to open its recipe, or find any recipe in the `Rezepte` tab, with a
servings stepper that scales the amounts. It only shows the plan and the
recipes; plan and write them in kasten.

## Related

* [Week plan](/reference/food/meal-plan.md): the format, the card and the
  planner skill
* [Recipe note](/reference/food/recipe-note.md): the format, the card, cook
  mode and the rating sheet
* [Log format](/reference/food/log-format.md): the log card and its goals
* [Run a skill from the chat pane](/how-to/run-a-skill-from-the-chat-pane.md)
