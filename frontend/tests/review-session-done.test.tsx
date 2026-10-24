import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { ReviewSession } from "@/components/review-session";
import * as api from "@/lib/api";
import { readClock, shiftDay } from "@/lib/clock";
import type { Deck } from "@/lib/review";

// The day the sitting reads as today, so the due dates below fall on it.
const TODAY = readClock(new Date()).date;

const DECK: Deck = {
  name: "aws",
  notes: ["decks/aws.md"],
  due: 0,
  fresh: 0,
  parked: 0,
  whole: false,
  next: null,
};

const WHOLE: Deck = { ...DECK, whole: true };

/**
 * The sitting over `text`, with `limits` as the deck's daily limits.
 *
 * `limits` is the text of `decks.md`, which is where a daily limit is written.
 */
function renderSitting(text: string, deck: Deck = DECK, limits = "") {
  vi.spyOn(api, "fetchNote").mockImplementation((path) =>
    Promise.resolve(
      path === "decks/aws.md" ? text : path === "99 Misc/01 Config/decks.md" ? limits : "",
    ),
  );
  vi.spyOn(api, "saveNote").mockImplementation(async (path, content) => ({ path, content }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ReviewSession deck={deck} onLeave={vi.fn()} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

it("#790 A4 the done screen counts the cards answered today, whichever sitting answered them", async () => {
  // Two cards answered today (due in four days, four days' interval), and nothing
  // left to ask: the sitting opens on the done screen with what the day did.
  const due = shiftDay(TODAY, 4);
  renderSitting(
    `#flashcards/aws\n\nQ1::A <!--SR:!${due},4,250-->\n\nQ2::B <!--SR:!${due},4,250-->\n`,
  );

  expect(await screen.findByText("2 answered today in aws.")).toBeInTheDocument();
});

it("#790 D7 the done screen says how many new cards wait, when new cards are held back", async () => {
  // A new card and a limit of none for today: nothing is asked, and the new card
  // waits for a day with room under the limit.
  renderSitting(
    "#flashcards/aws\n\nWhat does S3 stand for?::Simple Storage Service\n",
    DECK,
    "aws: 0 new, 0 reviews\n",
  );

  expect(await screen.findByText("1 new card waits.")).toBeInTheDocument();
});

it("#790 D8 the source line drops last seen when the schedule reads backwards", async () => {
  // A whole note whose interval is negative was last seen in the future, which no
  // answer could have written. The line names the note and no day count.
  const note = `---\nsr-due: ${TODAY}\nsr-interval: -3\nsr-ease: 250\n---\n# TLS\n\nthe handshake\n`;
  renderSitting(note, WHOLE);

  expect(await screen.findByText(/^From/)).toHaveTextContent(/^From aws$/);
});
