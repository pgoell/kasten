---
type: Reference
title: "HTTP API: finance orders"
description: The two routes for PayPal and Amazon orders, the post the order mail job sends and the orders no booking holds yet, with the rules that match a charge to its booking and split it into items.
resource: backend/src/kasten_backend/routes/finance_orders.py
tags: [api, backend, openapi, finance]
status: draft
---

# HTTP API: finance orders

PayPal and Amazon bookings say little about what was bought. The order mail
job on the host reads the order mails and posts each order here
([Run the order sync](/how-to/run-the-order-sync.md)); kasten stores it and
matches each of its charges to the bank booking that paid it. A matched
booking is split into the charge's items, so each item counts in its own
category. No order ever makes a booking of its own.

They sit beside the other finance routes, behind the same gate and with the same
`503` when no database answers; [HTTP API: finance](/reference/http-api/finance.md)
says who reaches them. Amounts are strings, as there.

## POST /api/finance/orders

Takes up to 200 orders, stores each by its `source` and `order_key`, then
matches every charge that waits to its booking. Answers with what it did.

```json
[
  {
    "source": "amazon", "order_key": "123-4567890-1234567", "ordered_on": "2026-10-15",
    "merchant": "Amazon", "total": "40.00", "currency": "EUR",
    "charges": [
      {
        "kind": "charge", "key": "18f0c2a9e1", "charged_on": "2026-10-16", "amount": "25.00",
        "items": [ { "text": "Lamp", "amount": "25.00" } ]
      },
      {
        "kind": "charge", "key": "18f0d7b3c4", "charged_on": "2026-10-18", "amount": "15.00",
        "items": [ { "text": "2 x Light bulb", "amount": "12.00" }, { "text": "Cable", "amount": "3.00" } ]
      },
      { "kind": "refund", "key": "18f1a0e5d2", "charged_on": "2026-10-25", "amount": "3.00" }
    ]
  }
]
```

```json
{ "created": 1, "updated": 0, "unchanged": 0, "matched": 2 }
```

* `source`: `amazon` or `paypal`. It names the words a booking of the order
  carries: `amazon` or `amzn`, or `paypal`, in its purpose or counterparty.
* `order_key`: the shop's id, the Amazon order number or PayPal's
  transaction code. With `source` it is the key an order is stored by.
* `total`: what the order mail says the order came to, for showing; `null`
  when not known. Matching reads the charges, not this.
* `charges`: each payment and each refund. A `charge` (the default `kind`)
  lists the items it paid for, at least one; a `refund` lists none. Amounts
  are positive: what was paid, or what came back. An item's amount is its line
  price, quantity times unit price, and may be negative for a discount.
  Shipping and tax are items too. `key` is the job's name for the charge,
  unique within the order and kind: Amazon's dispatch mail, or `payment` for
  PayPal's one charge.
* Sizes: a charge holds at most 100 items, an item's text and the merchant at
  most 500 characters, `order_key` and `key` at most 200. An order holds at
  most 50 charges.

Amazon charges each shipment on its own, so an Amazon order has one charge per
shipment, each matched to its own booking. A digital order, which ships
nothing, is one charge.

An order sent again with nothing new is `unchanged` and changes nothing. A
charge the post leaves out stays, since the job reads only recent mail and an
old shipment falls out of its window. A charge not matched yet takes what the
post says; one already matched keeps what it had. A post with no `total`
keeps the total and day an order already has: the job sends none when it found
no order confirmation, and the day it sends then is a stand-in. A `422` refuses a charge with
no items, a refund with items, two charges of one kind under one key, a
`source` other than the two, or anything past the sizes above.

### How a charge finds its booking

A charge matches a booking that:

* has the opposite amount, or for a refund the same amount, in the order's
  currency;
* was booked from 3 days before the charge to 10 days after, or 14 for a
  refund, or 30 when it names the order id;
* names the source in its purpose or counterparty;
* is no move between own accounts, its other half in or not;
* and is held by no other charge.

The banks write these bookings in two shapes. Amazon's direct debit starts
with the order id: `123-4567890-1234567 AMZNMktp DE 5ABC4DEF5GHI6JKL
FOLGELASTSCHRIFT`, or `D01-...` for a digital order. PayPal's names the shop:
`1059876543210/PP.4711.PP/. Example Shop B.V., Ihr Einkauf bei Example Shop
FOLGELASTSCHRIFT`, the legal name before the comma and the shop's own after
"Ihr Einkauf bei", and a refund to the bank `. Example Shop B.V., Ihr Einkauf
bei ... GUTSCHR. UEBERWEISUNG`. The leading number is PayPal's debit
reference, which the mail does not carry.

