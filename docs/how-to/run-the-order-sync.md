---
type: How-to Guide
title: Run the order sync
description: Set up the PayPal and Amazon order mail job on the server with a read-only Gmail login in ~/.config/kasten, check what it makes of the mail, run it on a systemd timer, and read the orders no booking holds yet.
tags: [finance, jobs, gmail, deploy]
status: draft
---

# Run the order sync

PayPal and Amazon bookings say little about what was bought. The order sync
reads their order mails from Gmail and sends kasten each order, and kasten
splits the booking that paid it into the items, so each item lands in its own
category. The job only reads mail. Its commands, settings and the mails it
reads are in [Order sync](/reference/order-sync.md); how a charge finds its
booking is in [HTTP API: finance orders](/reference/http-api/finance-orders.md).

You need a running prod kasten with a database whose bank sync brings in the
bookings ([Run the bank sync](/how-to/run-the-bank-sync.md)), and the gws CLI
on the server with the OAuth client the mail triage uses.

## 1. Make a read-only Gmail login

The job gets a login of its own, kept apart from the one mail triage uses,
which may change mail. It only reads, so it asks only for that. Logins and
state live in `~/.config/kasten/`, never in the repo and never in
`~/kasten-data/`.

```sh
install -d -m 700 ~/.config/kasten ~/.config/kasten/gws
install -m 600 ~/.config/gws/client_secret.json ~/.config/kasten/gws/
export GOOGLE_WORKSPACE_CLI_CONFIG_DIR=~/.config/kasten/gws GOOGLE_WORKSPACE_CLI_KEYRING_BACKEND=file
gws auth login --readonly -s gmail
```

Open the link gws gives, sign in as the Gmail account the order mails come
to, and allow read access. Then write the login where the job reads it:

```sh
(umask 077; gws auth export --unmasked > ~/.config/kasten/gmail.json)
unset GOOGLE_WORKSPACE_CLI_CONFIG_DIR GOOGLE_WORKSPACE_CLI_KEYRING_BACKEND
```

The file holds a refresh token: anyone with it reads the mailbox. Keep it at
mode `600`. Running `gws auth export --unmasked` on the mail triage login
works too, but that token can also change mail.

## 2. Write the env file

```sh
install -m 600 ~/Code/kasten/jobs/order-sync.env.example ~/.config/kasten/order-sync.env
```

It holds no secret; the defaults fit the prod box. Write each value bare,
never in quotes: docker's `--env-file` keeps quotes as part of the value.

## 3. Name the command once

Every run is a container of the image the backend runs, so the job always
matches the route it writes through:

```sh
order_sync() {
  sg docker -c "docker run --rm --network web --user $(id -u):$(id -g) \
    --env-file $HOME/.config/kasten/order-sync.env \
    -v $HOME/.config/kasten/gmail.json:/gmail.json:ro \
    $(docker inspect -f '{{.Config.Image}}' kasten-backend-prod) \
    kasten-order-sync $*"
}
```

The login is mounted read-only; the job writes nothing back.

## 4. Check what it reads

```sh
order_sync show --days 30 | jq '.[] | {source, order_key, merchant, total, charges: [.charges[] | {kind, amount, items: (.items // [] | length)}]}'
```

Each PayPal payment should show one charge, each Amazon dispatch one, and a
digital Amazon order one. An Amazon order with no charge has not been
dispatched yet.

## 5. Run it once

```sh
order_sync sync --days 120; echo "exit $?"
```

The first run may read further back than the 60 days a daily run reads. The
log says how many orders were new and how many charges met their booking.

## 6. Start the timer

`kasten-order-sync.service` and `.timer` in server-infra's `jobs/`, beside the
bank sync. The service is a one-shot container like the bank sync's, with the
login mounted read-only and `TimeoutStartSec=15min`; it fails into
`job-failed@.service`. The timer runs it daily at 17:30 local time, after the
17:00 bank pull, with `Persistent=true`. The order matters little: an order
whose booking is not in yet waits, and the next bank pull matches it.

```sh
systemctl --user daemon-reload
systemctl --user enable --now kasten-order-sync.timer
```

## Read what did not match

The finance pane lists the orders no booking holds yet under To sort, with
why: no booking yet, two that fit alike, or items that do not add up. Or:

```sh
api="http://$(docker inspect -f '{{.NetworkSettings.Networks.web.IPAddress}}' kasten-backend-prod):8000"
curl -sS "$api/api/finance/orders/unmatched" | jq '.[] | {merchant, ordered_on, charges: [.charges[] | {amount, status}]}'
journalctl --user -u kasten-order-sync.service -n 50
```

An order that waits for long was paid some other way: from the PayPal
balance, with a gift card, or on an account kasten does not track. It does no
harm there.

## A booking you sorted by hand

Kasten never rewrites a booking you sorted or split by hand. When an order
matches one, kasten links it and leaves the booking as it was. The booking's
view in the finance pane shows the order and its items with a note saying so;
to use the items, split the booking by hand from them.

## Sorting the items

Each item is sorted by the rules, reading the item's text: a text rule
`garden` sends a "Garden hose" to its category. PayPal items carry the shop's
name, so a rule on the shop still sorts them. An item no rule sorts waits in
the to-sort list. Give PayPal or Amazon no "always for this payee": that
default would take every item no text rule sorts ([Sort finance
transactions](/how-to/sort-finance-transactions.md)).

## When Google refuses the login

`Google refused the login` in the journal means the refresh token was revoked
or its login done again. Do step 1 again.
