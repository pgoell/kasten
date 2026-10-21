---
type: Reference
title: "HTTP API: food"
description: The two routes that search Open Food Facts for a food or read one by its barcode, the answers they give, and the limits they keep.
resource: backend/src/kasten_backend/food.py
tags: [api, backend, openapi]
status: stable
---

# HTTP API: food

Two routes find a food for the log: a search by name, and a read by barcode.
Both ask [Open Food Facts](https://world.openfoodfacts.org), an open food
database, and both answer with the same food shape.

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

## Errors

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
* a barcode that was found is kept for 3 days, keyed by the code.

A barcode with no product is not kept, so a product added to Open Food Facts
later is found on the next read.

## Requests

Every request to Open Food Facts carries
`User-Agent: kasten/{version} ({contact})`. The version is the backend's
release, and the contact is [`KASTEN_FOOD_CONTACT`](/reference/configuration.md#kasten_food_contact).
Each request times out after 10 seconds, and redirects are not followed.

Nothing is written to the vault, to Postgres or to disk.
