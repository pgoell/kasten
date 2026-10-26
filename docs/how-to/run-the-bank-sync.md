---
type: How-to Guide
title: Run the bank sync
description: Set up the bank sync job on the server, with its env file and FinTS state in ~/.config/kasten, log in to each bank once, start it on systemd timers, ask for a pull now, and read the status.
tags: [finance, jobs, fints, deploy]
status: draft
---

# Run the bank sync

The bank sync pulls each bank account over FinTS and writes the bookings and
balances into kasten. Kasten itself never talks to a bank: the job does, from a
one-shot container on the docker network `web`, started by systemd timers. Its
commands, settings and source key are in [Bank sync](/reference/bank-sync.md).

You need a running prod kasten with a database
([Deploy to the VPS](/how-to/deploy-to-the-vps.md)), a bank with FinTS access
and a push TAN (the DKB app, VR SecureGo plus), and the phone that approves it.

## 1. Write the env file

Logins and state live in `~/.config/kasten/`, never in the repo and never in
`~/kasten-data/`, which holds data only.

```sh
install -d -m 700 ~/.config/kasten ~/.config/kasten/fints
install -m 600 ~/Code/kasten/jobs/bank-sync.env.example ~/.config/kasten/bank-sync.env
$EDITOR ~/.config/kasten/bank-sync.env
```

Fill in `DKB_LOGIN`, `DKB_PIN`, `PSD_LOGIN` and `PSD_PIN`; the rest has its
defaults. Write each value bare, `DKB_PIN=12345`, never in quotes: docker's
`--env-file` keeps quotes as part of the value, and the bank refuses the PIN.
Drop a bank you do not have from `BANK_SYNC_BANKS`, and list an account the
bank shows that kasten should not track, such as a depot, in
`BANK_SYNC_SKIP_IBANS`.

## 2. Name the command once

Every run is the same container, of the image the backend runs, so the job
always matches the routes it writes through:

```sh
bank_sync() {
  sg docker -c "docker run --rm -it --network web --user $(id -u):$(id -g) \
    --env-file $HOME/.config/kasten/bank-sync.env \
    -v $HOME/.config/kasten/fints:/state \
    $(docker inspect -f '{{.Config.Image}}' kasten-backend-prod) \
    kasten-bank-sync $*"
}
```

`--env-file` is read by docker on the host, so the env file is never mounted.
Only the state folder is, read-write, because each run writes the state back.
`--user` keeps the state files yours rather than root's.

## 3. Log in to each bank once

If the Firefly importer ran on this box, its state is already a login: reuse
it rather than run setup. The job builds its client from the same product id,
mode, BLZ and login, on python-fints 5.0.0 as the importer did, so the bank
sees the same client. The importer must stay stopped from here on: two clients
writing one bank's state fall out of step with the bank.

