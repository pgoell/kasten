---
type: Reference
title: Receipt jobs
description: The receipt job's commands and exit codes, its env file, the Gmail search it sends PDFs from, and how the reader reads a receipt with Claude and what it sends kasten back.
resource: jobs/src/kasten_jobs/receipts.py
tags: [finance, tax, receipts, jobs, gmail, claude]
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
| `read` | Reads each unread receipt with Claude and sends kasten the reading. | `0`; `1` when the API stopped the run (rate limit, server error, no connection) |
| `run` | `mail`, then `read`. | as `read` |

`mail` searches `label:"Receipt" has:attachment filename:pdf newer_than:30d`
and sends every PDF part of each mail, whether Gmail names it
`application/pdf` or only by its `.pdf` name. Kasten keeps a file once by its
hash, so every run sends the whole window again and changes nothing it has. A
mail Gmail will not hand over is skipped and counted; a file kasten refuses is
logged with kasten's reason.

`read` takes the unread receipts oldest first and, for each:

* sends it whole to the Messages API, a PDF as a document and a photo as an
  image, asking for JSON in a fixed schema;
* sends kasten what came back as a reading. A field that does not parse, such
  as an amount that is no number, is left out rather than sent wrong.

What happens when a receipt gets no answer:

| What | Then |
|---|---|
| The model declines the file, or says it is no receipt | a reading with `error` saying so; the receipt is done |
| The API refuses the file (`400`, `413`) | a reading with `error` and the API's reason; the receipt is done |
| The reply is cut off or is not JSON | asked again, up to 3 times in the run; then a reading with `error`, and done |
| Kasten has no file for it | skipped, tried again next run |
| Rate limited, overloaded, a server error or no connection | the run stops there with exit `1`; the rest wait for the next run |

A receipt that ends with an error reading is never sent to the API again, and
a file that cannot be read does not fail the run.
| The key is wrong or lacks permission, or the model is not there | the job fails at once |

A reading kasten has can be dropped with
[`DELETE /api/finance/receipts/{id}/reading`](/reference/http-api/finance-receipts.md#delete-apifinancereceiptsreceipt_idreading)
for the next run to read the receipt again.

## The model call

One request to `RECEIPTS_MODEL`, `claude-sonnet-5-5` by default, at effort
`low`, with structured output: `is_receipt`, `date`, `total`, `payee`,
`labour` and `form_line`, each `null` when the document does not show it.
`labour` is the §35a share: labour, travel and machine costs with their VAT,
without materials, and only on a craftsman's or household service invoice.
`form_line` is one of the tax lines or `null` for a private purchase. The
request carries `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`),
so a decline by the safety classifiers is run again on the model the API
routes that kind of decline to.

## The env file

Read with `docker run --env-file`, at `~/.config/kasten/receipts.env`, mode
`600`. `jobs/receipts.env.example` in the repo is the template.

| Variable | Default | What it sets |
|---|---|---|
| `KASTEN_API` | `http://kasten-backend-prod:8000` | the backend, by its name on `web` |
| `ANTHROPIC_API_KEY` | none | the key the reader calls the Messages API with; `mail` needs none |
| `RECEIPTS_GMAIL_CREDENTIALS` | `/gmail.json` | the Gmail login inside the container, the order sync's `~/.config/kasten/gmail.json` mounted read-only |
| `RECEIPTS_LABEL` | `Receipt` | the Gmail label whose mails carry receipts |
| `RECEIPTS_DAYS` | `30` | how many days of mail each run reads |
| `RECEIPTS_MODEL` | `claude-sonnet-5-5` | the model that reads the receipts |
| `TZ` | `Europe/Berlin` in the template | the day a mail belongs to |

The key is a secret: anyone with it spends on the Anthropic account. It never
enters the repo or the vault.
