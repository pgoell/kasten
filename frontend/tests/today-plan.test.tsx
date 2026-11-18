import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TodayPane } from "@/components/today-pane";
import type { DayPlan, TodoHit, TodoRow } from "@/lib/core/api";

// The pane's other columns read through hooks of their own; only the plan and the todos matter here.
const { fetchPlan, fetchTodos, cycleStoreTodo } = vi.hoisted(() => ({
  fetchPlan: vi.fn(),
  fetchTodos: vi.fn(),
  cycleStoreTodo: vi.fn(),
}));
vi.mock("@/lib/core/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/core/api")>()),
  fetchPlan,
  fetchTodos,
  cycleStoreTodo,
}));
vi.mock("@/lib/app/push/timers-row", () => ({ TimersRow: () => null }));
vi.mock("@/lib/search/use-recent-notes", () => ({ useRecentNotes: () => [] }));
vi.mock("@/lib/review/use-review-waiting", () => ({ useReviewWaiting: () => 0 }));
vi.mock("@/lib/review/use-review-limits", () => ({
  useReviewLimits: () => ({ retry: () => {} }),
}));

function hit(id: string, words: string, line: number): TodoHit {
  const todo = { id, words, state: "open", version: 1 } as TodoRow;
  return {
    path: "daily/2026-11-18.md",
    line,
    text: `- [ ] ${words}`,
    project: null,
    shared: false,
    todo,
  } as TodoHit;
}

const PLAN: DayPlan = {
  day: "2026-11-18",
  saved: "2026-11-18T07:00:00+01:00",
  by: "me",
  blocks: [
    {
      starts: "09:00:00",
      ends: "10:30:00",
      kind: "focus",
      title: "Write the report",
      todos: ["kt-aaaaaa"],
    },
    { starts: "11:00:00", ends: "12:00:00", kind: "batch", title: "Mail", todos: [] },
  ],
};

/** Lets the plan's answer reach the pane, for the cases that look for its absence. */
async function settled() {
  await waitFor(() => expect(fetchPlan).toHaveBeenCalled());
  await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
}

function open() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TodayPane archive={false} onOpen={() => {}} onReview={() => {}} onOverview={() => {}} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  fetchPlan.mockReset();
  fetchTodos.mockReset();
  cycleStoreTodo.mockReset();
  fetchTodos.mockResolvedValue([
    hit("kt-aaaaaa", "Draft the summary", 3),
    hit("kt-bbbbbb", "Not picked", 4),
  ]);
  fetchPlan.mockResolvedValue(PLAN);
});

afterEach(() => {
  vi.useRealTimers();
});

it("shows the block that holds the present time, its todos and the next block", async () => {
  vi.setSystemTime(new Date(2026, 10, 18, 9, 30));
  open();
  expect(await screen.findByText("Write the report")).toBeTruthy();
  expect(screen.getByText("focus, 09:00 to 10:30")).toBeTruthy();
  expect(await screen.findByRole("button", { name: "Draft the summary" })).toBeTruthy();
  expect(screen.getByText("Next: 11:00 Mail")).toBeTruthy();
  expect(fetchPlan).toHaveBeenCalledWith("2026-11-18");
});

it("shows only the next block between blocks, and nothing after the last", async () => {
  vi.setSystemTime(new Date(2026, 10, 18, 10, 45));
  const { unmount } = open();
  expect(await screen.findByText("Next: 11:00 Mail")).toBeTruthy();
  expect(screen.queryByText("Now")).toBeNull();
  unmount();

  vi.setSystemTime(new Date(2026, 10, 18, 12, 15));
  open();
  await settled();
  expect(document.querySelector("[data-today-plan]")).toBeNull();
});

it("adds nothing with no plan for the day", async () => {
  vi.setSystemTime(new Date(2026, 10, 18, 9, 30));
  fetchPlan.mockResolvedValue(null);
  open();
  await settled();
  expect(document.querySelector("[data-today-plan]")).toBeNull();
  expect(screen.queryByText("Now")).toBeNull();
});

it("cycles a picked todo when its box is clicked", async () => {
  vi.setSystemTime(new Date(2026, 10, 18, 9, 30));
  cycleStoreTodo.mockResolvedValue([]);
  open();
  fireEvent.click(await screen.findByRole("button", { name: "Cycle Draft the summary" }));
  await waitFor(() => expect(cycleStoreTodo).toHaveBeenCalledWith("kt-aaaaaa"));
});
