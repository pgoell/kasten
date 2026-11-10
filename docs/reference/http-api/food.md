---
type: Reference
title: "HTTP API: food"
description: The routes that search Open Food Facts for a food, read one by its barcode, work out a recipe's kcal and macros per serving, list and import the recipe notes, lay out a week plan and write its shopping list, the answers they give, and the limits they keep.
resource: backend/src/kasten_backend/food/__init__.py
tags: [api, backend, openapi]
status: stable
---

# HTTP API: food

Two routes find a food for the log: a search by name, and a read by barcode.
Both ask [Open Food Facts](https://world.openfoodfacts.org), an open food
database, and both answer with the same food shape. A third works out a
recipe's numbers: see [POST /api/recipe/nutrition](#post-apirecipenutrition).
A fourth lists the recipe notes for the food sheet: see
[GET /api/recipes](#get-apirecipes). Two more serve a week plan: its layout,
and its ingredients into the shopping list; see
[POST /api/meal-plan](#post-apimeal-plan).

## GET /api/food/search

Takes `q`, the words to search for, and answers with a list of foods in the
order Open Food Facts gives them.

```
GET /api/food/search?q=skyr
```

```json
[
  {
    "code": "8710624358174",
    "name": "Skyr naturel",
    "brand": "Skyr",
    "serving_g": 100.0,
    "serving_from": "default",
    "per_100g": { "kcal": 62.0, "protein": 11.0, "carbs": 4.0, "fat": 0.2 },
    "per_serving": { "kcal": 62.0, "protein": 11.0, "carbs": 4.0, "fat": 0.2 }
  }
]
```

`q` loses its spaces at both ends first, and must then be 2 to 100 characters.
A `q` of 8 to 14 digits only is a barcode, not words: the answer is that one
food, or an empty list when Open Food Facts has no such product.

A hit with no code names no product, so it is left out.

## GET /api/food/barcode/{code}

Takes the barcode as `code`, 8 to 14 digits, and answers with the one food.

```
GET /api/food/barcode/3017624010701
```

```json
{
  "code": "3017624010701",
  "name": "Nutella",
  "brand": "Ferrero",
  "serving_g": 100.0,
  "serving_from": "default",
  "per_100g": { "kcal": 539.0, "protein": 6.3, "carbs": 57.5, "fat": 30.9 },
  "per_serving": { "kcal": 539.0, "protein": 6.3, "carbs": 57.5, "fat": 30.9 }
}
```

## The food

* `code` is the barcode. `name` is the product name, else the first brand, else
  the code.
* `brand` is the first brand Open Food Facts names, or `null` when it names none.
* `serving_g` is the weight of one serving in grams, and `serving_from` says
  where that number came from:
  * `serving_quantity`, when Open Food Facts gives a positive quantity;
  * `serving_size`, when the grams are written in its text, such as `50 g` or
    `1 bar (52,7 g)`. Millilitres do not count;
  * `default`, when neither is given, so the serving is 100 g.
* `per_100g` holds `kcal`, `protein`, `carbs` and `fat`, each read from Open
  Food Facts. A field it does not give is `null`.
* `per_serving` holds the same four. Where Open Food Facts gives a figure for the
  serving, that is the figure. Otherwise it is the 100 g figure scaled to
  `serving_g`. It is `null` where both are missing.
* Every number is rounded to three decimal places.

## POST /api/recipe/nutrition

Takes a recipe note's text, as the editor holds it, and answers with each
ingredient line matched to a food, and the sums. The note's format and the
rules a line is read by are in [Recipe note](/reference/food/recipe-note.md).
The code is `backend/src/kasten_backend/food/recipes/`.

```
POST /api/recipe/nutrition
{"text": "---\ntype: Recipe\nservings: 4\n---\n# Chili\n\n## Zutaten\n- 500 g Kidneybohnen\n- 1 TL Kreuzkümmel\n"}
```

```json
{
  "servings": 4.0,
  "time": null,
  "source": null,
  "tags": [],
  "ingredients": [
    {
      "line": 8, "text": "500 g Kidneybohnen", "group": null,
      "quantity": 500.0, "quantity_to": null, "unit": "g", "food": "Kidneybohnen", "note": null,
      "rest": "g Kidneybohnen", "grams": 500.0,
      "match": { "source": "mine", "name": "Kidneybohnen", "code": null },
      "status": "counted",
      "nutrients": { "kcal": 500.0, "protein": 35.0, "carbs": 60.0, "fat": 2.5 }
    },
    {
      "line": 9, "text": "1 TL Kreuzkümmel", "group": null,
      "quantity": 1.0, "quantity_to": null, "unit": "TL", "food": "Kreuzkümmel", "note": null,
      "rest": "TL Kreuzkümmel", "grams": null, "match": null, "status": "no_match", "nutrients": null
    }
  ],
  "steps": [],
  "cooked": [],
  "total": { "kcal": 500.0, "protein": 35.0, "carbs": 60.0, "fat": 2.5 },
  "per_serving": { "kcal": 125.0, "protein": 8.8, "carbs": 15.0, "fat": 0.6 }
}
```

* `servings`, `time`, `source` and `tags` are the frontmatter's. `servings` is
  `null` when the note names none, or names no number above zero and under 1000.
* `ingredients` holds one entry per line under `## Zutaten`, in order. `line`
  counts from one, `text` is the line without its bullet, `group` is the `###`
  heading above it. `quantity`, `unit`, `food` and `note` are what the parser
  read. `quantity_to` is the upper end of a range, as 3 in `2-3 Zwiebeln`, and
  `null` otherwise; only `quantity` counts. `rest` is the line after its quantity, a pinned barcode taken out, or
  the whole line when it has no quantity, so a view can scale the number alone. `grams` is what the line weighs, and `nutrients` what it adds, each
  rounded to a tenth.
* `status` is `counted`, `no_match`, `no_amount`, `no_weight` or `unreached`;
  [Recipe note](/reference/food/recipe-note.md#why-a-line-is-not-counted) says
  when each is given. Only a `counted` line has `grams` and `nutrients`.
* `match` names the food: `source` is `mine` for a line of `foods.md` and `off`
  for an Open Food Facts product, with its `name` and barcode `code`.
* `steps` are the numbered lines under `## Schritte`.
* `cooked` holds one entry per line under `## Gekocht`, in the note's order:
  its `line`, the `date` as `YYYY-MM-DD`, the `verdict` (`lieber nicht`,
  `geht so`, `gern wieder` or `null`) and the `note` after it, or `null`.
  [Recipe note](/reference/food/recipe-note.md#the-meals-cooked) gives the
  format.
* `total` sums the counted lines, each field over the lines that give it, and is
  `null` in a field no counted line gives. `per_serving` is `total` over
  `servings`, or `null` with no servings. Both round to a tenth once, after the
  sum.

A barcode pinned to a line is read as `GET /api/food/barcode/{code}` reads it,
inside the same limits and cache. A read Open Food Facts refuses, or that the
limit stops, makes that line `unreached` and the answer is still `200`. The
route answers `422` for a body without `text`, or a `text` over 200,000
characters. It writes nothing.

## GET /api/recipes

Lists every recipe note outside the archive folder, sorted by title, with its
numbers, for the food sheet. A note is a recipe when its block says
`type: Recipe`, in any case. Each note is worked out as
[POST /api/recipe/nutrition](#post-apirecipenutrition) works out its text, inside
the same limits and cache.

```json
[
  {
    "path": "Rezepte/Chili.md",
    "title": "Chili sin carne",
    "servings": 4.0,
    "per_serving": { "kcal": 540.0, "protein": 32.0, "carbs": 62.0, "fat": 14.0 },
    "total": { "kcal": 2160.0, "protein": 128.0, "carbs": 248.0, "fat": 56.0 }
  }
]
```

* `title` is the first `# ` heading below the note's frontmatter, or its file name without `.md`.
* `per_serving` is `null` when the note names no servings; `total` is then the
  whole dish.
* A note that cannot be read as UTF-8 is left out. The route writes nothing.

## POST /api/recipes/import

Writes a recipe note from a web page, or from a schema.org `Recipe` already
read, such as the one the model makes of a pasted caption. Send one of the two:

```json
{ "url": "https://www.chefkoch.de/rezepte/1170311223132029/Chili-sin-Carne.html" }
```

```json
{
  "recipe": {
    "name": "Feta-Pasta aus dem Ofen",
    "recipeYield": "2",
    "recipeIngredient": ["200 g Feta", "400 g Kirschtomaten"],
    "recipeInstructions": ["Feta und Tomaten 25 Minuten backen."]
  },
  "source": "https://www.instagram.com/reel/C0abc/"
}
```

It answers `201` with the note it wrote:

```json
{ "path": "Rezepte/Chili sin Carne.md", "title": "Chili sin Carne" }
```

* A `url` is fetched as `GET /api/fetch` fetches, public addresses only. When
  the site answers `403`, `429` or `503`, kasten asks once more with a
  browser's TLS fingerprint, still pinned to the address it checked.
* The page's schema.org data is read with
  [recipe-scrapers](https://github.com/hhursev/recipe-scrapers). A `recipe` is
  checked first: `name`, a non-empty `recipeIngredient` and a non-empty
  `recipeInstructions` must be there, each step text or a `HowToStep` with
  `text`. It is then read the same way a page is.
* The note is [the recipe note](/reference/food/recipe-note.md) with
  `servings`, `time` and `source` where known, and `## Zutaten` and
  `## Schritte`. It lands in `KASTEN_RECIPES_PATH`, named after the title; a
  name already taken gets ` 2`, ` 3` and so on.

It answers `422` for a body with neither or both, a `recipe` that fails the
check, or a page with no recipe on it; `400` for an address that is not http
or https or not on the internet; and `502` when the page cannot be read, with
`paste the recipe` in the detail when the site turned both tries away.

## POST /api/meal-plan

Takes a [week plan note](/reference/food/meal-plan.md) as the editor holds it,
`{"text": "…"}` up to 200,000 characters, and answers with the week as the
card draws it. Nothing is written.

```json
{
  "week": "2026-W46",
  "fridge_days": 2,
  "days": [{ "day": 0, "date": "2026-11-09", "training": true, "protein": 24.0 }],
  "meals": [
    {
      "line": 7, "day": 0, "slot": "dinner", "kind": "cook",
      "text": "cook [[Linsen-Dal]] x4 👤 [[Alicia]]", "recipe": "Linsen-Dal",
      "path": "Rezepte/Linsen-Dal.md", "servings": 4, "cook": "Alicia",
      "batch": 0, "fridge_day": 1, "freeze": false
    }
  ],
  "batches": [
    {
      "recipe": "Linsen-Dal", "path": "Rezepte/Linsen-Dal.md", "day": 0,
      "slot": "dinner", "servings": 4, "first_day": 0, "eaten": 3, "left": 1,
      "last_day": 2, "cook": "Alicia", "state": "cooked"
    }
  ],
  "protein_goal": { "type": "floor", "value": 120.0 },
  "ingredients": 17
}
```

* `days` holds all seven, Monday first, `date` null when the note names no
  week. `protein` is one serving of each recipe the day's meals name, worked
  out as `POST /api/recipe/nutrition` does, or null for a day with none.
* `meals` is in week order. `kind` is `cook`, `from` or `other`; `path` is null
  when no note answers to the link. `batch` indexes `batches`; `fridge_day` is 1
  on the cooking day; `freeze` is true from the plan's fridge limit on.
* A batch's `state` is `earlier` for one a `from` drew on with no `cook` before
  it this week: its `day`, `slot` and `servings` are null. `left` is
  `servings - eaten`, negative when the plan draws more than it cooks.
* `protein_goal` is the log config note's protein goal, or null.
* `ingredients` counts the foods the cooked batches need, before merging.

## POST /api/meal-plan/shopping

Takes the same body, and writes the ingredients of the week's cooked batches
into `Einkauf.md` in `KASTEN_SHARE_FOLDER`, scaled, summed by food and unit,
filed by aisle and merged into open lines as
[the week plan page](/reference/food/meal-plan.md#the-shopping-list) says. It
answers with what it did:

```json
{ "path": "05 Shared/Einkauf.md", "added": 6, "merged": 1, "skipped": 0 }
```

`merged` counts open lines that took more for a recipe they did not link yet,
`skipped` foods an open line holds for every recipe already. A press that adds
and merges nothing writes nothing. The list is read and written with its
digest, so an edit that lands in between answers `409`.

## Errors

The two food routes answer:

* `422` when `q` is under 2 or over 100 characters once trimmed, or when a
  barcode is not 8 to 14 digits.
* `404` when Open Food Facts has no product with the barcode, or answers with a
  redirect. A redirect means the product sits in another Open Food Facts database,
  which kasten does not read. The detail names the code as it was typed:
  `No food with barcode 0000000000017 on Open Food Facts`.
* `429` when kasten's own limit for the minute is used up. Open Food Facts is
  not called. The detail names the seconds to wait, such as
  `Open Food Facts allows 10 searches a minute; try again in 42 s`, or
  `Open Food Facts allows 15 product reads a minute; try again in 42 s` for a
  barcode.
* `503` when Open Food Facts itself answers `429` or `503`. The detail is
  `Open Food Facts refused the request (too many requests or busy); try again in a minute`.
* `502` when Open Food Facts cannot be reached, is too slow, answers with an
  error other than the two above, sends a body that is not JSON, or sends JSON
  of a shape this route does not read. The detail is `Open Food Facts did not answer`.

## Limits

Open Food Facts allows 15 product reads and 10 searches a minute from one IP
address, and says that going past these can get the IP banned. Its page is
[the API rate limits](https://openfoodfacts.github.io/openfoodfacts-server/api/#rate-limits).

kasten keeps a window of the last 60 seconds for each limit, and counts only the
calls it makes to Open Food Facts. A call over the limit is refused with `429`
before Open Food Facts is called. Answers from the cache do not count.

Open Food Facts names no limit for Search-a-licious, so kasten holds searches to
the search limit of 10 a minute.

Searches go to Search-a-licious, at `search.openfoodfacts.org`. The older
`cgi/search.pl` refused anonymous calls with a `503` on 2026-10-21, and the v2
product API has no full-text search, so it cannot find a food by its name.

## Cache

Answers are kept in memory, so a restart forgets them:

* a search is kept for 24 hours, keyed by `q` in lower case;
* a barcode that was found is kept for 3 days, keyed by the code;
* a barcode Open Food Facts has no product for (a `404`, a redirect or
  `status: 0`) is kept for an hour, so a recipe card that asks after every
  pause in typing reads it once. A product added later is found after the hour.

A failed read is not kept.

## Requests

Every request to Open Food Facts carries
`User-Agent: kasten/{version} ({contact})`. The version is the backend's
release, and the contact is [`KASTEN_FOOD_CONTACT`](/reference/configuration.md#kasten_food_contact).
Each request times out after 10 seconds, and redirects are not followed.

Nothing is written to the vault, to Postgres or to disk.
