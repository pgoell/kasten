import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { ReviewDecks } from "@/components/review-decks";
import { ReviewSession } from "@/components/review-session";
import type { Deck } from "@/lib/review";

export const Route = createFileRoute("/review")({
  component: Review,
});

/**
 * The review, on a page of its own, sized for a phone.
 *
 * A route rather than a pane, and both rather than either. The app proper is a
 * grid of panes driven by a leader key and a vim mode, none of which a phone
 * has: no escape key, no split, no `<leader>gs`. Reviewing is the one thing
 * worth doing in a queue at a bus stop, so it gets a screen that is only
 * buttons, and `/review` is a URL you can put on a home screen.
 *
 * The two shells share both halves of the interface. This one adds a viewport
 * and nothing else, which is the property to keep: a rule that lived here and
 * not in the pane would be a rule that applies on a phone and not at a desk.
 */
function Review() {
  const [deck, setDeck] = useState<Deck | null>(null);

  return (
    <main className="h-dvh w-full">
      {deck === null ? (
        <ReviewDecks onPick={setDeck} />
      ) : (
        <ReviewSession deck={deck} onLeave={() => setDeck(null)} />
      )}
    </main>
  );
}
