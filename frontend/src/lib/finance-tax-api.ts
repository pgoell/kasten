/**
 * The calls the finance pane makes for tax: a booking's mark and receipts, the tax year, the
 * receipt queue, and a file dropped on a booking. The answers are the ones
 * `routes/finance_tax.py` and `routes/finance_receipts.py` give.
 */

import { client, reason, refused } from "@/lib/api-client";
import type { components } from "@/lib/api-types";
import { answer } from "@/lib/finance-drill-api";

export type TaxYear = components["schemas"]["YearOut"];
export type TaxEntry = components["schemas"]["EntryOut"];
export type BookingTax = components["schemas"]["BookingTaxOut"];
export type Receipt = components["schemas"]["ReceiptOut"];
export type ReceiptToSort = components["schemas"]["ToSortOut"];
export type FormLine = components["schemas"]["MarkIn"]["form_line"];

/** The lines of the return, in the order the Tax tab lists them, with their short names. */
export const FORM_LINES: readonly { line: FormLine; label: string }[] = [
  { line: "werbungskosten", label: "Werbungskosten" },
  { line: "sonderausgaben", label: "Sonderausgaben" },
  { line: "haushaltsnahe_dienste", label: "§35a Haushaltsnahe Dienste" },
  { line: "handwerker", label: "§35a Handwerker (Arbeitskosten)" },
  { line: "aussergewoehnliche_belastungen", label: "Außergewöhnliche Belastungen" },
];

export function lineLabel(line: string | null | undefined): string {
  return FORM_LINES.find((entry) => entry.line === line)?.label ?? line ?? "";
}

/** The words for where a mark's receipt stands. */
export const RECEIPT_STATUS: Record<string, string> = {
  attached: "receipt attached",
  missing: "receipt missing",
  not_needed: "no receipt needed",
};

/** Where the browser opens a receipt's file; the route checks the login like every other. */
export function receiptUrl(id: number): string {
  return `/api/finance/receipts/${id}/file`;
}

export function lineCsvUrl(year: number, line: string): string {
  return `/api/finance/tax/${year}/lines/${line}.csv`;
}

export function receiptsZipUrl(year: number): string {
  return `/api/finance/tax/${year}/receipts.zip`;
}

export async function fetchTaxYear(year: number): Promise<TaxYear> {
  const result = await client.GET("/api/finance/tax/{year}", { params: { path: { year } } });
  return answer("Reading the tax year", result);
}

export async function fetchBookingTax(id: number): Promise<BookingTax> {
  const result = await client.GET("/api/finance/transactions/{transaction_id}/tax", {
    params: { path: { transaction_id: id } },
  });
  return answer("Reading the booking's tax", result);
}

export interface MarkFields {
  form_line: FormLine;
  tax_amount: string | null;
  receipt_needed: boolean;
  note: string | null;
}

export async function writeMark(id: number, mark: MarkFields): Promise<void> {
  const result = await client.PUT("/api/finance/transactions/{transaction_id}/tax-mark", {
    params: { path: { transaction_id: id } },
    body: mark,
  });
  answer("Saving the tax mark", result);
}

export async function deleteMark(id: number): Promise<void> {
  const { error, response } = await client.DELETE(
    "/api/finance/transactions/{transaction_id}/tax-mark",
    { params: { path: { transaction_id: id } } },
  );
  if (!response.ok)
    throw new Error(reason(error) ?? `Removing the mark failed with ${response.status}`);
}

/**
 * Send a file as a receipt, on the booking when one is named. Plain `fetch`, since the body is
 * a form with a file in it, which the typed client does not build.
 */
export async function uploadReceipt(file: File, transactionId?: number): Promise<void> {
  const form = new FormData();
  form.append("file", file);
  if (transactionId !== undefined) form.append("transaction_id", String(transactionId));
  const response = await fetch("/api/finance/receipts", { method: "POST", body: form });
  if (!response.ok) throw await refused(response, "Keeping the receipt");
}

export async function fetchReceiptsToSort(): Promise<ReceiptToSort[]> {
  return answer("Reading the receipts to sort", await client.GET("/api/finance/receipts/to-sort"));
}

/** The booking already has a mark; the message says which, for the owner to replace or keep. */
export class MarkHeldError extends Error {}

export interface ConfirmBody {
  transaction_id: number;
  form_line: FormLine | null;
  tax_amount: string | null;
  /** Replace a mark the booking already has, which is otherwise refused. */
  replace?: boolean;
}

export async function confirmReceipt(id: number, body: ConfirmBody): Promise<void> {
  const result = await client.POST("/api/finance/receipts/{receipt_id}/confirm", {
    params: { path: { receipt_id: id } },
    body: { ...body, replace: body.replace ?? false, receipt_needed: true },
  });
  if (result.response.status === 409) {
    throw new MarkHeldError(reason(result.error) ?? "The booking already has a mark");
  }
  answer("Confirming the receipt", result);
}

export async function patchReceipt(
  id: number,
  body: { transaction_id?: number | null; dismissed?: boolean },
): Promise<void> {
  const result = await client.PATCH("/api/finance/receipts/{receipt_id}", {
    params: { path: { receipt_id: id } },
    body,
  });
  answer("Changing the receipt", result);
}
