/**
 * The finance pane's calls for sorting bookings, by hand or for a whole payee.
 * Kept apart from `api.ts`, which is past the size a reader can take in one go.
 */

import { client, reason } from "@/lib/api-client";
import type { components } from "@/lib/api-types";

export type Category = components["schemas"]["CategoryOut"];

/** A booking with something to sort: itself, or the splits it lists. */
export type ToSort = components["schemas"]["ToSort"];

/** A page of those, and how many things wait to be sorted in all. */
export type ToSortPage = components["schemas"]["ToSortPage"];

/** How many bookings the pane asks for at once. Sorting one brings the next in. */
const PAGE = 200;

function failed(what: string, error: { detail?: unknown } | undefined, status: number): Error {
  return new Error(reason(error) ?? `${what} failed with ${status}`);
}

export async function fetchCategories(): Promise<Category[]> {
  const { data, error, response } = await client.GET("/api/finance/categories");
  if (!data) throw failed("GET /api/finance/categories", error, response.status);
  return data;
}

/** The oldest bookings that hold something without a category. */
export async function fetchToSort(): Promise<ToSortPage> {
  const { data, error, response } = await client.GET("/api/finance/to-sort", {
    params: { query: { limit: PAGE } },
  });
  if (!data) throw failed("GET /api/finance/to-sort", error, response.status);
  return data;
}

/** Set a booking's category by hand, or a split's when `split` is given. */
export async function sortByHand(
  row: { transaction: number; split?: number },
  category: number,
): Promise<void> {
  const body = { category_id: category };
  const { error, response } =
    row.split === undefined
      ? await client.PUT("/api/finance/transactions/{transaction_id}/category", {
          params: { path: { transaction_id: row.transaction } },
          body,
        })
      : await client.PUT("/api/finance/splits/{split_id}/category", {
          params: { path: { split_id: row.split } },
          body,
        });
  if (!response.ok) throw failed("Setting the category", error, response.status);
}

/** Give a payee its default category, which sorts every booking of theirs a rule may sort. */
export async function sortPayee(payee: number, category: number): Promise<void> {
  const { error, response } = await client.PUT("/api/finance/payees/{payee_id}", {
    params: { path: { payee_id: payee } },
    body: { category_id: category },
  });
  if (!response.ok) throw failed("Setting the payee's category", error, response.status);
}
