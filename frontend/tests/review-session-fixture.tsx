import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { ReviewSession } from "@/components/review-session";
import * as api from "@/lib/api";
import type { Deck } from "@/lib/review/review";
import { shownCard } from "./review-card";

export const DECK: Deck = {
  name: "aws",
  notes: ["decks/aws.md"],
  due: 0,
  fresh: 1,
  parked: 0,
  whole: false,
  next: null,
};

const NOTE = "#flashcards/aws\n\nWhat does S3 stand for?::Simple Storage Service\n";

export function renderSession() {
  vi.spyOn(api, "fetchNote").mockResolvedValue(NOTE);
  vi.spyOn(api, "saveNote").mockResolvedValue({ path: "decks/aws.md", content: NOTE });
  vi.spyOn(api, "fetchReviewLimits").mockResolvedValue({
    new_per_day: null,
    reviews_per_day: null,
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  render(
    <QueryClientProvider client={client}>
      <ReviewSession deck={DECK} onLeave={vi.fn()} />
    </QueryClientProvider>,
  );

  return shownCard();
}

/** Where an Anki import files a deck's media, percent-encoded as the note holds it. */
export const MEDIA = "Flashcards/Japanese%20media";

export function renderDeck(note: string) {
  vi.spyOn(api, "fetchNote").mockResolvedValue(note);
  vi.spyOn(api, "saveNote").mockResolvedValue({ path: "decks/aws.md", content: note });
  vi.spyOn(api, "fetchReviewLimits").mockResolvedValue({
    new_per_day: null,
    reviews_per_day: null,
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ReviewSession deck={{ ...DECK, fresh: 2 }} onLeave={vi.fn()} />
    </QueryClientProvider>,
  );
}
