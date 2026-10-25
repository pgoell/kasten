/**
 * The two reads only the review blocks make: the notes written in a range, and GitHub's
 * contributions. Plain `fetch` until the routes are in the generated types, which is why
 * they sit apart from `api.ts`, whose size is at its limit.
 */

import type { WrittenNote } from "@/lib/review-year";

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
export async function fetchGithub(
  from: string,
  to: string,
): Promise<{ on: boolean; days: Record<string, number> }> {
  const response = await fetch(`/api/github?${new URLSearchParams({ from, to })}`);
  if (!response.ok) throw new Error(`GET /api/github failed with ${response.status}`);
  return (await response.json()) as { on: boolean; days: Record<string, number> };
}
