/**
 * The reads only the review blocks make: the notes written in a range, GitHub's
 * contributions, and the model use. Typed from the generated schema, and kept apart from
 * `api.ts` because that file is at its size limit.
 *
 * Plain `fetch`, not the generated client, on purpose: `openapi-fetch` takes the global
 * `fetch` when it is made, so a test that stubs `fetch` after import never sees its calls
 * and the frame runs would reach the dev backend. A plain call looks the global up on each
 * request, which is the seam the frame tests stub, as they stub it for `fetchWritten`.
 */

import type { components } from "@/lib/api-types";

/** One note the review files under its day, tags and project. */
type WrittenNote = components["schemas"]["WrittenNote"];

/** GitHub's contributions per day, as the backend answers them. */
type Github = components["schemas"]["Contributions"];

/**
 * One day's use of one model in one project, from the collector's monthly notes. `cost` is null
 * where no message of the line had a price, and `unpriced` counts the tokens left out of `cost`.
 * Declared here, not generated, because the route is new and its schema has not been generated yet.
 */
export interface ModelUseLine {
  day: string;
  model: string;
  project: string;
  input: number;
  output: number;
  cache_write: number;
  cache_read: number;
  cost: number | null;
  unpriced: number;
}

/** The notes written from `from` to `to`, each with its day, tags and project. */
export async function fetchWrittenNotes(from: string, to: string): Promise<WrittenNote[]> {
  const response = await fetch(`/api/written/notes?${new URLSearchParams({ from, to })}`);
  if (!response.ok) throw new Error(`GET /api/written/notes failed with ${response.status}`);
  return (await response.json()) as WrittenNote[];
}

/**
 * GitHub's contributions per day from `from` to `to`. `on` is false without a token on the
 * backend, and then `days` is empty.
 */
export async function fetchGithub(from: string, to: string): Promise<Github> {
  const response = await fetch(`/api/github?${new URLSearchParams({ from, to })}`);
  if (!response.ok) throw new Error(`GET /api/github failed with ${response.status}`);
  return (await response.json()) as Github;
}

/** The usage lines of the days from `from` to `to`, as the collector's notes hold them. */
export async function fetchModelUse(from: string, to: string): Promise<ModelUseLine[]> {
  const response = await fetch(`/api/model-use?${new URLSearchParams({ from, to })}`);
  if (!response.ok) throw new Error(`GET /api/model-use failed with ${response.status}`);
  return (await response.json()) as ModelUseLine[];
}
