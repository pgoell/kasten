---
type: How-to Guide
title: Import from Firefly III
description: Bring Firefly III's history into kasten once, with its accounts, bookings, categories and rules, from a one-shot container on the server; count first with a dry run, then import, then check a second run changes nothing.
tags: [finance, jobs, firefly, deploy]
status: draft
---

# Import from Firefly III

The import reads Firefly III's database and writes its history into kasten
through [the finance routes](/reference/http-api/finance.md). It never writes to
Firefly and never to kasten's database directly. What it takes, the key it
stores each booking by and every count it prints are in
[Firefly import](/reference/firefly-import.md).

You need a prod kasten with a database
([Deploy to the VPS](/how-to/deploy-to-the-vps.md)) on a release that carries
`jobs/`, and Firefly's Postgres running as the container `postgres` on the
docker network `web`. Check the command is in the image:

```sh
image=$(docker inspect -f '{{.Config.Image}}' kasten-backend-prod)
docker run --rm "$image" kasten-firefly-import --help
```

## 1. Write the env file

Secrets live in `~/.config/kasten/`, never in the repo.

```sh
install -d -m 700 ~/.config/kasten
install -m 600 ~/Code/kasten/jobs/firefly-import.env.example ~/.config/kasten/firefly-import.env
$EDITOR ~/.config/kasten/firefly-import.env
```

Put Firefly's database user and password into `FIREFLY_DATABASE_URL`. They are
the ones the Firefly container runs with:

```sh
docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' firefly | grep -E '^DB_(USERNAME|PASSWORD)='
```

## 2. Count first

```sh
docker run --rm --network web --env-file ~/.config/kasten/firefly-import.env \
  "$image" kasten-firefly-import --dry-run
```

The dry run reads Firefly and prints counts only: accounts, bookings per
account, transfers, twins, categories, and the rules it would make and the
ones it cannot. It writes nothing.

## 3. Import

The hourly finance dump runs before you import
([Back up and restore](/how-to/back-up-and-restore.md#the-finance-dump-on-the-maintainers-server)),
so `~/backups/kasten-finance/` holds the schema as it was; to take a fresh one
first, `systemctl --user start kasten-finance-backup.service`.

```sh
docker run --rm --network web --env-file ~/.config/kasten/firefly-import.env \
  "$image" kasten-firefly-import
```

It makes the categories, the rules and the accounts, posts every booking,
runs the rules once and then sets by hand each category Firefly holds that the
rules give otherwise. A few seconds for 1,400 bookings. `categories set by hand`
says how many it had to set.

## 4. Check a second run changes nothing

Run step 3 again. Every booking comes back as `bookings already there`, and
`categories created`, `rules created`, `rules run changed` and
`categories set by hand` are all `0`.

Run it only while Firefly is still the record. Once you sort bookings in
kasten, a later run puts Firefly's category back on every imported booking you
changed.

## Then

* Sort what is left in the finance pane:
  [Sort finance transactions](/how-to/sort-finance-transactions.md).
* Look over each category's kind in kasten. The import guesses one from the
  name ([the table](/reference/firefly-import.md#category-kinds)).
* [Run the bank sync](/how-to/run-the-bank-sync.md): its first pull of an account starts on the newest day
  the import stored.
