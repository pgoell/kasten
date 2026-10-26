---
type: Reference
title: "HTTP API: finance tax"
description: A booking's tax mark on a line of the German return and the money rules it is held to, the tax year's totals per line, and its exports, a CSV per line and a ZIP of receipts.
resource: backend/src/kasten_backend/routes/finance_tax.py
tags: [api, backend, openapi, finance, tax]
status: draft
---

# HTTP API: finance tax

A tax mark puts one booking on one line of the German employee's return, with
the amount that counts there. The tax year goes by booking date, the day the
money was paid (§11 EStG). It does not apply the 10-day rule for regular
payments around the turn of the year, and a credit card booking counts on the
day the bank booked it, not the day the card was used; move such a booking to
the right year by hand on the return. The Tax tab, these exports and the agent's
`tax_year_summary` read one summary, so they agree to the cent. Receipts have
their own page, [HTTP API: finance receipts](/reference/http-api/finance-receipts.md).

They sit beside the other finance routes, behind the same gate and with the
same `503` when no database answers; [HTTP API: finance](/reference/http-api/finance.md)
says who reaches them. Amounts are strings, as there.

The lines, by the key a mark names:

| `form_line` | Line of the return |
| --- | --- |
| `werbungskosten` | Werbungskosten, Anlage N; they count only above the Arbeitnehmer-Pauschbetrag: €1,230 from 2023, €1,200 for 2022, €1,000 before |
| `sonderausgaben` | Sonderausgaben: donations, insurance |
| `haushaltsnahe_dienste` | §35a haushaltsnahe Dienstleistungen: the labour only |
| `handwerker` | §35a Handwerkerleistungen: the labour only |
| `aussergewoehnliche_belastungen` | außergewöhnliche Belastungen: medical costs |

## PUT /api/finance/transactions/{transaction_id}/tax-mark

Marks the booking, or changes its mark. A booking has one mark; a split
booking too, with the tax amount saying how much of it counts.

```json
{ "form_line": "handwerker", "tax_amount": "320.00", "receipt_needed": true, "note": "Bad gestrichen" }
```

```json
{
  "transaction_id": 812, "form_line": "handwerker", "tax_amount": "320.00",
  "receipt_needed": true, "note": "Bad gestrichen", "receipt_status": "missing"
}
```

* `tax_amount`: what counts on the line, more than 0 and never more than the
  booking's own amount. Left out, it is the whole booking, except on the two
  §35a lines, which need it: only the labour share of the invoice counts.
* `receipt_needed`: false for a line that needs no receipt kept.
* `receipt_status`: `attached` when a receipt is on the booking, else
  `missing`, or `not_needed` when `receipt_needed` is false. Never stored: a
  receipt put on or taken off the booking changes it.

A `422` says which money rule refused the mark:

* a move between own accounts, which is no cost;
* a §35a line on a cash account, since §35a counts only what was paid by transfer;
* a booking on the shared account with no `tax_amount`: only the owner's share
  counts, and only the owner knows it;
* a §35a line with no `tax_amount`, which would count the materials too;
* a `tax_amount` over the booking's amount, or of 0.

A `404` names a booking that is not there.

A mark on money in, such as an employer paying a work cost back or a refund,
takes its tax amount off the line in the year it came: a cost paid back is no cost.

## DELETE /api/finance/transactions/{transaction_id}/tax-mark

Takes the mark away and answers `204`, or `404` when the booking has none. Its
receipts stay on it.

## GET /api/finance/transactions/{transaction_id}/tax

The booking's mark, or `null`, and its receipts, each as
[`GET /api/finance/receipts`](/reference/http-api/finance-receipts.md#get-apifinancereceipts)
lists one. `404` for a booking that is not there.

```json
{ "mark": { "transaction_id": 812, "form_line": "handwerker", "tax_amount": "320.00", "receipt_needed": true, "note": null, "receipt_status": "attached" }, "receipts": [ { "id": 4, "name": "Rechnung.pdf" } ] }
```

## GET /api/finance/tax/{year}

The tax year, for the bookings paid in it.

```json
{
  "year": 2026,
  "lines": [ { "form_line": "werbungskosten", "label": "Werbungskosten (Anlage N)", "total": "1400.00", "bookings": 3, "missing": 1 } ],
  "allowance": "1230.00",
  "werbungskosten_over": "170.00",
  "missing": [ { "transaction_id": 812, "booking_date": "2026-03-04", "payee": "Thalia", "amount": "-400.00", "tax_amount": "400.00", "counted": "400.00", "form_line": "werbungskosten", "receipt_status": "missing", "receipt_ids": [], "shared": false, "purpose": "Fachbuch", "note": null } ],
  "money_back": [ { "transaction_id": 901, "booking_date": "2026-03-20", "payee": "Employer GmbH", "amount": "80.00" } ],
  "entries": [ ]
}
```

* `lines`: every line, in the order above, with nothing on it as `0.00`.
  `total` sums `counted`, so money in comes off and a line can go below zero.
* `allowance`: the Arbeitnehmer-Pauschbetrag of that year.
* `werbungskosten_over`: the Werbungskosten total above `allowance`, never below zero.
* `entries`: every marked booking of the year, oldest first. `counted` is the
  tax amount, negative on money in. `shared` says the booking is on the shared
  account.
* `missing`: the entries whose `receipt_status` is `missing`.
* `money_back`: money in of the year with no mark that looks like a marked
  cost paid back: the refund of an order a marked booking paid, or money in of
  an `ignore` category that holds a marked cost of the year. Listed, never
  counted; mark it on the cost's line to take it off.

`year` is from 2000 to 2100.

## GET /api/finance/tax/{year}/lines/{form_line}.csv

One line's marked bookings of the year as CSV, a header row and a row each,
for a download. Columns: `date`, `payee`, `purpose`, `booking_amount`,
`tax_amount`, `counted`, `receipt_status`, `receipts` (the names the ZIP gives
them, space between), `note` and `transaction_id`. A text cell that starts
with `=`, `+`, `-`, `@`, a tab or a carriage return gets a `'` in front, so a
spreadsheet shows a payee the bank sent rather than running it as a formula.
A `form_line` that is no line is a `422`.

## GET /api/finance/tax/{year}/receipts.zip

Every receipt on the year's marked bookings, as one ZIP for a download. Each
is named `YYYY-MM-DD_payee_amount.ext` by its booking: the booking date, the
payee in ASCII letters, digits and hyphens (umlauts written out, at most 40
characters), and the booking's amount to the cent. Two names alike take `_2`,
`_3` and on. A file gone from the disk is left out.
