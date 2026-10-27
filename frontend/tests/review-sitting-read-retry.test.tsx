import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { ReviewSession } from "@/components/review-session";
import * as api from "@/lib/api";
import type { Deck } from "@/lib/review/review";

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

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 24, 12));
  vi.spyOn(api, "fetchReviewLimits").mockResolvedValue(NO_LIMITS);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** A deck note read that fails once with `failed`, then answers: the card comes up with no alert. */
async function healsAfter(failed: Error) {
  const reads = deckNote([failed, TRIVIA_NOTE]);
  mount(<ReviewSession deck={TRIVIA} onLeave={vi.fn()} />);

  await settle(100);
  await settle(1500);

  expect(screen.getByTestId("review-card")).toBeInTheDocument();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(readsOf(reads, NOTE)).toBe(2);
}

describe("a sitting's deck note reads retry a backend that is restarting (#1158)", () => {
  it("#1158 A1 a sitting whose deck note read gets a 502 reads it again and asks the card, with no alert", async () => {
    await healsAfter(failure(`/api/files/${NOTE}`, 502));
  });

  it("#1158 A2 a 503 on a sitting's deck note read is read again the same way", async () => {
    await healsAfter(failure(`/api/files/${NOTE}`, 503));
  });

  it("#1158 A2 a 504 on a sitting's deck note read is read again the same way", async () => {
    await healsAfter(failure(`/api/files/${NOTE}`, 504));
  });

  it("#1158 A2 a network error on a sitting's deck note read is read again the same way", async () => {
    await healsAfter(new TypeError("Failed to fetch"));
  });

  it("#1158 A3 a deck note read that fails for the whole minute says the note could not be read, after eight tries", async () => {
    const reads = deckNote([failure(`/api/files/${NOTE}`, 502)]);
    mount(<ReviewSession deck={TRIVIA} onLeave={vi.fn()} />);

    await settle(100);
    await settle(61_000);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(
      "The note could not be read: GET /api/files/decks/trivia.md failed with 502",
    );
    expect(alert).not.toHaveTextContent("written");
    expect(readsOf(reads, NOTE)).toBe(8);
  });

  it("#1158 I1 while a sitting's deck note read retries the screen says Reading the deck and shows no alert", async () => {
    deckNote([failure(`/api/files/${NOTE}`, 502), TRIVIA_NOTE]);
    mount(<ReviewSession deck={TRIVIA} onLeave={vi.fn()} />);

    await settle(100);

    expect(screen.getByText("Reading the deck…")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("#1158 I2 a 500 on a sitting's deck note read is not retried and says the note could not be read at once", async () => {
    const reads = deckNote([failure(`/api/files/${NOTE}`, 500)]);
    mount(<ReviewSession deck={TRIVIA} onLeave={vi.fn()} />);

    await settle(100);
    await settle(60_000);

    expect(readsOf(reads, NOTE)).toBe(1);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The note could not be read: GET /api/files/decks/trivia.md failed with 500",
    );
  });

  it("#1158 I3 a sitting closed while its deck note read retries reads no more", async () => {
    const reads = deckNote([failure(`/api/files/${NOTE}`, 502)]);
    const view = mount(<ReviewSession deck={TRIVIA} onLeave={vi.fn()} />);
    await settle(100);
    await settle(1000);
    expect(readsOf(reads, NOTE)).toBe(2);

    view.unmount();
    await settle(60_000);

    expect(readsOf(reads, NOTE)).toBe(2);
  });
});
