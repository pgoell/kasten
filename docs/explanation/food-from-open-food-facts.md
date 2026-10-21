---
type: Explanation
title: Food from Open Food Facts
description: Why the food data comes from Open Food Facts, why the backend asks for it and not the browser, what leaves the server, why kasten counts its own calls, why the cache lives in memory, why search goes to Search-a-licious, and what the route answers when Open Food Facts refuses.
tags: [food, open-food-facts, backend, privacy, rate-limits]
status: stable
---

# Food from Open Food Facts

A food in the log carries its nutrients, and those come from
[Open Food Facts](https://world.openfoodfacts.org), a free food database. The
routes and their answers are in [HTTP API: food](/reference/http-api/food.md).
This page says why they are built the way they are.

## Why Open Food Facts

Issue #621 named it. It is open data under the Open Database License (ODbL), so
anyone may read and reuse it. It needs no key, so kasten needs no account or
secret to use it. It is a barcode database, and most of its products give
nutrients per 100 g and many give them per serving, which is what a food log
needs.

## Why the backend asks

The browser could ask, but the app's `connect-src 'self'` allows calls only to
kasten's own origin. So the backend makes the call and hands back a trimmed
food. The weather card works the same way, through
[Open-Meteo](https://open-meteo.com).

Asking on the server also puts three things in one place:

* the User-Agent that Open Food Facts asks every client to send;
* the rate limits, so every tab and device shares one count;
* the cache, so a food found once is held for every later search.

Open Food Facts then sees the server's address, not the phone's.

## What leaves the server

Two things leave the server, and no others:

* the words typed in a search, or the digits of a barcode;
* the User-Agent, `kasten/<version> (<contact>)`. The version is the release.
  The contact is [`KASTEN_FOOD_CONTACT`](/reference/configuration.md#kasten_food_contact).
  Its default is the kasten repository URL, so no personal address leaves the
  server until the operator sets one.

Nothing about notes, the vault or the user leaves. No login, cookie or token
goes with the call. [The security model](/explanation/security-model.md) covers
the outside calls that take an address from the user, such as page fetching,
and checks each address before it connects. The food calls need no such check:
the two hosts are fixed in the code, and a barcode must be digits before it
reaches the URL.

## The limits

Open Food Facts allows 15 product reads and 10 searches a minute from one IP
address. Going past that can get the IP banned, and a ban cuts the server off
from the database. Open Food Facts names no separate limit for searches on
Search-a-licious, so searches keep to the 10 a minute.

kasten counts its own calls in a 60-second window, one for searches and one
for product reads. A call over the limit is refused before Open Food Facts is
called, and the answer says how many seconds to wait. Cached answers make no
call, so they are not counted. A call counts even when it fails, because Open
Food Facts counts it too.

## Why the cache is in memory

A search is kept for a day and a found barcode for three days. The cache lives
in memory, not in Postgres, for two reasons.

* No food is a record. The record is the line the log writes into the daily
  note, with the name and nutrients as they were logged. A cache in Postgres
  would hold a second copy of someone else's database, with no one to keep it
  fresh. [The vault and the derived index](/explanation/vault-and-derived-index.md)
  sets out what the database may hold.
* A restart costs a few calls. The cache fills again as searches come back, and
  the limits cap what that costs.

## Why search goes to Search-a-licious

Search uses `search.openfoodfacts.org`. The older `cgi/search.pl` refused an
anonymous call with a `503` on 2026-10-21. The v2 product API has no full-text
search, so it cannot find a food by its name. It still answers a barcode read,
which is one product by its code.

## What the route answers when Open Food Facts refuses

The route answers with one of these messages, and the detail names the cause
and, where it can, the wait:

* kasten's own limit is full: `429`, such as `Open Food Facts allows 10
  searches a minute; try again in 42 s`. Open Food Facts is not called.
* Open Food Facts answers `429` or `503`: `503`, `Open Food Facts refused the
  request (too many requests or busy); try again in a minute`.
* Open Food Facts cannot be reached, is too slow, or sends a body kasten does
  not read: `502`, `Open Food Facts did not answer`.
* A barcode with no product: `404`, `No food with barcode <code> on Open Food
  Facts`. A search with no match is an empty list, not an error.

## Related

* [HTTP API: food](/reference/http-api/food.md): the routes, the answers and the limits
* [The log format](/reference/log-format.md): the line a logged food leaves in the daily note
* [Configuration](/reference/configuration.md): `KASTEN_FOOD_CONTACT` and the other settings
