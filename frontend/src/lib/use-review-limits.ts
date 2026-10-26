import { useQuery } from "@tanstack/react-query";
import { fetchNote, fetchReviewLimits } from "@/lib/api";
import { DECKS_NOTE } from "@/lib/layout";
import { readRetry, retryable } from "@/lib/read-retry";
import type { Limits } from "@/lib/review";

/** No default, which is what an unset setting means and what a failed read falls back on. */
const NONE = { new_per_day: null, reviews_per_day: null };

/** The query's error is typed `unknown`, and the API's errors are `Error`s. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The daily limits, for `decksFrom`, or undefined until both reads are in.
 *
 * Under `cards`, so the invalidation every rating already sends refetches it
 * and an edit to `decks.md` reaches the overview the way an edit to a deck does.
 * A sitting does not follow it there: it keeps the limits it started with, and
 * an edit to `decks.md` reaches the next sitting.
 *
 * A read the backend drops is retried, not read as "no limit": a limit read as
 * none while the backend restarts would let a deck count past `new_per_day` and
 * stay that way until the next edit. Any other failure falls back, since a
 * vault with no `decks.md` is the usual case, and a limit is a convenience: a
 * sitting with none beats no sitting. A read that runs out of tries is `failed`.
 *
 * `current` holds back a stale cached answer until the refetch on mount lands.
 * A sitting keeps the first answer it sees, and an edit to `decks.md` since the
 * overview read it invalidates nothing, so a stale one would outlive the edit.
 */
export function useReviewLimits(current = false): {
  limits: Limits | undefined;
  /** The message of the failed read, when there is no answer to show. */
  failed: string | null;
} {
  const { data, error, isError, isFetchedAfterMount, isStale } = useQuery({
    queryKey: ["cards", "limits"],
    queryFn: async (): Promise<Limits> => {
      const [note, defaults] = await Promise.all([
        fetchNote(DECKS_NOTE).then(
          (text) => text,
          (failure: unknown) => {
            if (retryable(failure)) throw failure;
            return null;
          },
        ),
        fetchReviewLimits().then(
          (read) => read,
          (failure: unknown) => {
            if (retryable(failure)) throw failure;
            return NONE;
          },
        ),
      ]);
      return { note, defaults };
    },
    ...readRetry,
  });
  return {
    limits: current && isStale && !isFetchedAfterMount ? undefined : data,
    failed: isError && data === undefined ? messageOf(error) : null,
  };
}
