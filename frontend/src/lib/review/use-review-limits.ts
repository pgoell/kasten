import { useQuery } from "@tanstack/react-query";
import { fetchNote, fetchReviewLimits } from "@/lib/api";
import { DECKS_NOTE } from "@/lib/layout";
import { readRetry, retryable } from "@/lib/read-retry";
import type { Limits } from "@/lib/review/review";

/** No default, which is what an unset setting means and what a failed read falls back on. */
const NONE = { new_per_day: null, reviews_per_day: null };

/** The query's error is typed `unknown`, and the API's errors are `Error`s. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The daily limits for `decksFrom`, or undefined until both reads are in. A read the backend drops is retried, since a limit read as none would let a deck run past `new_per_day`.
 * Any other failure falls back, as a sitting with no limit beats no sitting. A read that runs out of tries is `failed`.
 */
export function useReviewLimits(current = false): {
  limits: Limits | undefined;
  /** The message of the failed read, when there is no answer to show. */
  failed: string | null;
  retry: () => void;
} {
  const { data, error, isError, isFetching, isFetchedAfterMount, isStale, refetch } = useQuery({
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
    failed: isError && !isFetching && data === undefined ? messageOf(error) : null,
    retry: () => void refetch(),
  };
}
