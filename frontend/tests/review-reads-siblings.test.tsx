import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { ReviewParked } from "@/components/review-parked";
import { ReviewSession } from "@/components/review-session";
import * as api from "@/lib/api";
import type { Deck } from "@/lib/review/review";

const SR = "<!--SR:!2026-08-20,4,270-->";
const A = `#flashcards/aws\n\nQ A?::answer A !suspended ${SR}\n`;
const B = `#flashcards/aws\n\nQ B?::answer B !suspended ${SR}\n`;

const ONE = "decks/one.md";
const TWO = "decks/two.md";
const DECK: Deck = {
  name: "two",
  notes: [ONE, TWO],
  due: 0,
  fresh: 2,
  parked: 0,
  whole: false,
  next: null,
};

/** The scan's lines for a note, the way the search answers them. */
function hitsOf(path: string, text: string) {
  return text.split("\n").map((line, i) => ({ path, line: i + 1, text: line }));
}

/** The error the API throws for a request the backend answered with `status`. */
function failed(path: string, status: number) {
  return new Error(`GET /api/${path} failed with ${status}`, { cause: status });
}

/** How many reads of `path` the vault has answered, failed ones included. */
function readsOf(spy: { mock: { calls: unknown[][] } }, path: string): number {
  return spy.mock.calls.filter(([read]) => read === path).length;
}

/** Mounts `ui` over a client set up as `main.tsx` sets it: no retry by default. */
function mount(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

/** Lets the fake clock run on, so the screen's queries and reads move. */
async function settle(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("a multi-note read that fails for good stops its other reads (#1162)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 24, 12));
    vi.spyOn(api, "fetchReviewLimits").mockResolvedValue({
      new_per_day: null,
      reviews_per_day: null,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("#1162 A1 a parked list whose one note fails for good reads its other note no more", async () => {
    vi.spyOn(api, "fetchCards").mockResolvedValue([...hitsOf("a.md", A), ...hitsOf("b.md", B)]);
    const reads = vi.spyOn(api, "fetchNote").mockImplementation(async (path) => {
      if (path === "a.md") throw failed("files/a.md", 500);
      throw failed("files/b.md", 502);
    });
    mount(<ReviewParked onLeave={vi.fn()} onOpen={vi.fn()} />);

    await settle(0);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(readsOf(reads, "b.md")).toBe(1);

    await settle(61_000);
    expect(readsOf(reads, "b.md")).toBe(1);
  });

  it("#1162 A2 a sitting whose one deck note fails for good reads its other deck note no more", async () => {
    const reads = vi.spyOn(api, "fetchNote").mockImplementation(async (path) => {
      if (path === ONE) throw failed(`files/${ONE}`, 500);
      if (path === TWO) throw failed(`files/${TWO}`, 502);
      return "";
    });
    mount(<ReviewSession deck={DECK} onLeave={vi.fn()} />);

    await settle(100);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(readsOf(reads, TWO)).toBe(1);

    await settle(61_000);
    expect(readsOf(reads, TWO)).toBe(1);
  });
});
