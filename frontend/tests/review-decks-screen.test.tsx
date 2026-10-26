import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { ReviewDecks } from "@/components/review-decks";
import * as api from "@/lib/api";
import { seededClient, serveNotes } from "./review-pane-fixture";

const FOLDS = "kasten.review.folds.1";

/**
 * Alpha has a card to go, databases has one due and its subdeck postgres under
 * it, zeta has nothing due until next Thursday, and aardvark holds only a parked card.
 */
const HITS = [
  { path: "a.md", line: 1, text: "#flashcards/alpha" },
  { path: "a.md", line: 2, text: "a::b" },
  { path: "b.md", line: 1, text: "#flashcards/databases/postgres" },
  { path: "b.md", line: 2, text: "c::d <!--SR:!2026-10-20,4,250-->" },
  { path: "c.md", line: 1, text: "#flashcards/zeta" },
  { path: "c.md", line: 2, text: "e::f <!--SR:!2026-11-05,4,250-->" },
  { path: "d.md", line: 1, text: "#flashcards/aardvark" },
  { path: "d.md", line: 2, text: "g::h !suspended" },
];

/** Today is Saturday the 24th of October 2026, at noon, so the words below stay put. */
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 24, 12));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.clear();
});

function renderDecks(hits = HITS) {
  vi.spyOn(api, "fetchReviewLimits").mockResolvedValue({
    new_per_day: null,
    reviews_per_day: null,
  });
  vi.spyOn(api, "fetchCards").mockResolvedValue(hits);
  serveNotes(hits);
  const onPick = vi.fn();
  const onParked = vi.fn();
  const client = seededClient(hits);
  render(
    <QueryClientProvider client={client}>
      <ReviewDecks onPick={onPick} onParked={onParked} />
    </QueryClientProvider>,
  );
  return { onPick, onParked };
}

describe("ReviewDecks screen", () => {
  it("is headed Review", async () => {
    renderDecks();

    expect(await screen.findByRole("heading", { name: "Review" })).toBeInTheDocument();
  });

  it("says how many cards go today in how many decks, and how many are parked", async () => {
    renderDecks();

    expect(
      await screen.findByText("2 cards to go today in 2 decks. 1 parked."),
    ).toBeInTheDocument();
  });

  it("says card and deck in the singular, and leaves out the parked part when there is none", async () => {
    renderDecks([
      { path: "a.md", line: 1, text: "#flashcards/alpha" },
      { path: "a.md", line: 2, text: "a::b" },
    ]);

    expect(await screen.findByText("1 card to go today in 1 deck.")).toBeInTheDocument();
  });

  it("says nothing is to go, and offers no start, when no card is due", async () => {
    renderDecks([
      { path: "c.md", line: 1, text: "#flashcards/zeta" },
      { path: "c.md", line: 2, text: "e::f <!--SR:!2026-11-05,4,250-->" },
    ]);

    expect(await screen.findByText("Nothing to go today.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Start with/ })).not.toBeInTheDocument();
  });

  it("starts the first deck drawn with cards to go, skipping one with none", async () => {
    const { onPick } = renderDecks();

    const start = await screen.findByRole("button", { name: "Start with alpha" });
    expect(start).toHaveAttribute("data-start");
    expect(start).not.toHaveAttribute("data-deck");
    fireEvent.click(start);

    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick.mock.calls[0]?.[0]).toMatchObject({ name: "alpha" });
  });

  it("draws a subdeck with a slash before its name", async () => {
    localStorage.setItem(FOLDS, JSON.stringify(["databases"]));
    renderDecks();

    expect(await screen.findByRole("button", { name: /postgres/ })).toHaveTextContent("/ postgres");
  });

  it("says when a deck with nothing to go is next due", async () => {
    renderDecks();

    const zeta = await screen.findByRole("button", { name: /zeta/ });
    expect(zeta).toBeDisabled();
    expect(zeta).toHaveTextContent("due next Thursday");
  });

  it("puts the Anki import after the decks, under its own name", async () => {
    renderDecks();

    const zeta = await screen.findByRole("button", { name: /zeta/ });
    const entry = screen.getByText("Import an Anki deck");
    expect(zeta.compareDocumentPosition(entry) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("draws the decks with nothing due after the decks with cards, whatever their names", async () => {
    renderDecks();
    await screen.findByRole("button", { name: /^alpha/ });

    const drawn = [...document.querySelectorAll<HTMLElement>("button[data-deck]")].map(
      (row) => row.dataset.deck,
    );
    expect(drawn).toEqual(["alpha", "databases", "aardvark", "zeta"]);
  });

  it("opens the parked cards from a link that counts them", async () => {
    const { onParked } = renderDecks();

    fireEvent.click(await screen.findByRole("button", { name: "1 parked card" }));

    expect(onParked).toHaveBeenCalledTimes(1);
  });
});
