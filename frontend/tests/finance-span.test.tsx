import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { FinancePane } from "@/components/finance-pane";
import { spanName, spanOf, stepMonth } from "@/lib/finance-span";
import { stubCommands } from "./stub-commands";

const { never } = vi.hoisted(() => ({ never: () => new Promise(() => undefined) }));

const api = vi.hoisted(() => ({
  fetchFlow: vi.fn(),
  fetchRange: vi.fn(),
  fetchBudget: vi.fn(),
  fetchSetup: vi.fn(),
  writeLimits: vi.fn(),
}));

vi.mock("@/lib/finance-api", () => ({
  fetchCategories: () => Promise.resolve([]),
  fetchToSort: never,
  sortByHand: never,
  sortPayee: never,
}));
vi.mock("@/lib/finance-plans-api", () => ({ fetchGoals: never }));
vi.mock("@/lib/finance-budget-api", () => ({
  fetchBudget: api.fetchBudget,
  fetchFree: never,
  fetchTrend: never,
  fetchFlow: api.fetchFlow,
  fetchRange: api.fetchRange,
  fetchSetup: api.fetchSetup,
  writeLimits: api.writeLimits,
  fetchTransactions: never,
  fetchAccounts: () => Promise.resolve([]),
  fetchSync: never,
  requestPull: never,
  writeLimit: never,
}));

const zero = {
  income: "0.00",
  other_scope: "0.00",
  fixed: "0.00",
  flexible: "0.00",
  non_monthly: "0.00",
  reserved: "0.00",
  saved: "0.00",
  unsorted: "0.00",
  left: "0.00",
};

const RANGE = {
  first: "2026-07",
  month: "2026-09",
  months: 3,
  mine: {
    now: {
      ...zero,
      month: "2026-07",
      income: "9000.00",
      other_scope: "2700.00",
      flexible: "1200.00",
      left: "5100.00",
    },
    last_year: { ...zero, month: "2025-07", income: "8400.00", left: "8400.00" },
    average: {
      ...zero,
      month: "2026-07",
      income: "9000.00",
      other_scope: "2700.00",
      flexible: "900.00",
      left: "5400.00",
    },
  },
  household: {
    now: { ...zero, month: "2026-07", other_scope: "2700.00", fixed: "3000.00", left: "-300.00" },
    last_year: { ...zero, month: "2025-07" },
    average: null,
  },
};

const SETUP = {
  month: "2026-10",
  expected_income: "3800.00",
  limits: "1500.00",
  suggested: "1950.00",
  categories: [
    {
      id: 3,
      name: "Rent",
      kind: "fixed",
      limit: "1500.00",
      average: "1500.00",
      planned: "1450.00",
      plans: ["Rent"],
      suggested: "1450.00",
    },
    {
      id: 4,
      name: "Groceries",
      kind: "flexible",
      limit: null,
      average: "496.50",
      planned: null,
      plans: [],
      suggested: "497.00",
    },
  ],
};

beforeEach(() => {
  api.fetchFlow.mockReturnValue(never());
  api.fetchRange.mockResolvedValue(RANGE);
  api.fetchBudget.mockReturnValue(never());
  api.fetchSetup.mockResolvedValue(SETUP);
  api.writeLimits.mockResolvedValue(undefined);
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
        focusSignal={0}
        onNotice={vi.fn()}
        today="2026-10-25"
      />
    </QueryClientProvider>,
  );
}

function press(key: string) {
  fireEvent.keyDown(screen.getByRole("region", { name: "Finance" }), { key });
}

describe("the span of months", () => {
  it("#1083 a quarter or year is cut at this month, and a custom span reads either way round", () => {
    expect(spanOf("quarter", "2026-08", "2026-10")).toEqual({ from: "2026-07", to: "2026-09" });
    expect(spanOf("quarter", "2026-10", "2026-10")).toEqual({ from: "2026-10", to: "2026-10" });
    expect(spanOf("year", "2026-10", "2026-10")).toEqual({ from: "2026-01", to: "2026-10" });
    expect(spanOf("year", "2025-03", "2026-10")).toEqual({ from: "2025-01", to: "2025-12" });
    const custom = { from: "2026-09", to: "2026-05" };
    expect(spanOf("custom", "2026-10", "2026-10", custom)).toEqual({
      from: "2026-05",
      to: "2026-09",
    });
    expect(stepMonth("quarter", "2026-10", -1)).toBe("2026-07");
    expect(spanName("quarter", { from: "2026-07", to: "2026-09" }, "2026-10")).toBe("Q3 2026");
    expect(spanName("year", { from: "2026-01", to: "2026-10" }, "2026-10")).toBe("2026 so far");
    expect(spanName("custom", { from: "2026-05", to: "2026-09" }, "2026-10")).toBe(
      "May 2026 to Sept 2026",
    );
  });

  it("#1083 a quarter reads the sankey and both scopes over it, against a year before and the average", async () => {
    renderPane();
    fireEvent.change(await screen.findByRole("combobox", { name: "Span" }), {
      target: { value: "quarter" },
    });
    press("[");

    expect(await screen.findByRole("heading", { name: "Q3 2026" })).toBeTruthy();
    await waitFor(() =>
      expect(api.fetchRange).toHaveBeenCalledWith({ from: "2026-07", to: "2026-09" }),
    );
    expect(api.fetchFlow).toHaveBeenCalledWith({ from: "2026-07", to: "2026-09" });
    expect(await screen.findByText(/^left over, Q3 2026$/)).toBeTruthy();
    expect(screen.getByText(/^spent 300\s€ past what came in, Q3 2026 ⚠$/)).toBeTruthy();

    const mine = screen.getAllByRole("table")[0] as HTMLElement;
    const rows = within(mine)
      .getAllByRole("row")
      .map((row) => row.textContent?.replaceAll(" ", " "));
    expect(rows).toEqual([
      "MineQ3 2026A year before6-month average",
      "Income9.000 €8.400 € +7%9.000 € ±0%",
      // A part that was zero a year before has no change to give; spending is up a third.
      "Into household−2.700 €0 €−2.700 € ±0%",
      "Flexible−1.200 €0 €−900 € +33%",
      "Left over5.100 €8.400 € −39%5.400 € −6%",
    ]);
    const household = screen.getAllByRole("table")[1] as HTMLElement;
    expect(within(household).getAllByText("none yet").length).toBeGreaterThan(0);
  });

  it("#1083 the budget setup starts each limit from its plan or average and saves what changed", async () => {
    renderPane();
    press("B");
    press("s");

    const groceries = await screen.findByRole("textbox", {
      name: "Groceries limit from October 2026",
    });
    const rent = screen.getByRole("textbox", { name: "Rent limit from October 2026" });
    expect((rent as HTMLInputElement).value).toBe("1450");
    expect((groceries as HTMLInputElement).value).toBe("497");
    expect(screen.getByText(/^1.947\s€ of limits against 3.800\s€ expected income:/)).toBeTruthy();

    fireEvent.change(groceries, { target: { value: "2500" } });
    expect(screen.getByText(/^150\s€ over ⚠$/)).toBeTruthy();
    fireEvent.change(rent, { target: { value: "1500" } });
    fireEvent.click(screen.getByRole("button", { name: "Save 1 limit" }));
    await waitFor(() =>
      expect(api.writeLimits).toHaveBeenCalledWith("2026-10", [{ category_id: 4, amount: "2500" }]),
    );
    expect(screen.getByRole("navigation", { name: "Breadcrumbs" }).textContent).toBe(
      "October 2026Every limit",
    );
  });
});
