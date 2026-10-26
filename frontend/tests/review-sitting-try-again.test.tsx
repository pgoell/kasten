import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { ReviewSession } from "@/components/review-session";
import * as api from "@/lib/api";
import type { Deck } from "@/lib/review";
import { shownCard } from "./review-card";
import { renderPane } from "./review-pane-fixture";

const NOTE = "decks/trivia.md";
const NO_LIMITS: api.ReviewLimits = { new_per_day: null, reviews_per_day: null };

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

/**
 * The answer to each read in turn, the last one repeating. An `Error` in the
 * list is thrown in place of an answer.
 */
function answers<T>(list: (T | Error)[]): () => Promise<T> {
  let read = 0;
  return async () => {
    const answer = list[Math.min(read, list.length - 1)] as T | Error;
    read += 1;
    if (answer instanceof Error) throw answer;
    return answer;
  };
}

/**
 * The deck note answers each read in turn. `decks.md` reads as empty, so the
 * sitting has no per-deck limits and its own reads are the only ones counted.
 */
function deckNote(reads: (string | Error)[]) {
  const next = answers(reads);
  return vi
    .spyOn(api, "fetchNote")
    .mockImplementation((path) => (path === NOTE ? next() : Promise.resolve("")));
}

/** How many reads of `path` the vault has answered, failed ones included. */
function readsOf(spy: ReturnType<typeof deckNote>, path: string): number {
  return spy.mock.calls.filter(([read]) => read === path).length;
}

/** Mounts `ui` over a client set up as `main.tsx` sets it: no retry by default. */
function mount(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

/**
 * Lets the timers run on, and the updates they cause land on screen. Each call
 * is its own act, so the effects a render starts run before the clock moves on:
 * the first deck read starts only once the limits read has rendered.
 */
async function settle(ms: number) {
  await act(() => vi.advanceTimersByTimeAsync(ms));
}

/** The foot's button that reads the deck again. */
const tryAgain = () => screen.queryByRole("button", { name: "Try again" });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 24, 12));
  vi.spyOn(api, "fetchReviewLimits").mockResolvedValue(NO_LIMITS);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("a sitting whose deck note read failed for good can try again (#1163)", () => {
  it("#1163 A3 a sitting whose deck read failed for good reads it again on Try again and asks the card, with no alert", async () => {
    const reads = deckNote([failure(`/api/files/${NOTE}`, 500), TRIVIA_NOTE]);
    mount(<ReviewSession deck={TRIVIA} onLeave={vi.fn()} />);

    await settle(100);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await settle(100);

    expect(screen.getByTestId("review-card")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(tryAgain()).toBeNull();
    expect(readsOf(reads, NOTE)).toBe(2);
  });

  it("#1163 I1 after Try again answered a rating whose write fails shows its alert with no Try again", async () => {
    deckNote([failure(`/api/files/${NOTE}`, 500), TRIVIA_NOTE]);
    mount(<ReviewSession deck={TRIVIA} onLeave={vi.fn()} />);
    await settle(100);
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

  it("#1163 I2 a Try again while the backend is still down says Reading the deck, retries, then offers Try again again", async () => {
    const reads = deckNote([
      failure(`/api/files/${NOTE}`, 500),
      failure(`/api/files/${NOTE}`, 502),
    ]);
    mount(<ReviewSession deck={TRIVIA} onLeave={vi.fn()} />);
    await settle(100);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    await settle(100);
    expect(screen.getByText("Reading the deck…")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(tryAgain()).toBeNull();

    await settle(61_000);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The note could not be read: GET /api/files/decks/trivia.md failed with 502",
    );
    expect(tryAgain()).not.toBeNull();
    expect(readsOf(reads, NOTE)).toBe(1 + 8);
  });

  it("#1163 I3 a sitting left while a Try again read retries reads no more", async () => {
    const reads = deckNote([
      failure(`/api/files/${NOTE}`, 500),
      failure(`/api/files/${NOTE}`, 502),
    ]);
    const view = mount(<ReviewSession deck={TRIVIA} onLeave={vi.fn()} />);
    await settle(100);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await settle(1000);
    const before = readsOf(reads, NOTE);
    expect(before).toBeGreaterThan(1);

    view.unmount();
    await settle(60_000);

    expect(readsOf(reads, NOTE)).toBe(before);
  });

  it("#1163 I4 Enter on the focused Try again in the review pane reads the deck again", async () => {
    // Real timers: the pane's own reads are awaited with `findBy`, not advanced by hand.
    vi.useRealTimers();
    const pane = await renderPane();
    const BETA = "#flashcards/beta\n\nc::d\n\ne::f\n";
    let broken = true;
    vi.spyOn(api, "fetchNote").mockImplementation((path) => {
      if (path !== "b.md") return Promise.resolve("");
      return broken ? Promise.reject(failure("/api/files/b.md", 500)) : Promise.resolve(BETA);
    });
    fireEvent.keyDown(pane, { key: "j" });
    fireEvent.keyDown(pane, { key: "j" });
    fireEvent.keyDown(pane, { key: "l" });
    const again = await screen.findByRole("button", { name: "Try again" });

    again.focus();
    broken = false;
    // The pane leaves a button's Enter to the browser, which then clicks it.
    expect(fireEvent.keyDown(again, { key: "Enter" })).toBe(true);
    fireEvent.click(again);

    expect(await shownCard()).toHaveTextContent("c");
  });
});