On the maintainer's server this is done, and the importer is archived under
`~/backups/` since Firefly III was retired (#1041).

```sh
install -m 600 ~/Code/firefly-importer/state/dkb.bin ~/Code/firefly-importer/state/psd.bin \
  ~/.config/kasten/fints/
```

Otherwise, with the phone at hand:

```sh
bank_sync setup dkb
bank_sync setup psd
```

Each approves a TAN, lists the bank's TAN methods and accounts, switches to the
push TAN method, and writes `~/.config/kasten/fints/<bank>.bin` with mode `600`.
A warning that no push method exists means the bank's app approval is off: turn
it on in the bank's app and run setup again.

## 4. Make the accounts

The job matches the bank's accounts to kasten's by IBAN and never makes one, so
each IBAN setup listed needs an account. Skip any the Firefly import made:

```sh
api="http://$(docker inspect -f '{{.NetworkSettings.Networks.web.IPAddress}}' kasten-backend-prod):8000"
curl -sS "$api/api/finance/accounts" -H 'content-type: application/json' \
  -d '{"name": "DKB Girokonto", "bank": "DKB", "iban": "DE02120300000000202051", "kind": "giro"}'
```

An IBAN no account holds fails the run and names the IBAN.

## 5. Pull once by hand

```sh
bank_sync pull; echo "exit $?"
```

Approve the push TAN within four minutes. `0` means every account came in.
A first pull starts two weeks (`BANK_SYNC_OVERLAP_DAYS`) before the newest
booking stored for the account, else 90 days back.

## 6. Start the timers

Three user units in server-infra's `jobs/`, beside the other jobs there. Every
minute a poll that ends at once unless "pull now" waits; one pull a day; and a
check that fails when no pull has succeeded for a week. Each fails into
`job-failed@.service`, which logs at error priority and stays failed, so
`systemctl --user --failed` shows it. Each stops the job at 25 minutes
(`TimeoutStartSec=`), short of the 30 minutes after which kasten lets the next
run start beside an unfinished one.

`kasten-bank-sync-poll.service`:

```ini
[Unit]
Description=Pull the banks into kasten when a "pull now" waits
OnFailure=job-failed@%n.service

[Service]
Type=oneshot
Environment=PATH=/usr/bin:/bin
TimeoutStartSec=25min
# Asks kasten first, without a container: a 404 (nothing waits) or no answer
# fails the condition, which systemd counts as a skip, not a failure.
ExecCondition=/usr/bin/sg docker -c 'curl -sf -o /dev/null \
  "http://$$(docker inspect -f "{{.NetworkSettings.Networks.web.IPAddress}}" kasten-backend-prod):8000/api/finance/sync/requests/open"'
# The image the backend runs, so the job matches its routes after every
# deploy. `$$` is a literal `$` for the shell, not a systemd variable.
ExecStart=/usr/bin/sg docker -c 'docker run --rm --network web --user 1000:1000 \
  --env-file /home/pascal/.config/kasten/bank-sync.env \
  -v /home/pascal/.config/kasten/fints:/state \
  "$$(docker inspect -f "{{.Config.Image}}" kasten-backend-prod)" kasten-bank-sync poll'
```

`kasten-bank-sync-poll.timer`:

```ini
[Unit]
Description=Ask kasten every minute whether a bank pull waits

[Timer]
OnCalendar=minutely
AccuracySec=1s

[Install]
WantedBy=timers.target
```

`kasten-bank-sync.service` is the poll service with `Description=Pull the banks
into kasten`, `pull` in place of `poll`, and no `ExecCondition=`. Keep
`TimeoutStartSec=25min`. `kasten-bank-sync.timer` runs it once a day; pick an
hour the phone is at hand. `OnCalendar=` times are the box's local time,
Europe/Berlin:

```ini
[Timer]
OnCalendar=*-*-* 17:00
Persistent=true
```

`kasten-bank-sync-check.service` is the same with `check`, again with
`TimeoutStartSec=25min` and no `ExecCondition=`, and its timer runs it at
`*-*-* 09:00` local time with `Persistent=true`. Then:

```sh
systemctl --user daemon-reload
systemctl --user enable --now kasten-bank-sync-poll.timer kasten-bank-sync.timer kasten-bank-sync-check.timer
```

A poll, a pull and a manual run cannot pull at once: kasten lets one run start
at a time and the others exit `0`.

## Pull now

Until the finance pane has a button, post the request:

```sh
curl -sS -X POST "$api/api/finance/sync/requests"
```

Within a minute the poll starts a pull and the phone shows the push TAN.

## Read the status

```sh
curl -sS "$api/api/finance/sync" | jq
journalctl --user -u kasten-bank-sync-poll.service -n 50
```

The status names the last run and its error, and per account the last good
window and the days since
([`GET /api/finance/sync`](/reference/http-api/finance-sync.md#get-apifinancesync)).
After a failure, clear it once you have looked:

```sh
systemctl --user reset-failed job-failed@kasten-bank-sync-poll.service.service
```

## When the bank refuses the state

A PIN change, or a bank that forgets the system id, fails every login. Run
`bank_sync setup <bank>` again; it starts from the saved state and writes a new
one.
