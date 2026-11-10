---
name: meal-planner
description: Draft next week's meal plan in the vault. Reads the rated recipes, the constraints note (protein goal, budget, evenings away, who eats), the training days and the last weeks' plans, asks what the week holds, then writes next week's Meal Plan note in the shared folder with batches sized to the meals they feed. Takes kcal and protein from kasten, never counts them. `/meal-planner` plans next week, `/meal-planner this` the current one.
---

# /meal-planner

Writes one week plan note, the format in kasten's `docs/reference/food/meal-plan.md`.
Read that format from an existing plan in `{{share}}/` before you write; the summary
below is enough when there is none.

Paths are relative to the vault, the working directory. Dates are Europe/Berlin.
The backend is at `$KASTEN_API`; `curl -s "$KASTEN_API/api/recipes"` answers
without a token inside the shell container.

## Hard rules

- Never count kcal or protein yourself. Every number comes from
  `GET /api/recipes` (`per_serving`) or from `POST /api/meal-plan`. A recipe
  whose `per_serving` is null counts as unknown, never as zero.
- Write one note: `{{share}}/Woche <NN>.md` for the planned week. Change no
  recipe, no daily note, no other plan. Shopping is the plan card's button, not
  yours.
- An existing plan for that week is the user's: show what it holds and ask
  before you replace a line of it.
- Write nothing before the round is answered.
- Do not write `id`, `created` or `modified` into the block at the top; kasten
  stamps it.

## Read

WEEK is next ISO week (`date -d 'next monday' +%G-W%V`), or this one with `this`.
MONDAY is its Monday.

1. **Constraints.** `{{config}}/Essensplanung.md`. Bullets, any order:
   ```markdown
   - people: Pascal, Alicia
   - protein: 140 g a day
   - budget: 90 € a week
   - away: Do dinner, Sa lunch
   - fridge: 2
   - lunch: Mo-Fr from a batch
   - avoid: Pilze
   ```
   Missing: ask the questions it would answer in the round, then write it, so
   the next run asks less.

2. **Goals.** `{{config}}/log.md`: the line `- 🍽 food: …` is the everyday goal,
   `- 🍽 training: …` the goal on a training day. A protein in the constraints
   note wins over both.

3. **Recipes.** `curl -s "$KASTEN_API/api/recipes"` gives each recipe's path,
   title, servings and numbers per serving. For each, read its `## Gekocht`
   lines in the note: `gern wieder` ranks high, `geht so` middle, `lieber
   nicht` never comes back unless the user names it. A recipe never cooked is
   new: offer one or two a week, not more.

4. **Last weeks.** The plans of the four weeks before WEEK in `{{share}}/`
   (`rg -l '^type: [Mm]eal [Pp]lan' '{{share}}'`). A dish cooked in the last two
   weeks waits, unless the user asks for it.

5. **Training days.** Days of WEEK the constraints or the user name, else the
   weekdays the last two weeks' daily notes
   (`{{periodic}}/00 Daily/YYYY-MM-DD.md`) hold an entry under `## Training`.
   Mark them `- Mo 🏋` in the plan.

## Draft

6. Lay out WEEK in your head, nothing written:
   - Every lunch and dinner not away gets a meal. Cook on two or three evenings;
     each batch feeds the meals after it, `xN` the servings it must give: one per
     person at the cooking meal plus one per `from` meal.
   - No batch is eaten on its third day or later, with `fridge` days as the limit
     (2 when not set). Plan a second batch rather than a long one.
   - Training days get the recipes with the most protein per serving. Every day
     should reach its goal from the recipes alone; say where it does not.
   - Spread the cooking among the people when the constraints name more than one.
   - Keep to the budget when one is set: say the estimate and that it is a guess,
     since recipes carry no prices.

## Ask

7. One round with `AskUserQuestion`, 4 questions of 4 options a call:
   - The evenings: any away, any guests, who cooks which batch.
   - The dishes: the draft's batches, each with an alternative from the ranking.
   - The training days, when they came from the dailies and not from the
     constraints.
   - New recipes: which of the untried ones, if any.
   If the session cannot ask, write the draft as it stands and say "not asked".

## Write

8. Write `{{share}}/Woche <NN>.md`:
   ```markdown
   ---
   type: Meal Plan
   week: 2026-W47
   ---
   # Woche 47

   - Mo 🏋
   - Mo lunch: from [[Chili sin carne]]
   - Mo dinner: cook [[Linsen-Dal]] x4 👤 [[Alicia]]
   - Di lunch: from [[Linsen-Dal]]
   - Do dinner: Essen gehen
   ```
   Day `Mo`…`So`, slot `lunch` or `dinner`, then `cook [[Recipe]] xN 👤 [[Name]]`,
   `from [[Recipe]]` or any words. Link a recipe by its note's file name.

9. Check it: `curl -s -X POST "$KASTEN_API/api/meal-plan" -H 'Content-Type: application/json' --data "$(jq -Rs '{text: .}' < '{{share}}/Woche <NN>.md')"`.
   A batch with a negative `left`, a meal with `freeze` true, or a training day
   under `protein_goal` is a fix to make or a line in the report.

10. **Report** in chat, 4 lines at most: the batches with their cooks, protein on
    training days against the goal from the check, what broke a constraint and
    why, and the plan's link `[[Woche <NN>]]`.
