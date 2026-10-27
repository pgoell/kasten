import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { ReviewPane } from "@/components/review-pane";
import { ReviewSession } from "@/components/review-session";
import * as api from "@/lib/api";
import { readRetry } from "@/lib/read-retry";
import type { Deck } from "@/lib/review/review";
import { shownCard } from "./review-card";
import { HITS, serveNotes } from "./review-pane-fixture";
import { stubCommands } from "./stub-commands";

const NOTE = "decks/trivia.md";
const NO_LIMITS: api.ReviewLimits = { new_per_day: null, reviews_per_day: null };
const LIMITS_ALERT = "The daily limits could not be read: GET /api/review/limits failed with 502";

/** Twenty new cards, which the sitting asks in order. */
const NEW_CARDS = Array.from({ length: 20 }, (_, at) => `Q${at}::a`);
const TRIVIA_NOTE = ["#flashcards/trivia", ...NEW_CARDS].join("\n");
const TRIVIA: Deck = {
  name: "trivia",
  notes: [NOTE],
  due: 0,
  fresh: 20,
  parked: 0,
  whole: false,
  next: null,
};

/** A read the backend fails, as the API throws it: the status in `cause`. */
function failure(url: string, status: number): Error {
  return new Error(`GET ${url} failed with ${status}`, { cause: status });
}

/** The deck note reads as `TRIVIA_NOTE`, and `decks.md` reads as empty. */
function deckNote() {
  vi.spyOn(api, "fetchNote").mockImplementation((path) =>
    Promise.resolve(path === NOTE ? TRIVIA_NOTE : ""),
  );
}

/**
 * The limits read is refused while `state.down` is set, and answers once the
 * test clears it, as a backend that comes back does.
 */
function limitsDown() {
  const state = { down: true };
  vi.spyOn(api, "fetchReviewLimits").mockImplementation(() =>
    state.down ? Promise.reject(failure("/api/review/limits", 502)) : Promise.resolve(NO_LIMITS),
  );
  return state;
}

/** Mounts `ui` over a client set up as `main.tsx` sets it: no retry by default. */
function mount(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

/**
 * Lets the timers run on, and the updates they cause land on screen. Each call
 * is its own act, so the effects a render starts run before the clock moves on.
 */
async function settle(ms: number) {
  await act(() => vi.advanceTimersByTimeAsync(ms));
}

/** The foot's button that reads again. */
const tryAgain = () => screen.queryByRole("button", { name: "Try again" });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 24, 12));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("a sitting whose daily limits read failed for good can try again (#1167)", () => {
  it("#1167 A1 a sitting whose limits read failed for good reads them again on Try again and asks the card, with no alert", async () => {
    deckNote();
    const backend = limitsDown();
    mount(<ReviewSession deck={TRIVIA} onLeave={vi.fn()} />);
    await settle(61_000);
    expect(screen.getByRole("alert")).toHaveTextContent(LIMITS_ALERT);

    backend.down = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await settle(100);

    expect(screen.getByTestId("review-card")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(tryAgain()).toBeNull();
  });

  it("#1167 I1 a limits Try again while the backend is still down says Reading the deck, retries, then offers the limits alert and Try again again", async () => {
    deckNote();
    limitsDown();
    mount(<ReviewSession deck={TRIVIA} onLeave={vi.fn()} />);
    await settle(61_000);
    expect(screen.getByRole("alert")).toHaveTextContent(LIMITS_ALERT);

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await settle(100);
    expect(screen.getByText("Reading the deck…")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(tryAgain()).toBeNull();

    await settle(61_000);
    expect(screen.getByRole("alert")).toHaveTextContent(LIMITS_ALERT);
    expect(tryAgain()).not.toBeNull();
  });

  it("#1167 I2 after a limits Try again answered a rating whose write fails shows its alert with no Try again", async () => {
    deckNote();
    const backend = limitsDown();
    mount(<ReviewSession deck={TRIVIA} onLeave={vi.fn()} />);
    await settle(61_000);

    backend.down = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await settle(100);
    expect(screen.getByTestId("review-card")).toBeInTheDocument();

    vi.spyOn(api, "saveNote").mockRejectedValue(failure(`/api/files/${NOTE}`, 500));
    fireEvent.click(screen.getByRole("button", { name: "Show the answer" }));
    fireEvent.click(screen.getByRole("button", { name: "Good" }));
    await settle(100);

    expect(screen.getByRole("alert")).toHaveTextContent("The note could not be written");
    expect(tryAgain()).toBeNull();
  });

  it("#1167 I3 Enter on the focused limits Try again in the review pane reads the limits again", async () => {
    // Real timers: the pane's own reads are awaited with `findBy`, not advanced by hand.
    vi.useRealTimers();
    // One refused read, not a minute of tries, so the foot shows at once.
    vi.spyOn(readRetry, "retry").mockReturnValue(false);
    const backend = limitsDown();
    backend.down = false;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.spyOn(api, "fetchCards").mockResolvedValue(HITS);
    serveNotes(HITS);
    render(
      <QueryClientProvider client={client}>
        <ReviewPane commands={stubCommands()} onClose={vi.fn()} onOpen={vi.fn()} />
      </QueryClientProvider>,
    );
    const pane = await screen.findByLabelText("review");
    await screen.findByRole("button", { name: /^alpha/ });
    fireEvent.keyDown(pane, { key: "j" });
    fireEvent.keyDown(pane, { key: "j" });
    // The overview's answer would hold the sitting's limits, and a cached answer
    // is never refused, so it is dropped and the sitting's own read is the one that fails.
    client.removeQueries({ queryKey: ["cards", "limits"] });
    backend.down = true;
    fireEvent.keyDown(pane, { key: "l" });
    const again = await screen.findByRole("button", { name: "Try again" });

    again.focus();
    backend.down = false;
    // The pane leaves a button's Enter to the browser, which then clicks it.
    expect(fireEvent.keyDown(again, { key: "Enter" })).toBe(true);
    fireEvent.click(again);

    expect(await shownCard()).toHaveTextContent("c");
  });
});
