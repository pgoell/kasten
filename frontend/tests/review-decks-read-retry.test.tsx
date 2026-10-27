import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { ReviewDecks } from "@/components/review-decks";
import * as api from "@/lib/api";
import { useReviewWaiting } from "@/lib/review/use-review-waiting";

/** One deck with one new card in it, so the overview counts one card to go. */
const HITS = [
  { path: "a.md", line: 1, text: "#flashcards/alpha" },
  { path: "a.md", line: 2, text: "a::b" },
];
/** The deck note as it stands: a tag and one new card. */
const NEW = "#flashcards/alpha\na::b";
/** The note once the rating lands: its card is due in 2099. */
const RATED = "#flashcards/alpha\na::b <!--SR:!2099-01-01,4,250-->";
const TO_GO = "1 card to go today in 1 deck.";
const DONE = "Nothing to go today.";

/** A read the backend dropped, as the fixed `fetchNote` throws it. */
function gateway(status: number): Error {
  return new Error(`GET /api/files/a.md failed with ${status}`, { cause: status });
}

/**
 * The vault's answer to each read of `a.md`, in order: its text, or the error
 * the read fails with. The last answer repeats. Other notes read empty.
 */
function vault(answers: (string | Error)[]) {
  let read = 0;
  return vi.spyOn(api, "fetchNote").mockImplementation(async (path) => {
    if (path !== "a.md") return "";
    const answer = answers[Math.min(read, answers.length - 1)] ?? "";
    read++;
    if (answer instanceof Error) throw answer;
    return answer;
  });
}

/** How many reads of `a.md` the vault has answered, failed ones included. */
function readsOf(reads: ReturnType<typeof vault>): number {
  return reads.mock.calls.filter(([path]) => path === "a.md").length;
}

/** Mounts `ui` over a client set up as `main.tsx` sets it: no retry by default. */
function mount(ui: ReactNode): QueryClient {
  vi.spyOn(api, "fetchCards").mockResolvedValue(HITS);
  vi.spyOn(api, "fetchReviewLimits").mockResolvedValue({
    new_per_day: null,
    reviews_per_day: null,
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  return client;
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

/** The count of the waiting cards, as the today pane reads it. */
function WaitingCount() {
  const waiting = useReviewWaiting(false);
  return <p>{waiting === undefined ? "reading" : `waiting ${waiting}`}</p>;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 24, 12));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** A refetch of the deck note that fails once with `failure`, then answers. */
async function healsAfter(failure: Error) {
  vault([NEW, failure, RATED]);
  const client = mount(<ReviewDecks onPick={vi.fn()} onParked={vi.fn()} />);
  await settle(100);
  expect(screen.getByText(TO_GO)).toBeInTheDocument();

  rate(client);
  await settle(5000);

  expect(screen.getByText(DONE)).toBeInTheDocument();
}

describe("ReviewDecks' reads retry a backend that is restarting (#1139)", () => {
  it("#1139 A1 the overview's count moves after its note's refetch gets a 502 and the next try answers", async () => {
    await healsAfter(gateway(502));
  });

  it("#1139 A2 a 503 on the overview's refetch heals the same way", async () => {
    await healsAfter(gateway(503));
  });

  it("#1139 A2 a 504 on the overview's refetch heals the same way", async () => {
    await healsAfter(gateway(504));
  });

  it("#1139 A2 a network error on the overview's refetch heals the same way", async () => {
    await healsAfter(new TypeError("Failed to fetch"));
  });

  it("#1139 I1 a 500 on the overview's refetch is not retried", async () => {
    const reads = vault([NEW, gateway(500), RATED]);
    const client = mount(<ReviewDecks onPick={vi.fn()} onParked={vi.fn()} />);
    await settle(100);
    expect(screen.getByText(TO_GO)).toBeInTheDocument();

    rate(client);
    await settle(60_000);

    expect(readsOf(reads)).toBe(2);
    expect(screen.getByText(TO_GO)).toBeInTheDocument();
  });

  it("#1139 I1 a 404 on the overview's refetch is not retried", async () => {
    const reads = vault([NEW, new api.NoteMissing("a.md"), RATED]);
    const client = mount(<ReviewDecks onPick={vi.fn()} onParked={vi.fn()} />);
    await settle(100);
    expect(screen.getByText(TO_GO)).toBeInTheDocument();

    rate(client);
    await settle(60_000);

    expect(readsOf(reads)).toBe(2);
    expect(screen.getByText(TO_GO)).toBeInTheDocument();
  });

  it("#1139 I1 a read error with no status is not retried", async () => {
    const reads = vault([NEW, new Error("GET /api/files/a.md failed"), RATED]);
    const client = mount(<ReviewDecks onPick={vi.fn()} onParked={vi.fn()} />);
    await settle(100);
    expect(screen.getByText(TO_GO)).toBeInTheDocument();

    rate(client);
    await settle(60_000);

    expect(readsOf(reads)).toBe(2);
    expect(screen.getByText(TO_GO)).toBeInTheDocument();
  });

  it("#1139 I2 a refetch the backend drops for a minute stops and the overview keeps its last good read", async () => {
    const reads = vault([NEW, gateway(502)]);
    const client = mount(<ReviewDecks onPick={vi.fn()} onParked={vi.fn()} />);
    await settle(100);

    rate(client);
    // The first read and seven tries inside the minute, the eighth at 60 seconds.
    await settle(59_999);
    expect(readsOf(reads)).toBe(8);

    await settle(1);
    await settle(60_000);
    expect(readsOf(reads)).toBe(9);
    expect(screen.getByText(TO_GO)).toBeInTheDocument();
  });

  it("#1139 I3 an invalidation while the overview's read retries reads afresh and shows the newest count", async () => {
    const reads = vault([NEW, gateway(502), gateway(502), RATED]);
    const client = mount(<ReviewDecks onPick={vi.fn()} onParked={vi.fn()} />);
    await settle(100);

    rate(client);
    await settle(500);
    rate(client);
    // The write's read goes out at once, and the first read's retry, due at a
    // second, is cancelled rather than adding a third read.
    await settle(500);
    expect(readsOf(reads)).toBe(3);

    await settle(1000);
    expect(readsOf(reads)).toBe(4);
    expect(screen.getByText(DONE)).toBeInTheDocument();
  });

  it("#1139 I4 the today pane's waiting count heals after its note's refetch gets a 502", async () => {
    vault([NEW, gateway(502), RATED]);
    const client = mount(<WaitingCount />);
    await settle(100);
    expect(screen.getByText("waiting 1")).toBeInTheDocument();

    rate(client);
    await settle(5000);

    expect(screen.getByText("waiting 0")).toBeInTheDocument();
  });
});
