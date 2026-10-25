import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { amountOf } from "@/components/finance-budget-tab";
import { madeOf } from "@/components/finance-overview";
import { FinancePane } from "@/components/finance-pane";
import { euros } from "@/lib/finance-words";
import { stubCommands } from "./stub-commands";

const api = vi.hoisted(() => ({
  fetchCategories: vi.fn(),
  fetchToSort: vi.fn(),
  sortByHand: vi.fn(),
  sortPayee: vi.fn(),
  fetchBudget: vi.fn(),
  fetchFree: vi.fn(),
  fetchTrend: vi.fn(),
  fetchFlow: vi.fn(),
  fetchTransactions: vi.fn(),
  fetchAccounts: vi.fn(),
  fetchSync: vi.fn(),
  requestPull: vi.fn(),
  writeLimit: vi.fn(),
}));

vi.mock("@/lib/finance-api", () => ({
  fetchCategories: api.fetchCategories,
  fetchToSort: api.fetchToSort,
  sortByHand: api.sortByHand,
  sortPayee: api.sortPayee,
}));
// The goals card on the overview; its own tests are in finance-plans-tab.test.tsx.
vi.mock("@/lib/finance-plans-api", () => ({
  fetchGoals: () => Promise.resolve({ goals: [], accounts: [] }),
}));
vi.mock("@/lib/finance-budget-api", () => ({
  fetchBudget: api.fetchBudget,
  fetchFree: api.fetchFree,
  fetchTrend: api.fetchTrend,
  fetchFlow: api.fetchFlow,
  fetchTransactions: api.fetchTransactions,
  fetchAccounts: api.fetchAccounts,
  fetchSync: api.fetchSync,
  requestPull: api.requestPull,
  writeLimit: api.writeLimit,
}));

const part = (total: string) => ({ total, lines: [] });

const MINE = {
  total: "736.00",
  income: {
    total: "3450.00",
    lines: [
      {
        name: "Salary",
        category_id: 1,
        so_far: "0.00",
        average: "3450.00",
        counted: "3450.00",
        basis: "average",
      },
    ],
  },
  fixed: part("1247.00"),
  flexible: part("591.00"),
  non_monthly: part("0.00"),
  unsorted: "0.00",
  saved: "450.00",
  reserves: part("0.00"),
  goals: part("0.00"),
};

const GROCERIES = {
  id: 4,
  name: "Groceries",
  kind: "flexible",
  limit: "500.00",
  carried: "40.00",
  available: "460.00",
  spent: "470.00",
  average: "540.00",
  expected_by_now: "370.00",
  status: "over",
  suggestion: { direction: "raise", amount: "540.00" },
};

const RENT = {
  ...GROCERIES,
  id: 5,
  name: "Rent",
  kind: "fixed",
  limit: "1650.00",
  carried: "0.00",
  available: "1650.00",
  spent: "1650.00",
  average: "1650.00",
  expected_by_now: null,
  status: "ok",
  suggestion: null,
};

const BOOKING = {
  id: 9,
  account_id: 1,
  booking_date: "2026-10-20",
  value_date: null,
  amount: "-12.50",
  currency: "EUR",
  purpose: "Einkauf",
  posting_text: null,
  counterparty_name: "Tegut",
  counterparty_iban: null,
  bank_ref: null,
  raw: null,
  source_key: "k",
  imported_at: "2026-10-20T00:00:00Z",
  transfer_group: null,
  payee_id: 3,
  category_id: null,
  category_set_by: null,
  splits: [],
};

const node = (key: string, name: string, role: string, column: number, amount: string) => ({
  key,
  name,
  role,
  column,
  amount,
  category_id: role === "category" ? 4 : null,
});

