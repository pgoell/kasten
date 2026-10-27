---
type: Reference
title: Receipt jobs
description: The receipt job's commands and exit codes, its env file, the Gmail search it sends PDFs from, and how the reader reads a receipt with headless Claude Code and what it sends kasten back.
resource: jobs/src/kasten_jobs/receipts.py
tags: [finance, tax, receipts, jobs, gmail, claude, claude-code]
status: draft
---

# Receipt jobs

The job in `jobs/` that collects receipts from Gmail and reads every receipt
kasten holds unread. It ships in the `kasten-backend` image as the command
`kasten-receipts` and runs as a one-shot container on the docker network
`web`, writing through [HTTP API: finance receipts](/reference/http-api/finance-receipts.md).
Setting it up is [Collect receipts](/how-to/collect-receipts.md).

It only reads mail. It never labels, moves or sends one, and it never links a
receipt or sets a mark: kasten proposes, the owner confirms.

## Commands

| Command | What it does | Exit code |
|---|---|---|
| `mail` | Sends kasten each PDF attached to a mail of the last `RECEIPTS_DAYS` days under the label, with `source` `mail`. | `0`; `1` when Gmail refuses the login or kasten does not answer |
| `read` | Reads each unread receipt with Claude Code and sends kasten the reading. | `0`; `1` when `CLAUDE_CODE_OAUTH_TOKEN` is not set, the setup is wrong, or the run stopped (usage limit, rate limit, server error, no connection, a hung Claude Code, 3 receipts in a row with no answer) |
| `run` | `mail`, then `read`. | as `read` |

`mail` searches `label:"Receipt" has:attachment filename:pdf newer_than:30d`, with
`RECEIPTS_LABEL` and `RECEIPTS_DAYS` in place of `Receipt` and `30`,
and sends every PDF part of each mail, whether Gmail names it
`application/pdf` or only by its `.pdf` name. Kasten keeps a file once by its
hash, so every run sends the whole window again and changes nothing it has. A
mail Gmail will not hand over is skipped and counted; a file kasten refuses is
logged with kasten's reason.

`read` takes the unread receipts oldest first and, for each:

* writes it whole into a fresh temporary folder, as `receipt.pdf`,
  `receipt.png` or `receipt.jpg`, and runs `claude -p` there, which reads
  it with its Read tool and answers JSON in a fixed schema;
* sends kasten what came back as a reading. A field that does not parse, such
  as an amount that is no number, `NaN`, infinite, or of 10^12 or more, is
  left out rather than sent wrong.

What happens when a receipt gets no answer:

| What | Then |
|---|---|
| The model declines the file, or says it is no receipt | a reading with `error` saying so; the receipt is done |
| The file is too large (`413`), or Claude Code ends with `image_error` or `prompt_too_long` | a reading with `error` and Claude Code's reason; the receipt is done |
| A result without the schema's JSON | asked again, up to 3 times in the run; then a reading with `error`, and done |
| 3 receipts in a row end that way | the run stops at the third with exit `1`; it and the rest stay unread |
| Kasten refuses the reading (`422`), such as an amount no booking can hold | the refusal is sent back as the reading's `error`; the receipt is done |
| Kasten has no file for it | skipped, tried again next run |
| The subscription's usage limit (`blocking_limit`), a rate limit, overload, a server error, no connection, or any other error Claude Code reports | the run stops there with exit `1`; the rest wait for the next run |
| Claude Code takes more than 180 seconds | as above: the run stops, the receipt stays unread |
| The token is missing, wrong or expired, the model is not there or not on the plan, Claude Code is too old, or the API refuses the request (`400`, `401`, `403`, `404`) | the job fails at once with Claude Code's message; the receipt stays unread |
| Claude Code prints no JSON result at all, as after an update that drops a flag | as above |

A receipt that ends with an error reading is never read again, and a file
that cannot be read does not fail the run.

A reading kasten has can be dropped with
[`DELETE /api/finance/receipts/{id}/reading`](/reference/http-api/finance-receipts.md#delete-apifinancereceiptsreceipt_idreading)
for the next run to read the receipt again.

## The Claude Code run

One run of headless Claude Code per receipt, on the owner's Claude
subscription, in the temporary folder that holds only the receipt:

```sh
claude -p "Read the receipt at ./receipt.pdf." \
  --model "$RECEIPTS_MODEL" --effort low \
  --system-prompt "<the reader's instructions>" \
  --output-format json --json-schema '<the schema>' \
  --restricted --tools Read --allowedTools Read --permission-mode dontAsk \
  --strict-mcp-config --no-session-persistence
```

The answer is the result's `structured_output`: `is_receipt`, `date`,
`total`, `payee`, `labour` and `form_line`, each `null` when the document
does not show it. `labour` is the §35a share: labour, travel and machine
costs with their VAT, without materials, and only on a craftsman's or
household service invoice. `form_line` is one of the tax lines or `null` for
a private purchase.

Claude Code gets the Read tool alone, and `--restricted` keeps it inside the
folder, so a receipt that asks for anything else gets nothing. It runs with
an environment built from nothing but `PATH`, the token, and `HOME` set to a
second temporary folder, since the container user has no home; so an
`ANTHROPIC_API_KEY` in the env file never reaches it. `DISABLE_AUTOUPDATER`,
`DISABLE_TELEMETRY`, `DISABLE_ERROR_REPORTING` and
`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` are set. Both folders go when the
run ends.

Each receipt counts against the subscription's usage limits like any other
Claude Code session, and may cost money when the plan has extra usage turned
on. When the limit is reached, the run stops and the next one carries on.

### Where `claude` comes from

The image does not carry Claude Code: it is Anthropic's proprietary
software, and the image is public on ghcr.io (see
[Two environments](/explanation/environments.md)). The job's container
mounts the host's own `claude` read-only at `/usr/local/bin/claude`, so the
job runs whatever version the host has installed and updated.

## The env file

Read with `docker run --env-file`, at `~/.config/kasten/receipts.env`, mode
`600`. `jobs/receipts.env.example` in the repo is the template.

| Variable | Default | What it sets |
|---|---|---|
| `KASTEN_API` | `http://kasten-backend-prod:8000` | the backend, by its name on `web` |
| `CLAUDE_CODE_OAUTH_TOKEN` | none | the token Claude Code reads receipts with, from `claude setup-token`; `mail` needs none |
| `RECEIPTS_GMAIL_CREDENTIALS` | `/gmail.json` | the Gmail login inside the container, the order sync's `~/.config/kasten/gmail.json` mounted read-only |
| `RECEIPTS_LABEL` | `Receipt` | the Gmail label whose mails carry receipts; any label works |
| `RECEIPTS_DAYS` | `30` | how many days of mail each run reads |
| `RECEIPTS_MODEL` | `claude-sonnet-5-5` | the model that reads the receipts |
| `TZ` | `Europe/Berlin` in the template | the day a mail belongs to |

The token is a secret: anyone with it uses the owner's Claude subscription.
It never enters the repo or the vault. It is long-lived; when it expires the
job fails at once, and `claude setup-token` makes a new one.
