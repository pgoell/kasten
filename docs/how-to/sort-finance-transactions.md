---
type: How-to Guide
title: Sort finance transactions
description: Open the finance pane on the bookings still to sort, put each in a category with one key or tap, send every booking of a payee to one category at once, and know when a rule or the hand wins.
tags: [finance, pane, keys, phone]
status: draft
---

# Sort finance transactions

Every booking the bank job brings in gets a category from the rules if one
fits. What no rule fits waits in the finance pane's to-sort list. The list is
oldest first, so a backlog clears from its start.

## Open the pane

* With keys: `<leader>gk`.
* On a phone: the palette's `Open the finance pane`.

The pane opens in the focused pane, on its overview; press `S` or tap
`To sort` for the list. Split first to keep the note you were in beside it. Its keys are in
[The finance pane](/reference/editor-keys.md#the-finance-pane).

You need at least one category. Until the categories screen comes, make them
through [the API](/reference/http-api/finance-sorting.md#post-apifinancecategories).

## Sort one booking

1. Move to the booking with `j` and `k`, or tap it.
2. Press the key shown on the category's button, or tap the button.

The booking leaves the list. You set its category by hand, so no rule will
change it later. A booking split into parts, such as an Amazon order with
several items, shows each part still to sort as its own row; you sort the
parts, not the booking.

## Sort every booking of a payee

1. Move to a booking of that payee.
2. Press `a`, or tap `Always for this payee`. The button shows it is on.
3. Press or tap the category.

The payee now has that category as its default. Every booking of theirs takes
it, the ones already in and the ones still to come, except a booking you
sorted by hand and one a text rule sorts. `Escape` turns `a` off without
sorting anything.

Do not use it for PayPal, Amazon or another payee who stands for many shops.
For those, a `text_contains` rule on the purpose is the right tool, and it
beats the payee's default.

## Sort from the transactions list

A booking that already has a category, or one you find by its payee, sorts
the same way from the Transactions tab (`T`): move to it, then press the
category's key or tap its button. A split booking sorts on To sort, part by
part, and a transfer takes no category.

## Which category wins

The hand first, then a text rule on the purpose, then the payee's default,
then a payee rule. [How a booking gets its category](/reference/http-api/finance-sorting.md#how-a-booking-gets-its-category)
gives the full order and why.

## Related

* [HTTP API: finance sorting](/reference/http-api/finance-sorting.md): the routes behind the pane
* [Finance in Postgres](/explanation/finance-in-postgres.md): why the bookings live in the database