An Amazon booking matches only when it names the order id. A PayPal booking
in the shape above matches when either of its two names is the mail's
merchant, compared casefolded, with spaces, dots and legal forms (GmbH, B.V.,
Inc., Ltd., S.a.r.l. and the like) taken out. They are one shop when one
starts the other, as PayPal cuts a long name short in its mails: `Apple` is
`Apple Services`, but `Otto` is not `Lotto24`. A name under four letters
must match whole, so `C&A` is not `Carl Zeiss`. An Amazon order paid with
PayPal is a PayPal order of its own: its booking carries no Amazon order id,
so the Amazon order's shipments never take it. One that names no shop at all,
`. , Ihr Einkauf bei`, fits money sent to a person. A booking that names
another shop, or is in no such shape (a card payment `PAYPAL *SHOP`), never
matches.

Of the bookings that fit, one that names the order id wins over one that
names the merchant, which wins over one that names no shop. Bookings that name an order id go first, in a pass of their
own. Two bookings that fit alike leave the charge `ambiguous`; kasten never
guesses. The one exception: two bookings that both name the order id are two
shipments of one amount, so the older takes the first shipment and the other
the next. Charges go oldest first, so of two that fit
one booking, the older takes it.

A charge whose items do not add up to it is never matched (`items_off`): the
splits must add up to the booking exactly, and a set that does not would count
money twice or not at all.

### What a match does to the booking

* A `charge` splits its booking into its items, the booking's own category
  goes, and the rules sort each item by its text
  ([how the rules fire](/reference/http-api/finance-sorting.md)). A part
  whose own text no rule names takes a text rule on the booking's purpose,
  so an `amzn` rule still sorts it as it sorted the whole booking. A part no
  rule sorts waits in the to-sort list. Status `split`.
* A discount or credit (an item below zero) is no part of its own: it would
  be money in on a booking of money out, which no spending rule sorts and the
  budget skips, so the items would count more than was paid. It is shared out
  over the other items by their amounts, to the cent, the cents rounding
  leaves going to the largest first, so the parts still add up to the
  booking.
* A booking the owner sorted by hand, or split by hand, stays exactly as it is:
  kasten links the charge to it and writes nothing. Status `kept`. The booking
  view shows the order's items beside it, and the owner can split it by hand
  from them.
* Splits the owner takes away by hand afterwards
  ([`PUT .../splits`](/reference/http-api/finance.md) with none) stay away:
  status `unsplit`, never split again. Splits the owner rewrites read as
  `kept`.
* A `refund` is linked to its own booking of money in and never split. Status
  `linked`.
* Amazon sends no refund mail the job reads. A booking of money in that names
  a stored Amazon order id, booked up to 180 days after the order, becomes
  that order's refund, keyed `booking-<id>`.

Matching runs after every post here and after every
[`POST /api/finance/transactions`](/reference/http-api/finance.md#post-apifinancetransactions),
for the charges whose window the new bookings fall in, so an order may come
before or after its booking. Both take the sorting lock first, so two posts
take turns.

## GET /api/finance/orders/unmatched

The newest orders with a charge or refund no booking holds yet, or with no
charge at all yet (an Amazon order not dispatched). The finance pane lists them
under To sort. `limit` is 1 to 500, 50 by default.

```json
[
  {
    "id": 4, "source": "paypal", "order_key": "1AB23456CD789012E", "ordered_on": "2026-10-17",
    "merchant": "Example Shop GmbH", "total": "30.00", "currency": "EUR",
    "charges": [
      {
        "id": 9, "kind": "charge", "key": "payment", "charged_on": "2026-10-17", "amount": "30.00",
        "transaction_id": null, "status": "ambiguous",
        "items": [ { "text": "Garden book", "amount": "18.50" } ]
      }
    ]
  }
]
```

`status` is where a charge stands:

| Status | Meaning |
|---|---|
| `waiting` | No booking found yet. The bank may not have booked it. |
| `ambiguous` | More than one booking fits alike. |
| `items_off` | Its items do not add up to it, so it is never matched. |
| `split` | Matched; the booking is split into its items. |
| `kept` | Matched to a booking split or sorted by hand, left as it was, or whose splits the owner rewrote. |
| `unsplit` | Matched and split, then the owner took the splits away. |
| `linked` | A refund, matched. |

The order a booking paid shows in
[`GET /api/finance/drill/bookings/{transaction_id}`](/reference/http-api/finance-drill.md#get-apifinancedrillbookingstransaction_id)
as `order`.
