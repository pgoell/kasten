---
type: Reference
title: "HTTP API: finance receipts"
description: The receipt routes, keeping a file by its hash, the share from the phone, the reader's readings, the queue of receipts on no booking with the bookings each may have paid, and the file itself.
resource: backend/src/kasten_backend/routes/finance_receipts.py
tags: [api, backend, openapi, finance, tax]
status: draft
---

# HTTP API: finance receipts

A receipt is a PDF, JPEG or PNG kept in `KASTEN_RECEIPTS_PATH`, beside the
vault and never in it ([Configuration](/reference/configuration.md#kasten_receipts_path)),
by the SHA-256 of its bytes. These routes are the only way to a receipt. It
comes in three ways: dropped on a booking in the finance pane, shared from the
phone, or posted by the receipt job from Gmail ([Collect receipts](/how-to/collect-receipts.md)).
The receipt reader job reads it and sends back what it found; kasten proposes
the booking it paid and a mark, and links or marks nothing until `confirm`.
Marks are on [HTTP API: finance tax](/reference/http-api/finance-tax.md).

Same gate and same `503` as every finance route. A `409` here carries a code
beside its sentence, `{"detail": {"code": "receipt_linked", "message": "…"}}`:
`receipt_linked` when the receipt is on another booking, `mark_exists` when a
confirm would replace the booking's mark.

## POST /api/finance/receipts

Keeps one file, sent as `multipart/form-data` with the fields `file`,
`transaction_id` (optional, the booking it belongs to) and `source` (`upload`,
the default, or `mail`).

```json
{ "receipt": { "id": 4, "sha256": "9f2c…", "media_type": "application/pdf", "size": 48211, "name": "Rechnung.pdf", "source": "upload", "received_at": "2026-10-26T09:12:00Z", "transaction_id": 812, "dismissed": false, "read_at": null, "read_error": null, "read_date": null, "read_amount": null, "read_payee": null, "read_labour": null, "read_line": null }, "created": true }
```

The type is read off the first bytes, never the name or the header: anything
but PDF, JPEG and PNG is a `422`, and so are an empty file, one over 20 MB, a
photo over 7 MB (the Messages API takes an image of up to 10 MB in base64) and
a `transaction_id` that names no booking. A body over 20 MB and a bit is
refused with a `413` before it is read: at once when its `Content-Length`
says so, else once that many bytes have come. The same bytes again answer the
receipt already kept with `created` false, linked to the booking named when it
was on none; on another booking it is a `409`.

## POST /api/finance/receipts/share

Where the manifest's `share_target` posts what the phone's share sheet hands
kasten: `title`, `text` and `url`, and files under `receipts`. Each file is
kept as a receipt on no booking, with `source` `capture`; at most 10 a share,
the rest refused, and at most 200 MB and a bit in all (`413`). Answers `303` to
`/capture` with the title, text and address as a plain share has them, and
with `receipts` and `refused`, how many files were kept and turned away, when
files came. A share of text alone opens no database, so it works on a backend
with none. With no signal the service worker sends the text on to `/capture`
itself, with `offline`, the number of files that did not go; a share over the
cap reaches `/capture` the same way with `toolarge` in place of the `413`.

## GET /api/finance/receipts

The receipts the reader has not read yet, oldest first, as `receipt` above:
`limit` (1 to 100, 20 by default) past the id `after`. `state` is `unread`,
the one there is.

## GET /api/finance/receipts/to-sort

Every receipt on no booking that was not put aside, oldest first, with the
bookings it may have paid.

```json
[
  {
    "receipt": { "id": 5, "read_date": "2026-10-01", "read_amount": "476.00", "read_payee": "Malerbetrieb Huber", "read_labour": "300.00", "read_line": "handwerker" },
    "form_line": "handwerker",
    "candidates": [ { "transaction_id": 930, "booking_date": "2026-10-28", "amount": "-476.00", "payee": "Malerbetrieb Huber GmbH", "purpose": "RE 2026-114", "tax_amount": "300.00" } ]
  }
]
```

A candidate is money out of the amount read, from 7 days before the date read
to 60 days after, never a move between own accounts; at most three. One that
names a word of four letters or more of the payee read comes first, then the
nearest in date. `tax_amount` is what a mark would take: the labour read on a
§35a line, else the amount read, never more than the booking; `null` when no
line was read, and on the shared account (`shared` true), where only the owner
knows their share and the pane asks for it. Nothing here is linked or marked.

## GET /api/finance/receipts/{receipt_id}/file

The file, as its type, to show in the browser (`inline`), with
`X-Content-Type-Options: nosniff`. `404` for a receipt or a file that is not there.

## PUT /api/finance/receipts/{receipt_id}/reading

What the receipt reader found, or why it found nothing. It replaces an earlier
reading and takes the receipt off the unread list.

```json
{ "date": "2026-10-01", "amount": "476.00", "payee": "Malerbetrieb Huber", "labour": "300.00", "form_line": "handwerker", "error": null }
```

Every field may be `null`. `amount` is over 0, `labour` 0 or more, `payee` up
to 200 characters and `error` up to 500.

## DELETE /api/finance/receipts/{receipt_id}/reading

Forgets the reading, so the reader reads the receipt again on its next run.
Answers `204`.

## PATCH /api/finance/receipts/{receipt_id}

Puts the receipt on a booking, takes it off one with `transaction_id` `null`,
or puts it aside out of the queue with `dismissed` `true`. Only the fields sent
change. `404` for a booking that is not there, `409` when the receipt is on
another booking.

## POST /api/finance/receipts/{receipt_id}/confirm

Puts the receipt on the booking and, with a `form_line`, marks the booking,
all or nothing: every rule is checked before anything is written.

```json
{ "transaction_id": 930, "form_line": "handwerker", "tax_amount": "300.00", "receipt_needed": true, "note": null, "replace": false }
```

A booking that already has a mark keeps it: the confirm is a `409` with code
`mark_exists` naming the mark, and nothing is written, unless `replace` is
`true`. The pane asks.

The mark is held to the rules of
[`PUT /api/finance/transactions/{transaction_id}/tax-mark`](/reference/http-api/finance-tax.md#put-apifinancetransactionstransaction_idtax-mark),
and a refusal is the same `422`. Answers the receipt.

## DELETE /api/finance/receipts/{receipt_id}

Deletes the receipt's file once that is committed and takes it off its
booking. Answers `204`. The row stays, marked deleted, so the mail job sending
the same bytes again changes nothing; dropped or shared again by you, the
receipt comes back. A deleted receipt is a `404` on every route here.
