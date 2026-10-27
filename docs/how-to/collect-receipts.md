---
type: How-to Guide
title: Collect receipts
description: Get tax receipts into kasten from the finance pane, the phone and Gmail, run the receipt job that collects mail and reads each receipt with headless Claude Code on your subscription, and confirm what kasten proposes.
tags: [finance, tax, receipts, jobs, gmail, deploy]
status: draft
---

# Collect receipts

The Finanzamt asks for receipts only when it wants to see one, but by then
they should be in one place. Kasten keeps them beside the vault, never in it,
each on the booking it paid. The routes are in
[HTTP API: finance receipts](/reference/http-api/finance-receipts.md); the
job's commands and settings are in [Receipt jobs](/reference/receipt-jobs.md).

A receipt is a PDF, JPEG or PNG of up to 20 MB, a photo at most 7 MB. An iPhone's HEIC photo is not
taken: export it as JPEG or PDF and drop it on its booking in the pane.

## From the finance pane

Open the booking (from Transactions, or a drilldown) and drop the file on its
**Tax and receipts** card, or press **Add a receipt**. The same file dropped
twice is kept once. Mark the booking there too: pick the line, and type the
tax amount when only part of the booking counts, such as the labour on a
craftsman's invoice or your share of a bill on the shared account.

## From the phone

With kasten installed on Android ([Install kasten on your phone](/how-to/install-on-your-phone.md)),
share a PDF or a photo from any app and pick **kasten**. The capture page
opens and says how many receipts it kept; they wait under Finance, To sort,
on no booking. With no signal the file does not go; share it again later.

## From Gmail

Put the label `Receipt` on each mail that carries a receipt as a PDF, by hand
or with a Gmail filter. To use another label, set `RECEIPTS_LABEL` in the env
file below. The receipt job sends kasten every PDF of those mails
from the last 30 days on each run; a file it sent before changes nothing.

The job reuses the order sync's read-only Gmail login,
`~/.config/kasten/gmail.json`. Make it first if you have not:
[Run the order sync](/how-to/run-the-order-sync.md#1-make-a-read-only-gmail-login).

## Set up the receipt job

The same job reads each receipt with headless Claude Code on your Claude
subscription: the date, the total, who issued it, the labour share on a
craftsman's or household service invoice, and the line it likely belongs on.
No API key is needed. Each receipt counts against the subscription's usage
limits like any other Claude Code session, and may cost money when the plan
has extra usage turned on; when the limit is reached, the run stops and the
next one reads the rest.

It needs Claude Code installed on the host, at `~/.local/bin/claude`: the job
mounts that binary into its container, since kasten's public image does not
carry it.

1. Make a token for the subscription. It opens a login in the browser and
   prints a long-lived token:

   ```sh
   claude setup-token
   ```

2. Write the env file, then put the token in it as
   `CLAUDE_CODE_OAUTH_TOKEN` with an editor, never on the command line, where
   the shell history would keep it:

   ```sh
   install -m 600 ~/Code/kasten/jobs/receipts.env.example ~/.config/kasten/receipts.env
   ```

   Write each value bare, never in quotes: docker's `--env-file` keeps quotes
   as part of the value.

3. Name the command once. Every run is a container of the image the backend
   runs, with the host's `claude` mounted in:

   ```sh
   receipts() {
     sg docker -c "docker run --rm --network web --user $(id -u):$(id -g) \
       --env-file $HOME/.config/kasten/receipts.env \
       --mount type=bind,src=$HOME/.config/kasten/gmail.json,dst=/gmail.json,readonly \
       --mount type=bind,src=$HOME/.local/bin/claude,dst=/usr/local/bin/claude,readonly \
       $(docker inspect -f '{{.Config.Image}}' kasten-backend-prod) \
       kasten-receipts $*"
   }
   ```

4. Run it once: `receipts run; echo "exit $?"`. The log says how many mail
   PDFs were new and how many receipts were read.

5. Start the timer. `kasten-receipts.service` and `.timer` in server-infra's
   `jobs/` run `kasten-receipts run` every hour:

   ```sh
   systemctl --user daemon-reload
   systemctl --user enable --now kasten-receipts.timer
   ```

## Confirm what kasten proposes

Under Finance, To sort, each receipt on no booking shows what the reader
found and up to three bookings it may have paid: money out of that amount,
near that date, the one that names the payee first. A button per booking
says the mark kasten would set, such as "§35a Handwerker (Arbeitskosten)
300,00 €". Press the right one: kasten puts the receipt on that booking and
marks it. Nothing is linked or marked before you press.

When no booking fits, the bank may not have sent it yet; it shows up after the
next bank pull. Or drop the file on the booking by hand. **Put aside** takes a
file that is no tax receipt out of the queue.

On the shared account kasten proposes no amount: the button asks for your
share. A booking you marked already keeps its mark; kasten asks before
replacing it. A §35a mark needs the labour share as its tax amount, never the
whole invoice.

## Read the tax year

The finance pane's **Tax** tab (`X`) shows the year by the day paid: what
counts on each line, the Werbungskosten over that year's allowance (€1,230
from 2023), the marked bookings still missing a receipt, and money back that may pay a marked cost
back. An employer paying a work cost back is no Werbungskosten: mark the money
in on the same line and it comes off. `[` and `]` step the year. Each line
downloads as CSV, and **Every receipt of the year** as a ZIP with the files
named `YYYY-MM-DD_payee_amount.pdf`, for the ELSTER form and a Finanzamt that
asks.
