import { useQueries, useQuery } from "@tanstack/react-query";
import { fetchCards, fetchNote } from "@/lib/api";
import { readClock } from "@/lib/clock";
import { readRetry } from "@/lib/read-retry";
import { deckNotes, decksFrom } from "@/lib/review/review";
import { useReviewLimits } from "@/lib/review/use-review-limits";

/** How far under another deck this one sits, as the review pane counts it. */
function depthOf(name: string): number {
  return name.split("/").length - 1;
}

/**
 * The cards the review pane counts as waiting, or undefined until every read is in. Null when the daily limits could not be read,
 * since a count without them would sit past the limit and nothing would ever come. A copy of the pane's count on the pane's query keys, so a sitting's writes move both.
 */
export function useReviewWaiting(archive: boolean): number | null | undefined {
  const { data: hits } = useQuery({
    queryKey: ["cards", archive],
    queryFn: () => fetchCards(archive),
    ...readRetry,
  });
  const paths = hits === undefined ? [] : deckNotes(hits);
  const reads = useQueries({
    queries: paths.map((path) => ({
      queryKey: ["cards", "note", path],
      queryFn: () => fetchNote(path),
      ...readRetry,
    })),
  });
  const { limits, failed } = useReviewLimits();

  if (limits === undefined && failed !== null) return null;
  if (hits === undefined || limits === undefined || reads.some((read) => read.isPending)) {
    return undefined;
  }

  const decks = decksFrom(
    paths.flatMap((path, at) => {
      const text = reads[at]?.data;
      return text === undefined ? [] : [{ path, text }];
    }),
    readClock(new Date()).date,
    limits,
  );
  // Top-level decks only, for the reason the pane gives: a deck counts every
  // card under it, so summing the subdecks too would count each card twice.
  return decks
    .filter((deck) => depthOf(deck.name) === 0)
    .reduce((count, deck) => count + deck.due + deck.fresh, 0);
}
