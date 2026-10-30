import { fetchNote } from "@/lib/api";

/** Waits between the tries of a request the backend dropped: about a minute in all. */
export const BACKOFF = [1000, 2000, 4000, 8000, 15000, 15000, 15000];

/**
 * A request the backend dropped while down or restarting: a gateway status in `cause`, or a
 * `TypeError` from fetch with no answer.
 */
export function retryable(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  return (
    error instanceof Error &&
    typeof error.cause === "number" &&
    [502, 503, 504].includes(error.cause)
  );
}

/** Retry policy for `cards` queries, so every observer of one key agrees. */
export const readRetry = {
  // Failures count from 0, so this makes 1 + BACKOFF.length tries.
  retry: (failures: number, error: unknown) => retryable(error) && failures < BACKOFF.length,
  // Never asked past the end of BACKOFF; `?? 0` is for the type only.
  retryDelay: (attempt: number) => BACKOFF[attempt] ?? 0,
};

/** Reads a note, retrying while the backend restarts. `live` returning false stops the retries. */
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

/** Reads every note at once. The first failure for good stops the rest before their next try. */
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
