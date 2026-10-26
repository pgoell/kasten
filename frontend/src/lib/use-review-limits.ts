import { useQuery } from "@tanstack/react-query";
import { fetchNote, fetchReviewLimits } from "@/lib/api";
import { DECKS_NOTE } from "@/lib/layout";
import { readRetry } from "@/lib/read-retry";
import type { Limits } from "@/lib/review";

/** No default, which is what an unset setting means and what a failed read falls back on. */
const NONE = { new_per_day: null, reviews_per_day: null };

/**
 * The daily limits, for `decksFrom`, or undefined until both reads are in.
 *
 * Under `cards`, so the invalidation every rating already sends refetches it
 * and an edit to `decks.md` reaches the overview the way an edit to a deck does.
 * A sitting does not follow it there: it keeps the limits it started with, and
 * an edit to `decks.md` reaches the next sitting.
 *
 * Neither read can fail the screen. A vault with no `decks.md` is the usual
 * case, and a limit is a convenience: a sitting with none beats no sitting.
 *
 * `current` holds back a stale cached answer until the refetch on mount lands.
 * A sitting keeps the first answer it sees, and an edit to `decks.md` since the
 * overview read it invalidates nothing, so a stale one would outlive the edit.
 */
export function useReviewLimits(current = false): Limits | undefined {
  const { data, isFetchedAfterMount, isStale } = useQuery({
    queryKey: ["cards", "limits"],
    queryFn: async (): Promise<Limits> => {
      const [note, defaults] = await Promise.all([
        fetchNote(DECKS_NOTE).then(
          (text) => text,
          () => null,
        ),
        fetchReviewLimits().then(
          (read) => read,
          () => NONE,
        ),
      ]);
      return { note, defaults };
    },
    ...readRetry,
  });
  return current && isStale && !isFetchedAfterMount ? undefined : data;
}
