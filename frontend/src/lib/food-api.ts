/**
 * The calls the card's food search makes: Open Food Facts through the backend, and
 * the log's days for the foods a person logged before.
 *
 * Kept apart from `api.ts`, which is past the size a reader can take in one go. The
 * backend's answers are the ones `food.py` and `log.py` give.
 */

import { client, reason } from "@/lib/api-client";
import type { components } from "@/lib/api-types";

/** One food Open Food Facts has, with one serving of it and its nutrients. */
export type Food = components["schemas"]["kasten_backend__food__Food"];

/** One day of the log: the lines under its `## Log` that parsed, and their totals. */
export type LogDay = components["schemas"]["Day"];

/**
 * The foods Open Food Facts has whose name matches `q`, or the one a barcode names.
 *
 * A refusal is the backend's sentence, such as a search over its rate limit, and
 * the food panel shows it as it is.
 */
export async function searchFood(q: string): Promise<Food[]> {
  const { data, error, response } = await client.GET("/api/food/search", {
    params: { query: { q } },
  });

  if (!data) {
    throw new Error(reason(error) ?? `GET /api/food/search failed with ${response.status}`);
  }

  return data;
}

/** The food with barcode `code`, with the serving and nutrients Open Food Facts has for it. */
export async function readBarcode(code: string): Promise<Food> {
  const { data, error, response } = await client.GET("/api/food/barcode/{code}", {
    params: { path: { code } },
  });

  if (!data) {
    throw new Error(
      reason(error) ?? `GET /api/food/barcode/${code} failed with ${response.status}`,
    );
  }

  return data;
}

/** The days from `from` to `to`, both included, that hold a `## Log`, with their lines. */
export async function fetchLog(from: string, to: string): Promise<LogDay[]> {
  const { data, response } = await client.GET("/api/log", {
    params: { query: { from, to } },
  });

  if (!data) {
    throw new Error(`GET /api/log failed with ${response.status}`);
  }

  return data;
}