const FLOW = {
  month: "2026-10",
  total: "3000.00",
  nodes: [
    node("income-1", "Salary", "source", 0, "3000.00"),
    node("mine", "Mine", "scope", 1, "3000.00"),
    node("kind-mine-flexible", "Flexible", "kind", 2, "400.00"),
    node("left-over-mine", "Left over", "left_over", 2, "2600.00"),
    node("category-4", "Groceries", "category", 3, "400.00"),
  ],
  links: [
    { source: "income-1", target: "mine", amount: "3000.00" },
    { source: "mine", target: "kind-mine-flexible", amount: "400.00" },
    { source: "mine", target: "left-over-mine", amount: "2600.00" },
    { source: "kind-mine-flexible", target: "category-4", amount: "400.00" },
  ],
};

beforeEach(() => {
  api.fetchCategories.mockResolvedValue([{ id: 4, name: "Groceries", kind: "flexible" }]);
  api.fetchToSort.mockResolvedValue({ total: 0, bookings: [] });
  api.sortByHand.mockResolvedValue(undefined);
  api.fetchFree.mockResolvedValue({
    month: "2026-10",
    mine: MINE,
    household: { ...MINE, total: "-20.00" },
  });
  api.fetchBudget.mockResolvedValue({
    month: "2026-10",
    share_of_month: "0.8065",
    categories: [GROCERIES, RENT],
    unreserved: { last_month: "120.00", total: "560.00" },
  });
  api.fetchTrend.mockResolvedValue({
    months: ["2026-09", "2026-10"],
    categories: [],
    totals: ["2400.00", "2100.00"],
    limits: [null, "2150.00"],
  });
  api.fetchFlow.mockResolvedValue(FLOW);
  api.fetchTransactions.mockResolvedValue([BOOKING]);
  api.fetchAccounts.mockResolvedValue([]);
  api.fetchSync.mockResolvedValue({
    requested_at: null,
    last_run: null,
    running: false,
    last_success_at: "2026-10-24T15:00:00Z",
    days_since_success: 1,
    accounts: [],
  });
  api.requestPull.mockResolvedValue(undefined);
  api.writeLimit.mockResolvedValue(undefined);
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

describe("the finance pane's overview, budget and transactions", () => {
  it("#1036 opens on the overview: both numbers, what they are made of, and what to watch", async () => {
    renderPane();

    const mine = (await screen.findByRole("heading", { name: "Mine" })).closest("article");
    expect(await within(mine as HTMLElement).findByText(/^736\s€$/)).toBeTruthy();
    expect(screen.getByText(/^over by 20\s€ ⚠$/)).toBeTruthy();
    expect(await screen.findByText(/^Over by 10\s€ ⚠$/)).toBeTruthy();
    expect(screen.getByText(/^limit cut by 40\s€ after Sept$/)).toBeTruthy();
    expect(api.fetchFree).toHaveBeenCalledWith("2026-10", "2026-10-25");
  });

  it("#1036 the made-of line names each part that is not zero", () => {
    expect(madeOf(MINE as never).replaceAll("\u00a0", " ")).toBe(
      "3.450 € income, less 1.247 € fixed, 591 € flexible, 450 € saved",
    );
  });

  it("#1036 [ and ] step the month, and P asks for a pull", async () => {
    renderPane();
    await screen.findByRole("heading", { name: "October 2026" });

    press("[");
    expect(await screen.findByRole("heading", { name: "September 2026" })).toBeTruthy();
    await waitFor(() => expect(api.fetchBudget).toHaveBeenCalledWith("2026-09", "2026-10-25"));
    press("P");
    await waitFor(() => expect(api.requestPull).toHaveBeenCalledTimes(1));
  });

  it("#1036 on the budget, y takes the suggestion and e edits the limit from the month shown", async () => {
    renderPane();
    press("B");
    await screen.findByText(/Raise to 540/);

    // Fixed comes first, so Rent is the first row and Groceries the next.
    press("j");
    press("y");
    await waitFor(() => expect(api.writeLimit).toHaveBeenCalledWith(4, "540.00", "2026-10"));

    press("k");
    press("e");
    const field = await screen.findByRole("textbox", { name: "Rent limit from October 2026" });
    fireEvent.change(field, { target: { value: "1700" } });
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(api.writeLimit).toHaveBeenCalledWith(5, "1700", "2026-10"));
  });

  it("#1036 on the transactions, a category key sorts the cursor's booking in place", async () => {
    renderPane();
    press("T");
    await screen.findByText("Tegut");

    press("1");
    await waitFor(() =>
      expect(api.sortByHand).toHaveBeenCalledWith(expect.objectContaining({ transaction: 9 }), 4),
    );
    expect(api.fetchTransactions).toHaveBeenCalledWith(
      expect.objectContaining({ month: "2026-10" }),
    );
  });

  it("#1036 a negative amount takes a minus sign, and money given back reads as plus", () => {
    expect(euros("-50").replaceAll("\u00a0", " ")).toBe("\u221250 €");
    expect(euros("-0.4").replaceAll("\u00a0", " ")).toBe("0 €");
    const drawn = { ...MINE, saved: "-200.00", flexible: part("0.00") };
    expect(madeOf(drawn as never).replaceAll("\u00a0", " ")).toBe(
      "3.450 € income, less 1.247 € fixed, plus 200 € taken from saving",
    );
  });

  it("#1036 a limit reads 1.234,56 the German way and 1234.56 alike", () => {
    expect(amountOf("1.234,56")).toBe("1234.56");
    expect(amountOf(" 1234.56 € ")).toBe("1234.56");
    expect(amountOf("")).toBeNull();
  });

  it("#1036 a refused limit keeps the field open with what was typed", async () => {
    api.writeLimit.mockRejectedValue(new Error("Only a spending category takes a limit"));
    renderPane();
    press("B");
    await screen.findByText(/Raise to 540/);

    press("e");
    const field = await screen.findByRole("textbox", { name: "Rent limit from October 2026" });
    fireEvent.change(field, { target: { value: "1.700" } });
    fireEvent.keyDown(field, { key: "Enter" });

    await waitFor(() => expect(api.writeLimit).toHaveBeenCalled());
    expect(screen.getByRole("textbox", { name: "Rent limit from October 2026" })).toHaveValue(
      "1.700",
    );
  });

  it("#1036 while a pull waits the button says so and P asks no more; a failed read shows", async () => {
    api.fetchSync.mockResolvedValue({
      requested_at: "2026-10-25T08:00:00Z",
      last_run: null,
      running: false,
      last_success_at: null,
      days_since_success: null,
      accounts: [],
    });
    renderPane();

    expect(await screen.findByRole("button", { name: "Waiting for the bank job…" })).toBeDisabled();
    press("P");
    expect(api.requestPull).not.toHaveBeenCalled();

    cleanup();
    api.fetchSync.mockRejectedValue(new Error("GET /api/finance/sync failed with 503"));
    renderPane();
    const failed = await screen.findByText("GET /api/finance/sync failed with 503");
    expect(failed.getAttribute("role")).toBe("alert");
  });

  it("#1082 the sankey says where the money went, and a category opens its bookings", async () => {
    renderPane();
    // The readout above the chart; the caption under it starts with the same words.
    const [readout] = await screen.findAllByText(/^October 2026 so far: 3.000\s€ in, 400\s€ out/);
    expect(readout?.textContent?.replaceAll("\u00a0", " ")).toBe(
      "October 2026 so far: 3.000 € in, 400 € out, 2.600 € left",
    );
    expect(screen.getByText(/The most went to Groceries 400\s€\./)).toBeTruthy();

    const left = /^Left over from Mine, 2.600\s€, 87% of the money in$/;
    fireEvent.focus(screen.getByRole("button", { name: left }));
    expect(screen.getByText(left)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^Groceries, 400\s€.*show its bookings$/ }));
    await waitFor(() =>
      expect(api.fetchTransactions).toHaveBeenCalledWith(
        expect.objectContaining({ month: "2026-10", category: 4 }),
      ),
    );
    expect(screen.getByRole("tab", { name: /Transactions/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});
