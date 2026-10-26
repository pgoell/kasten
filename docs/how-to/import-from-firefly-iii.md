---
type: How-to Guide
title: Import from Firefly III
description: A one-off. Bring Firefly III's history into kasten once, with its accounts, bookings, categories and rules, from a one-shot container on the server; count first with a dry run, then import, then check a second run changes nothing.
tags: [finance, jobs, firefly, deploy]
status: draft
---

# Import from Firefly III

The import reads Firefly III's database and writes its history into kasten
through [the finance routes](/reference/http-api/finance.md). It never writes to
Firefly and never to kasten's database directly. What it takes, the key it
stores each booking by and every count it prints are in
[Firefly import](/reference/firefly-import.md).

This is a one-off. It ran once on the maintainer's server, on 2026-10-25, and
Firefly III there is retired since (#1041). Its final dump is
`~/backups/firefly/firefly-final-<date>.sql.gz`. To run the import again from
that dump, restore it into a database `firefly` in the `postgres` container
first, and put the role you restore it under into `FIREFLY_DATABASE_URL`: with
no `firefly` container, the `docker inspect` in step 1 finds nothing.

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
  "$image" kasten-firefly-import --dry-run --skip-journal 1140 --skip-journal 1141
```

Journals 1140 and 1141 are doubles the old importer wrote of journal 1075, a
transfer of 10,000 on 2026-05-30 with the same description, made 14 and 15
days after it. `--skip-journal` leaves them out; `FIREFLY_SKIP_JOURNALS=1140,1141`
in the env file does the same. Journals 992 and 994, two transfers of 1,000 on
2026-05-04 with different descriptions, share a key but are two real moves:
keep both, and they become `:0` and `:1`. On another Firefly, look for doubles
among the twins the dry run counts, and skip only those.

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
  "$image" kasten-firefly-import --skip-journal 1140 --skip-journal 1141
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
* [Run the bank sync](/how-to/run-the-bank-sync.md): its first pull of an account starts two weeks before the newest day
  the import stored, and skips what the import already holds.
