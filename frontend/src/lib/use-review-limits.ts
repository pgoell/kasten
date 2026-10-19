import { useQuery } from "@tanstack/react-query";
import { fetchNote, fetchReviewLimits } from "@/lib/api";
import { DECKS_NOTE } from "@/lib/layout";
import type { Limits } from "@/lib/review";

/** No default, which is what an unset setting means and what a failed read falls back on. */
const NONE = { new_per_day: null, reviews_per_day: null };

/**
 * The daily limits, for `decksFrom`, or undefined until both reads are in.
 *
 * Under `cards`, so the invalidation every rating already sends refetches it
 * and an edit to `decks.md` reaches the overview the way an edit to a deck does.
 * The answer is a plain object so the query's structural sharing hands back the
 * same one when nothing changed, and a sitting keyed on it is not rebuilt
 * halfway through by its own writes.
 *
 * Neither read can fail the screen. A vault with no `decks.md` is the usual
 * case, and a limit is a convenience: a sitting with none beats no sitting.
 */
export function useReviewLimits(): Limits | undefined {
  const { data } = useQuery({
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
  });
  return data;
}
