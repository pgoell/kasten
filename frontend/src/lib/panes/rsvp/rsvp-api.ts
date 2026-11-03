/**
 * The place an RSVP run keeps in each file, read and written through the
 * backend's two routes. Its own module, as `food-api.ts` and `todo-api.ts` are.
 */

import { client } from "@/lib/api-client";
import type { components } from "@/lib/api-types";

/** Where an RSVP run last stopped in one file: the word, the length of its list, and the words there. */
export type RsvpPlace = components["schemas"]["Place"];

/**
 * The place an RSVP run last stopped at in `path`, or null where none has.
 *
 * The backend answers a file no run has read with `null`, and a 404 for a file
 * that is not there; the reader starts at the top in both cases.
 */
export async function fetchRsvp(path: string): Promise<RsvpPlace | null> {
  const { data, response } = await client.GET("/api/rsvp", { params: { query: { path } } });

  if (response.status === 404) return null;
  if (data === undefined) {
    throw new Error(`GET /api/rsvp?path=${path} failed with ${response.status}`);
  }

  return data;
}

/** Save where an RSVP run stopped in `path`, over the place saved before. */
export async function saveRsvp(
  path: string,
  place: components["schemas"]["PlaceEdit"],
): Promise<RsvpPlace> {
  const { data, response } = await client.PUT("/api/rsvp", {
    params: { query: { path } },
    body: place,
  });

  if (!data) {
    throw new Error(`PUT /api/rsvp?path=${path} failed with ${response.status}`);
  }

  return data;
}
