import { useQueries, useQuery } from "@tanstack/react-query";
import { fetchCards, fetchNote } from "@/lib/api";
import { readClock } from "@/lib/clock";
import { readRetry } from "@/lib/read-retry";
import { deckNotes, decksFrom } from "@/lib/review";
import { useReviewLimits } from "@/lib/use-review-limits";

/** How far under another deck this one sits, as the review pane counts it. */
function depthOf(name: string): number {
  return name.split("/").length - 1;
}

/**
 * The cards the review pane counts as waiting, or undefined until every read
 * the count needs is in.
 *
 * A copy of the pane's count rather than a shared hook, because the pane owns
 * its queries and draws its own pending state. The keys are the pane's, so the
 * two read one answer, and a sitting's writes move both counts at once.
 */
export function useReviewWaiting(archive: boolean): number | undefined {
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
  const { limits } = useReviewLimits();

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
