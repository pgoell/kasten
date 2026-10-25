import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { amountOf, positive } from "@/components/finance-budget-tab";
import { madeOf } from "@/components/finance-overview";
import { FinancePane } from "@/components/finance-pane";
import { euros } from "@/lib/finance-words";
import { stubCommands } from "./stub-commands";

const api = vi.hoisted(() => ({
  fetchPlans: vi.fn(),
  fetchUpcoming: vi.fn(),
  fetchForecast: vi.fn(),
  fetchProposals: vi.fn(),
  fetchGoals: vi.fn(),
  writePlan: vi.fn(),
  writeGoal: vi.fn(),
  assignGoal: vi.fn(),
  undoAssign: vi.fn(),
  fetchBudget: vi.fn(),
}));

vi.mock("@/lib/finance-plans-api", async (actual) => ({
  ...(await actual<typeof import("@/lib/finance-plans-api")>()),
  ...api,
}));
vi.mock("@/lib/finance-api", () => ({
  fetchCategories: () => Promise.resolve([]),
  fetchToSort: () => Promise.resolve({ total: 0, bookings: [] }),
}));
vi.mock("@/lib/finance-budget-api", () => ({
  fetchBudget: api.fetchBudget,
  fetchAccounts: () => Promise.resolve([]),
  fetchSync: () => Promise.reject(new Error("no sync here")),
}));

const PROPOSAL = {
  key: "bill:Haftpflicht",
  source: "bill",
  name: "Haftpflicht",
  account_id: 1,
  payee_id: 9,
  text: null,
  amount: "-498.00",
  tolerance: "12.00",
  every_months: 12,
  category_id: 3,
  start: "2026-03-02",
  seen: 1,
  last: "2026-03-02",
};

const WEDDING = {
  id: 7,
  name: "Wedding",
  target: "12000.00",
  due: "2027-08-01",
  account_id: 5,
  reserved: "4500.00",
  monthly: "500.00",
  progress: "0.3750",
  need: "750.00",
  this_month: { planned: "500.00", moved: "500.00", done: true },
  assigned_month: null,
  assigned_amount: null,
};

const ACCOUNT = {
  id: 5,
  name: "DKB Personal Saving",
  balance: "21300.00",
  balance_date: "2026-10-24",
  reserved: "4500.00",
  unreserved: "16800.00",
};

