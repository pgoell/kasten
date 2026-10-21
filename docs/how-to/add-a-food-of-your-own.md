---
type: How-to Guide
title: Add a food of your own
description: Log a food that Open Food Facts lacks by saving it once to the foods note, from the food search or by hand, and fix or remove it later in the note.
tags: [food, log, phone, barcode]
status: stable
---

# Add a food of your own

Open Food Facts lacks some products, and a barcode it does not know logs
nothing. Save such a food once as your own. From then on the food search lists
it first, marked `mine`, and a scan of its barcode opens it without asking Open
Food Facts.

## From the food search

1. Open the food search: `+ 🍽 food` on a daily note's log card, the log pane,
   or the palette's `Log food`.
2. Type the food's name. Or scan its barcode: when Open Food Facts does not know
   it, kasten says so and keeps the code.
3. Tap `Add food`. The form takes the typed name, and the scanned or typed
   barcode.
4. Fill in the serving in grams, and kcal, protein, carbs and fat per 100 g, as
   the pack's nutrition table prints them. Only the name and kcal are required;
   the serving is 100 g when you leave it so.
5. Tap `Save`. The food goes to the end of `99 Misc/01 Config/foods.md`, and
   opens in the serving form.
6. Pick the grams or servings and the meal, and tap `Log this food`.

If the save fails, the form stays and says why. Nothing is logged until you tap
`Log this food`.

## By hand

Open `99 Misc/01 Config/foods.md` and add a line:

```markdown
- ja! Choco Chips: 30 g, 🏷 4337185123456, 🔥 486 🥩 6.4 🍞 61 🧈 23
```

The figures are per 100 g. [The foods note](/reference/log-format.md#the-foods-note)
gives every rule of the line.

## Fix or remove a food

The food search adds lines and changes none. To fix a figure or drop a food, edit
or delete its line in `foods.md`. A line that does not read as a food is named in
the search as `Skipped line N of foods.md`, and the rest still list.

A fix changes the food from then on. Lines already logged keep the figures they
were logged with, since a logged line is its own record.

## Related

* [Log food from a phone](/how-to/log-food-from-a-phone.md): scan a barcode and log the food
* [The log format](/reference/log-format.md#the-foods-note): the foods note, line by line
* [Food from Open Food Facts](/explanation/food-from-open-food-facts.md#foods-of-your-own): why your own foods live in a note
