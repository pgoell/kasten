import { fetchNote } from "@/lib/api";

/** Waits between the tries of a request the backend dropped: about a minute in all. */
export const BACKOFF = [1000, 2000, 4000, 8000, 15000, 15000, 15000];

/**
 * A request that failed because the backend is down or restarting: a gateway
 * answer, or no answer, which fetch reports as a `TypeError`. The API puts the
 * status of a failed request in `cause`.
 */
export function retryable(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  return (
    error instanceof Error &&
    typeof error.cause === "number" &&
    [502, 503, 504].includes(error.cause)
  );
}

/**
 * How a `cards` read tries again after the backend drops it. Every query under a
 * `cards` key spreads this, so the observers of one key agree on it. A read that
 * runs out of tries keeps the last answer it had.
 */
export const readRetry = {
  // TanStack counts the failures so far, from 0, so `<` makes 1 + BACKOFF.length tries.
  retry: (failures: number, error: unknown) => retryable(error) && failures < BACKOFF.length,
  // `retry` never asks past the end of BACKOFF, so `?? 0` only satisfies the type.
  retryDelay: (attempt: number) => BACKOFF[attempt] ?? 0,
};

/**
 * Reads a note, trying again while the backend restarts, as `useSittingWrites` tries a write.
 * The parked list and the sitting both read through `readNotes`, so they retry alike. `live` says
 * whether the effect that asked still stands, so a read it has left stops before its next try.
 */
export async function readNote(note: string, live: () => boolean): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetchNote(note);
    } catch (error) {
      if (!retryable(error) || attempt === BACKOFF.length) throw error;
      await new Promise((wake) => setTimeout(wake, BACKOFF[attempt]));
      if (!live()) throw error;
    }
  }
}

/**
 * Reads every note at once, as `readNote` reads one. The first note that fails for good fails
 * them all, so the others stop before their next try rather than retrying a batch already lost.
 */
export async function readNotes(
  notes: readonly string[],
  live: () => boolean,
): Promise<(readonly [string, string])[]> {
  let lost = false;
  try {
    return await Promise.all(
      notes.map(async (note) => [note, await readNote(note, () => live() && !lost)] as const),
    );
  } catch (error) {
    lost = true;
    throw error;
  }
}
