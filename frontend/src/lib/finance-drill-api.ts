/**
 * The calls the finance pane's drilldowns make: one scope, account, category, payee or booking,
 * and the writes they offer, a booking's splits and a payee rule. The answers are the ones
 * `routes/finance_drill.py` gives; sorting goes through `finance-api.ts`.
 */

import { client, reason } from "@/lib/api-client";
import type { components } from "@/lib/api-types";
import type { Span } from "@/lib/finance-span";

export type ScopeDrill = components["schemas"]["ScopeDrillOut"];
export type AccountDrill = components["schemas"]["AccountDrillOut"];
export type CategoryDrill = components["schemas"]["CategoryDrillOut"];
export type PayeeDrill = components["schemas"]["PayeeDrillOut"];
export type BookingDrill = components["schemas"]["BookingDrillOut"];
export type Scope = ScopeDrill["scope"];

/** One step down from the month: what it opens, and the name its breadcrumb shows. */
export type DrillStep =
  | { kind: "scope"; scope: Scope; name: string }
  | { kind: "account" | "category" | "payee" | "booking"; id: number; name: string }
  | { kind: "setup"; name: string };

/** How many months a drilldown reads back from the month shown, the month included. */
const MONTHS = 12;

/** The answer's data, or the error a failed call gives. */
function answer<T>(
  what: string,
  result: { data?: T; error?: { detail?: unknown }; response: Response },
): T {
  if (result.data === undefined) {
    throw new Error(reason(result.error) ?? `${what} failed with ${result.response.status}`);
  }
  return result.data;
}

/** The query a drilldown reads a span with: the span, and the months its chart shows. */
function spanQuery(span: Span) {
  return { month: span.to, from: span.from, months: MONTHS };
}

export async function fetchScope(scope: Scope, span: Span): Promise<ScopeDrill> {
  const query = spanQuery(span);
  return answer(
    "The scope",
    await client.GET("/api/finance/drill/scopes/{scope}", {
      params: { path: { scope }, query },
    }),
  );
}

export async function fetchAccountDrill(id: number, span: Span): Promise<AccountDrill> {
  const query = spanQuery(span);
  return answer(
    "The account",
    await client.GET("/api/finance/drill/accounts/{account_id}", {
      params: { path: { account_id: id }, query },
    }),
  );
}

export async function fetchCategoryDrill(id: number, span: Span): Promise<CategoryDrill> {
  const query = spanQuery(span);
  return answer(
    "The category",
    await client.GET("/api/finance/drill/categories/{category_id}", {
      params: { path: { category_id: id }, query },
    }),
  );
}

export async function fetchPayeeDrill(id: number, span: Span): Promise<PayeeDrill> {
  const query = spanQuery(span);
  return answer(
    "The payee",
    await client.GET("/api/finance/drill/payees/{payee_id}", {
      params: { path: { payee_id: id }, query },
    }),
  );
}

export async function fetchBookingDrill(id: number): Promise<BookingDrill> {
  return answer(
    "The booking",
    await client.GET("/api/finance/drill/bookings/{transaction_id}", {
      params: { path: { transaction_id: id } },
    }),
  );
}

/** Replace a booking's splits; an empty list makes it whole again. */
export async function writeSplits(
  id: number,
  parts: { amount: string; text: string | null }[],
): Promise<void> {
  const { error, response } = await client.PUT(
    "/api/finance/transactions/{transaction_id}/splits",
    {
      params: { path: { transaction_id: id } },
      body: parts,
    },
  );
  if (!response.ok) throw new Error(reason(error) ?? `Splitting failed with ${response.status}`);
}

/** A payee rule: every payee whose key a word of starts with `pattern` sorts into the category. */
export async function writePayeeRule(pattern: string, category: number): Promise<void> {
  const { error, response } = await client.POST("/api/finance/rules", {
    body: { kind: "payee", pattern, category_id: category },
  });
  if (!response.ok) throw new Error(reason(error) ?? `The rule failed with ${response.status}`);
}
