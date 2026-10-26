import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import { ReviewDecks } from "@/components/review-decks";
import * as api from "@/lib/api";

const BETA = "#flashcards/beta\n\nc::d\n";
const HITS = [
  { path: "a.md", line: 1, text: "#flashcards/alpha" },
  { path: "a.md", line: 2, text: "a::b" },
  { path: "b.md", line: 1, text: "#flashcards/beta" },
  { path: "b.md", line: 2, text: "c::d" },
];

/** A read the backend fails, as the API throws it: the status in `cause`. */
function gateway(url: string, status: number): Error {
  return new Error(`GET ${url} failed with ${status}`, { cause: status });
}

/**
 * Mounts the overview over `HITS`, with `a.md` answering while `healthy` is
 * set and failing with a 502 while it is not. `b.md` always answers. `healthy`
 * is set before the mount, since the first read happens on it.
 */
function overview(start = false): { client: QueryClient; setHealthy: (healthy: boolean) => void } {
  let healthy = start;
  vi.spyOn(api, "fetchCards").mockResolvedValue(HITS);
  vi.spyOn(api, "fetchReviewLimits").mockResolvedValue({
    new_per_day: null,
    reviews_per_day: null,
  });
  vi.spyOn(api, "fetchNote").mockImplementation((path) => {
    if (path === "a.md") {
      return healthy
        ? Promise.resolve("#flashcards/alpha\n\na::b\n")
        : Promise.reject(gateway("/api/files/a.md", 502));
    }
    return Promise.resolve(path === "b.md" ? BETA : "");
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ReviewDecks onPick={vi.fn()} onParked={vi.fn()} />
    </QueryClientProvider>,
  );
  return {
    client,
    setHealthy: (next) => {
      healthy = next;
    },
  };
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

describe("ReviewDecks naming the deck notes it could not read (#1153)", () => {
  it("#1153 A9 a deck note whose read fails at last is named under the decks, and the other decks still show and count", async () => {
    overview();

    await settle(61_000);

    expect(screen.getByRole("alert").textContent).toBe(
      "These notes could not be read, so their cards are not counted: a.md",
    );
    expect(screen.getByRole("button", { name: /^beta/ })).toHaveTextContent("1 new");
    expect(screen.queryByRole("button", { name: /^alpha/ })).not.toBeInTheDocument();
    expect(screen.getByText("1 card to go today in 1 deck.")).toBeInTheDocument();
  });

  it("#1153 I6 a deck note still retrying is not named, one that failed is named until a later read of it answers, then the line goes", async () => {
    const { client, setHealthy } = overview();

    await settle(5000);
    expect(screen.queryByRole("alert")).toBeNull();

    await settle(56_000);
    expect(screen.getByRole("alert").textContent).toBe(
      "These notes could not be read, so their cards are not counted: a.md",
    );

    setHealthy(true);
    rate(client);
    await settle(100);

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: /^alpha/ })).toBeInTheDocument();
  });

  it("#1153 I7 a deck note whose refetch fails while it holds an earlier good read keeps its deck and is not named", async () => {
    const { client, setHealthy } = overview(true);
    await settle(100);
    expect(screen.getByRole("button", { name: /^alpha/ })).toBeInTheDocument();

    setHealthy(false);
    rate(client);
    await settle(61_000);

    expect(screen.getByRole("button", { name: /^alpha/ })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
