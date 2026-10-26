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
