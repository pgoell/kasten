import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { ReviewSession } from "@/components/review-session";
import * as api from "@/lib/api";
import type { Deck, Limits } from "@/lib/review";
import { shownCard } from "./review-card";

describe("ReviewSession under a daily limit", () => {
  const TRIVIA: Deck = {
    name: "trivia",
    notes: ["decks/trivia.md"],
    due: 2,
    fresh: 1,
    parked: 0,
    whole: false,
    next: null,
  };
  const DUE = "<!--SR:!2020-01-01,3,250-->";
  const CARDS =
    "#flashcards/trivia\n\n" +
    `Due one?::a ${DUE}\n\nDue two?::a ${DUE}\n\nDue three?::a ${DUE}\n\n` +
    "New one?::a\n\nNew two?::a\n\nNew three?::a\n";

  /** `cached` is a stale answer the limits query already holds, as the overview leaves it. */
  function renderLimited(cached?: Limits) {
    vi.spyOn(api, "fetchNote").mockImplementation((path: string) =>
      Promise.resolve(path === "99 Misc/01 Config/decks.md" ? "trivia: 1 new, 2 reviews\n" : CARDS),
    );
    // No backend here, so the defaults read would fail as a network error, which
    // now retries for a minute rather than falling back at once.
    vi.spyOn(api, "fetchReviewLimits").mockResolvedValue({
      new_per_day: null,
      reviews_per_day: null,
    });
    vi.spyOn(api, "saveNote").mockImplementation((path: string, content: string) =>
      Promise.resolve({ path, content }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    if (cached !== undefined) client.setQueryData(["cards", "limits"], cached);
    render(
      <QueryClientProvider client={client}>
        <ReviewSession deck={TRIVIA} onLeave={vi.fn()} />
      </QueryClientProvider>,
    );
  }

  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("A12 asks no more cards than the deck's limits in decks.md allow", async () => {
    renderLimited();
    await shownCard();

    expect(screen.getByText("3 left")).toBeInTheDocument();
  });

  it("I2 asks exactly the due and new cards the overview row promised, then stops", async () => {
    renderLimited();

    const asked: string[] = [];
    for (let turn = 0; turn < 3; turn += 1) {
      asked.push((await shownCard()).textContent ?? "");
      fireEvent.click(screen.getByRole("button", { name: "Show the answer" }));
      fireEvent.click(screen.getByRole("button", { name: "Good" }));
    }

    expect(asked).toEqual(["Due one?", "Due two?", "New one?"]);
    expect(await screen.findByTestId("review-done")).toHaveTextContent("3 answered");
  });

  it("#612 B1 a sitting started on a stale cache of the limits waits for their refetch", async () => {
    // Read before `decks.md` gained its line, which invalidated nothing.
    renderLimited({ note: "", defaults: { new_per_day: null, reviews_per_day: null } });
    await shownCard();

    expect(screen.getByText(/^\d+ left$/).textContent).toBe("3 left");
  });
});
