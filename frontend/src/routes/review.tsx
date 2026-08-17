import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ReviewDecks } from "@/components/review-decks";
import { ReviewParked } from "@/components/review-parked";
import { ReviewSession } from "@/components/review-session";
import type { Deck } from "@/lib/review";

export const Route = createFileRoute("/review")({
  component: Review,
});

/** Which of the three screens is showing, the same three the pane switches between. */
type Screen = { at: "decks" } | { at: "sitting"; deck: Deck } | { at: "parked" };

/**
 * The review, on a page of its own, sized for a phone.
 *
 * A route rather than a pane, and both rather than either. The app proper is a
 * grid of panes driven by a leader key and a vim mode, none of which a phone
 * has: no escape key, no split, no `<leader>gs`. Reviewing is the one thing
 * worth doing in a queue at a bus stop, so it gets a screen that is only
 * buttons, and `/review` is a URL you can put on a home screen.
 *
 * The two shells share all three halves of the interface. This one adds a
 * viewport and where a note opens, and nothing else, which is the property to
 * keep: a rule that lived here and not in the pane would be a rule that applies
 * on a phone and not at a desk.
 */
function Review() {
  const [screen, setScreen] = useState<Screen>({ at: "decks" });
  const navigate = useNavigate();

  return (
    <main className="h-dvh w-full">
      {screen.at === "decks" ? (
        <ReviewDecks
          onPick={(deck) => setScreen({ at: "sitting", deck })}
          onParked={() => setScreen({ at: "parked" })}
        />
      ) : screen.at === "parked" ? (
        <ReviewParked
          onLeave={() => setScreen({ at: "decks" })}
          // The page proper, which reads the note out of the URL. A phone has
          // no panes to open one in, so opening a note leaves the review.
          onOpen={(note) => void navigate({ to: "/", search: { note } })}
        />
      ) : (
        <ReviewSession deck={screen.deck} onLeave={() => setScreen({ at: "decks" })} />
      )}
    </main>
  );
}
