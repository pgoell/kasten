import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { ReviewDecks } from "@/components/review-decks";
import { ReviewSession } from "@/components/review-session";
import * as api from "@/lib/api";
import type { Deck } from "@/lib/review";

const DECKS = "99 Misc/01 Config/decks.md";
const NO_DEFAULTS: api.ReviewLimits = { new_per_day: null, reviews_per_day: null };
const DEFAULT_FIVE: api.ReviewLimits = { new_per_day: 5, reviews_per_day: null };

/** Twenty new cards, which the limits cut down to five. */
const NEW_CARDS = Array.from({ length: 20 }, (_, at) => `Q${at}::a`);
const ALPHA_HITS = [
  { path: "a.md", line: 1, text: "#flashcards/alpha" },
  ...NEW_CARDS.map((text, at) => ({ path: "a.md", line: at + 2, text })),
];
const ALPHA_NOTE = ["#flashcards/alpha", ...NEW_CARDS].join("\n");
const TRIVIA_NOTE = ["#flashcards/trivia", ...NEW_CARDS].join("\n");
const FIVE_NOTE = "alpha: 5 new\n";
const FIVE = "5 cards to go today in 1 deck.";
const TWENTY = "20 cards to go today in 1 deck.";
const TRIVIA: Deck = {
  name: "trivia",
  notes: ["decks/trivia.md"],
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

/** `decks.md` answers each read in turn, and every other note reads as `notes` has it. */
function vault(decks: (string | Error)[], notes: Record<string, string>) {
  const next = answers(decks);
  return vi
    .spyOn(api, "fetchNote")
    .mockImplementation((path) => (path === DECKS ? next() : Promise.resolve(notes[path] ?? "")));
}

/** The limits read, answered as `list` has it. */
function limits(list: (api.ReviewLimits | Error)[]) {
  return vi.spyOn(api, "fetchReviewLimits").mockImplementation(answers(list));
}

/** How many reads of `path` the vault has answered, failed ones included. */
function readsOf(spy: ReturnType<typeof vault>, path: string): number {
  return spy.mock.calls.filter(([read]) => read === path).length;
}

/** Mounts `ui` over a client set up as `main.tsx` sets it: no retry by default. */
function mount(ui: ReactNode): QueryClient {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  return client;
}

/** The overview over the alpha deck, its twenty cards in `a.md`. */
function overview(): QueryClient {
  vi.spyOn(api, "fetchCards").mockResolvedValue(ALPHA_HITS);
  return mount(<ReviewDecks onPick={vi.fn()} onParked={vi.fn()} />);
}

/** Lets the timers run on, and the updates they cause land on screen. */
async function settle(ms: number) {
  await act(() => vi.advanceTimersByTimeAsync(ms));
}

/** What a rating sends: an invalidation of every `cards` query. */
function rate(client: QueryClient) {
  act(() => {
    void client.invalidateQueries({ queryKey: ["cards"] });
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 24, 12));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** A refetch of `decks.md` that fails once with `failure`, then answers: the count must not move. */
async function healsAfter(failed: Error) {
  const decks = vault([FIVE_NOTE, failed, FIVE_NOTE], { "a.md": ALPHA_NOTE });
  limits([NO_DEFAULTS]);
  const client = overview();
  await settle(100);
  expect(screen.getByText(FIVE)).toBeInTheDocument();

  rate(client);
  await settle(5000);

  expect(screen.getByText(FIVE)).toBeInTheDocument();
  expect(readsOf(decks, DECKS)).toBe(3);
}

describe("the daily limits' reads retry a backend that is restarting (#1149)", () => {
  it("#1149 A1 the overview counts within new_per_day after the limits refetch gets a 502 and the next try answers", async () => {
    await healsAfter(failure(`/api/files/${DECKS}`, 502));
  });

  it("#1149 A2 a 503 on the limits read heals the same way", async () => {
    await healsAfter(failure(`/api/files/${DECKS}`, 503));
  });

  it("#1149 A2 a 504 on the limits read heals the same way", async () => {
    await healsAfter(failure(`/api/files/${DECKS}`, 504));
  });

  it("#1149 A2 a network error on the limits read heals the same way", async () => {
    await healsAfter(new TypeError("Failed to fetch"));
  });

  it("#1149 A3 a sitting opened while the limits read gets a 502 waits for the next try and asks no more new cards than new_per_day", async () => {
    vault([failure(`/api/files/${DECKS}`, 502), "trivia: 5 new\n"], {
      "decks/trivia.md": TRIVIA_NOTE,
    });
    limits([NO_DEFAULTS]);
    mount(<ReviewSession deck={TRIVIA} onLeave={vi.fn()} />);
    await settle(100);

    await settle(1500);

    expect(screen.getByText("5 left")).toBeInTheDocument();
  });

  it("#1149 A4 a missing decks.md still means no per-deck limits, at once, one read, no error", async () => {
    const decks = vault([new api.NoteMissing(DECKS)], { "a.md": ALPHA_NOTE });
    limits([NO_DEFAULTS]);
    overview();
    await settle(100);

    await settle(60_000);

    expect(screen.getByText(TWENTY)).toBeInTheDocument();
    expect(readsOf(decks, DECKS)).toBe(1);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("#1149 I1 a limits read that fails at last with nothing cached says so on the overview and offers no rows", async () => {
    vault([FIVE_NOTE], { "a.md": ALPHA_NOTE });
    const reads = limits([failure("/api/review/limits", 502)]);
    overview();

    await settle(61_000);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "The daily limits could not be read: GET /api/review/limits failed with 502",
    );
    expect(screen.queryByRole("button", { name: /^Start with/ })).toBeNull();
    expect(document.querySelector("button[data-deck]")).toBeNull();
    expect(screen.queryByText("Reading the vault…")).toBeNull();
    expect(reads).toHaveBeenCalledTimes(8);
  });

  it("#1149 I1 a sitting opened on a limits read that fails at last says so in its foot and asks nothing", async () => {
    const notes = vault([""], { "decks/trivia.md": TRIVIA_NOTE });
    limits([failure("/api/review/limits", 502)]);
    mount(<ReviewSession deck={TRIVIA} onLeave={vi.fn()} />);

    await settle(61_000);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "The daily limits could not be read: GET /api/review/limits failed with 502",
    );
    expect(screen.queryByTestId("review-card")).toBeNull();
    expect(readsOf(notes, "decks/trivia.md")).toBe(0);
  });

  it("#1149 I2 a limits refetch that fails at last keeps the good answer cached, and the overview still counts within the limit", async () => {
    vault([FIVE_NOTE, failure(`/api/files/${DECKS}`, 502)], { "a.md": ALPHA_NOTE });
    limits([NO_DEFAULTS]);
    const client = overview();
    await settle(100);
    expect(screen.getByText(FIVE)).toBeInTheDocument();

    rate(client);
    await settle(61_000);

    expect(screen.getByText(FIVE)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("#1149 I3 a 500 on decks.md is not retried and falls back on no limit", async () => {
    const decks = vault([FIVE_NOTE, failure(`/api/files/${DECKS}`, 500)], { "a.md": ALPHA_NOTE });
    limits([NO_DEFAULTS]);
    const client = overview();
    await settle(100);
    expect(screen.getByText(FIVE)).toBeInTheDocument();

    rate(client);
    await settle(60_000);

    expect(readsOf(decks, DECKS)).toBe(2);
    expect(screen.getByText(TWENTY)).toBeInTheDocument();
  });

  it("#1149 I3 a 500 on /api/review/limits is not retried and falls back on no limit", async () => {
    vault([""], { "a.md": ALPHA_NOTE });
    const reads = limits([DEFAULT_FIVE, failure("/api/review/limits", 500)]);
    const client = overview();
    await settle(100);
    expect(screen.getByText(FIVE)).toBeInTheDocument();

    rate(client);
    await settle(60_000);

    expect(reads).toHaveBeenCalledTimes(2);
    expect(screen.getByText(TWENTY)).toBeInTheDocument();
  });

  it("#1149 I3 a read error with no status is not retried and falls back on no limit", async () => {
    const decks = vault([FIVE_NOTE, new Error(`GET /api/files/${DECKS} failed`)], {
      "a.md": ALPHA_NOTE,
    });
    limits([NO_DEFAULTS]);
    const client = overview();
    await settle(100);
    expect(screen.getByText(FIVE)).toBeInTheDocument();

    rate(client);
    await settle(60_000);

    expect(readsOf(decks, DECKS)).toBe(2);
    expect(screen.getByText(TWENTY)).toBeInTheDocument();
  });
});
