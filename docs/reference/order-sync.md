---
type: Reference
title: Order sync
description: The order mail job's commands and exit codes, its env file and Gmail login on the server, the mails it reads and the orders it makes of them.
resource: jobs/src/kasten_jobs/order_sync.py
tags: [finance, jobs, gmail]
status: draft
---

# Order sync

The job in `jobs/` that reads PayPal and Amazon order mails from Gmail and
sends the orders through
[`POST /api/finance/orders`](/reference/http-api/finance-orders.md). Kasten
matches each charge to its bank booking and splits it into items; the job only
gathers. It ships in the `kasten-backend` image as the command
`kasten-order-sync`, and runs as a one-shot container on the docker network
`web`. Setting it up is [Run the order sync](/how-to/run-the-order-sync.md).

It only reads mail. It never labels, moves, archives or sends one.

## Commands

| Command | What it does | Exit code |
|---|---|---|
| `sync [--days N]` | Reads the last `N` days of order mail (`ORDER_SYNC_DAYS`) and sends every order in it. | `0` kasten took the orders, or some of them; `1` it took none, Gmail refused the login, or kasten did not answer |
| `show [--days N]` | Reads the same mail and prints the orders as JSON, sending nothing. For checking what the job makes of the mail. | `0` |

Every run sends every order it finds, not only new ones: an order sent again
changes nothing, so a failed run or a missed day costs nothing. A mail in no
shape the job knows is passed over, and a dispatch mail it cannot read logs a
warning. A mail Gmail will not hand over, or that breaks a parser, is skipped
with a warning naming it, and the run's last line counts the mails skipped. A
batch kasten refuses with a `422` is sent again order by order, so an order
kasten will not take costs only that order, logged with kasten's reason. A refused Gmail login stops the job with `Google refused the login`
and exit `1`: the refresh token was revoked, or its login done again.

## The env file

Read with `docker run --env-file`. Mode `600`. `jobs/order-sync.env.example` in
the repo lists them all.

| Variable | Default | Meaning |
|---|---|---|
| `KASTEN_API` | `http://kasten-backend-prod:8000` | The backend, by its name on `web` |
| `ORDER_SYNC_GMAIL_CREDENTIALS` | `/gmail.json` | The Gmail login inside the container |
| `ORDER_SYNC_DAYS` | `60` | How many days of mail each run reads |
| `TZ` | UTC | The box's zone, `Europe/Berlin`, so a mail at 00:30 counts for its own day |

## Files on the server

| Path | Mode | Holds |
|---|---|---|
| `~/.config/kasten/order-sync.env` | `600` | The env file |
| `~/.config/kasten/gmail.json` | `600` | The Gmail login, mounted read-only at `/gmail.json`: what `gws auth export --unmasked` prints, an OAuth client id and secret and a refresh token |
| `~/.config/kasten/gws/` | `700` | The gws config folder of that login, kept apart from the one mail triage uses |

None of it is in the repo or in `~/kasten-data/`, which holds data only.

## Reaching Gmail

The gws CLI's own login lives on the host, its key in the OS keyring, out
of a container's reach. So the job does not run gws. Each run trades the
exported refresh token for an access token at
`https://oauth2.googleapis.com/token` and reads the Gmail REST API with it:
one search, then each message in full. The container needs to reach Google,
which `web` allows, as the bank sync reaches the banks.

The token holds whatever scopes its login granted. The how-to makes a login
of its own with read-only Gmail, so a leaked file reads mail and does nothing
else.

## The mails it reads

One search, `from:(bestellbestaetigung@amazon.de OR
versandbestaetigung@amazon.de OR service@paypal.de) newer_than:<days>d`:

| Sender | Mail | Becomes |
|---|---|---|
| `bestellbestaetigung@amazon.de` | Order confirmation, in English ("Order #", "Total") | The order: its id, day and total. No charge: Amazon charges at dispatch |
| `bestellbestaetigung@amazon.de` | Digital order, in German ("Bestellnr.", "Gesamtsumme") | The order and its one charge at the total with tax, the titles as one item |
| `versandbestaetigung@amazon.de` | Dispatch ("Order #", items, "Total") | One charge, keyed by the mail's id, with its items |
| `service@paypal.de` | Receipt with a transaction code | The order, keyed by the code, and its one charge `payment` |
| `service@paypal.de` | "Deine Rückzahlung über ..." | A refund of the payment it names, keyed by the mail's id |

Amazon's tracking and delivery mails carry no charge and are not read. The
dispatch's lines are `Quantity: n` and the unit price, so an item's amount is
the two multiplied; the total is rounded to the cent, since Amazon writes sums
such as `23.979999999999997 EUR`. A dispatch that names two orders is skipped.

Items keep the names the mail gives them, with no shop in front, so a rule on
an item beats a rule on the shop; a part no rule names takes the rule that
sorts its booking. Shipping, tax
and a discount are items of their own. A receipt that lists no items, or whose
lines do not add up to its total, is one item in the shop's name for the
whole. Money sent to a person is one item in their name. A payment in another
currency is skipped. A payment to Amazon through PayPal stays a PayPal order,
which is what its booking can match. An item text or a merchant longer than
kasten's 500 characters is cut there.

### What the window leaves out

A run reads the last `ORDER_SYNC_DAYS`, so what came earlier than what names
it may be missing:

* a dispatch whose order confirmation is older: the job searches for the
  confirmation by the order id, and failing that sends the order with the
  dispatch's day and no total;
* a PayPal refund whose payment is older: the job searches the payment mails
  from the day before the payment to the day after, and takes the one of the
  refund's amount and the shop's first word. A refund with no payment found is
  left out with a warning.

Kasten keeps every charge it was ever sent, so an old shipment that falls out
of the window stays.
