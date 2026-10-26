/**
 * The PayPal and Amazon orders the finance pane shows: the ones no booking holds yet, and the
 * words for where a charge stands. The answers are the ones `routes/finance_orders.py` gives;
 * the order a booking paid comes with the booking's drilldown.
 */

import { client, reason } from "@/lib/api-client";
import type { components } from "@/lib/api-types";

export type Order = components["schemas"]["OrderOut"];
export type Charge = components["schemas"]["ChargeOut"];

/** Why a charge waits, or what its match did, in the pane's words. */
const STATUS: Record<string, string> = {
  waiting: "no booking yet",
  ambiguous: "two bookings fit alike",
  items_off: "its items do not add up",
  split: "split into its items",
  kept: "kept as you sorted it",
  linked: "linked",
};

export function statusWords(status: string): string {
  return STATUS[status] ?? status;
}

export async function fetchUnmatchedOrders(): Promise<Order[]> {
  const { data, error, response } = await client.GET("/api/finance/orders/unmatched");
  if (!data) {
    throw new Error(
      reason(error) ?? `GET /api/finance/orders/unmatched failed with ${response.status}`,
    );
  }
  return data;
}