beforeEach(() => {
  api.fetchPlans.mockResolvedValue([]);
  api.fetchUpcoming.mockResolvedValue([
    {
      plan_id: 1,
      name: "Miete",
      due: "2026-10-01",
      amount: "-950.00",
      category_id: 2,
      reserves: false,
      match: {
        transaction_id: 4,
        booking_date: "2026-09-30",
        amount: "-950.00",
        timing: "early",
      },
      counts_for: null,
    },
  ]);
  api.fetchForecast.mockResolvedValue({
    mine: { balance: "0.00", months: [] },
    household: { balance: "0.00", months: [] },
  });
  api.fetchProposals.mockResolvedValue([PROPOSAL]);
  api.fetchGoals.mockResolvedValue({ goals: [WEDDING], accounts: [ACCOUNT] });
  api.writePlan.mockResolvedValue(undefined);
  api.writeGoal.mockResolvedValue(undefined);
  api.assignGoal.mockResolvedValue(undefined);
  api.undoAssign.mockResolvedValue(undefined);
  api.fetchBudget.mockResolvedValue({
    month: "2026-10",
    share_of_month: "0.8",
    categories: [],
    unreserved: { last_month: "40.00", total: "120.00", moved: "0.00" },
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderPane() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <FinancePane
        commands={stubCommands()}
        focusSignal={1}
        onNotice={() => undefined}
        today="2026-10-25"
      />
    </QueryClientProvider>,
  );
  const pane = screen.getByRole("region", { name: "Finance" });
  fireEvent.keyDown(pane, { key: "G" });
  return pane;
}

describe("the finance pane's plans and goals", () => {
  it("#1037 a proposal is confirmed with its key, as it was proposed", async () => {
    const pane = renderPane();
    await screen.findByText("Haftpflicht");
    expect(screen.getByText(/Yearly, a Firefly bill, seen once/)).toBeTruthy();
    fireEvent.keyDown(pane, { key: "1" });
    await waitFor(() => expect(api.writePlan).toHaveBeenCalledTimes(1));
    const { key: _k, source: _s, seen: _n, last: _l, ...plan } = PROPOSAL;
    expect(api.writePlan.mock.calls[0]).toEqual([plan, "2026-10-25"]);
  });

  it("#1037 a date a booking met has its tick, and a goal says its month", async () => {
    renderPane();
    expect(await screen.findByRole("img", { name: "met" })).toBeTruthy();
    expect(screen.getByText(/met 30 Sept?, early, −950,00/)).toBeTruthy();
    expect(await screen.findByText("500 € moved this month ✓")).toBeTruthy();
    expect(screen.getByText(/needs 750 € a month/)).toBeTruthy();
    expect(screen.getByText("16.800 € of 21.300 €")).toBeTruthy();
    expect(screen.getByText("Not reserved on DKB Personal Saving")).toBeTruthy();
    expect(await screen.findByText(/Left from limits: 120,00/)).toBeTruthy();
  });

  it("#1037 a assigns the month's contribution once, and u takes it back", async () => {
    const pane = renderPane();
    await screen.findByText("Wedding");
    fireEvent.keyDown(pane, { key: "a" });
    await waitFor(() => expect(api.assignGoal).toHaveBeenCalledWith(7, "2026-10-25"));
    cleanup();
    api.fetchGoals.mockResolvedValue({
      goals: [{ ...WEDDING, assigned_month: "2026-10", assigned_amount: "500.00" }],
      accounts: [ACCOUNT],
    });
    const again = renderPane();
    expect(await screen.findByText("500 € assigned ✓")).toBeTruthy();
    fireEvent.keyDown(again, { key: "a" });
    fireEvent.keyDown(again, { key: "u" });
    await waitFor(() => expect(api.undoAssign).toHaveBeenCalledWith(7, "2026-10-25"));
    expect(api.assignGoal).toHaveBeenCalledTimes(1);
  });

  it("#1037 a proposal with nothing to match opens the form, whose keys rest", async () => {
    api.fetchProposals.mockResolvedValue([{ ...PROPOSAL, payee_id: null, text: null }]);
    const pane = renderPane();
    await screen.findByText("Haftpflicht");
    fireEvent.keyDown(pane, { key: "1" });
    expect(await screen.findByRole("textbox", { name: "Name" })).toBeTruthy();
    expect(api.writePlan).not.toHaveBeenCalled();
    // With the form open a goal key does nothing.
    fireEvent.keyDown(pane, { key: "a" });
    expect(api.assignGoal).not.toHaveBeenCalled();
    fireEvent.keyDown(pane, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "Name" })).toBeNull());
  });

  it("#1037 amounts read the German way and an assign that cannot happen says why", async () => {
    expect(amountOf("1.200")).toBe("1200");
    expect(amountOf("1.200,50")).toBe("1200.50");
    expect(amountOf("12.5")).toBe("12.5");
    expect(positive("abc")).toBeUndefined();
    expect(positive("0")).toBeUndefined();
    api.fetchGoals.mockResolvedValue({
      goals: [WEDDING],
      accounts: [{ ...ACCOUNT, unreserved: "100.00" }],
    });
    renderPane();
    expect(await screen.findByText(/only 100 € not reserved on DKB Personal Saving/)).toBeTruthy();
  });

  it("#1037 the made-of line names the reserves and the goals still to move", () => {
    const part = (total: string) => ({ total, lines: [] });
    const free = {
      total: "100.00",
      income: part("1000.00"),
      fixed: part("0.00"),
      flexible: part("0.00"),
      non_monthly: part("0.00"),
      unsorted: "0.00",
      saved: "0.00",
      reserves: part("50.00"),
      goals: part("300.00"),
    };
    expect(madeOf(free)).toBe(
      `${euros(1000)} income, less ${euros(50)} reserved for plans, ${euros(300)} still to move to goals`,
    );
  });
});
