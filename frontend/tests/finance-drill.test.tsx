import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { FinancePane } from "@/components/finance-pane";
import { stubCommands } from "./stub-commands";

/** A read the test does not look at: it never answers, so its card stays empty. */
const { never } = vi.hoisted(() => ({ never: () => new Promise(() => undefined) }));

const api = vi.hoisted(() => ({
  fetchCategories: vi.fn(),
  sortByHand: vi.fn(),
  sortPayee: vi.fn(),
  fetchTransactions: vi.fn(),
  fetchScope: vi.fn(),
  fetchAccountDrill: vi.fn(),
  fetchCategoryDrill: vi.fn(),
  fetchPayeeDrill: vi.fn(),
  fetchBookingDrill: vi.fn(),
  writeSplits: vi.fn(),
  writePayeeRule: vi.fn(),
}));

vi.mock("@/lib/finance-api", () => ({
  fetchCategories: api.fetchCategories,
  fetchToSort: never,
  sortByHand: api.sortByHand,
  sortPayee: api.sortPayee,
}));
vi.mock("@/lib/finance-plans-api", () => ({ fetchGoals: never }));
vi.mock("@/lib/finance-budget-api", () => ({
  fetchBudget: never,
  fetchFree: never,
  fetchTrend: never,
  fetchFlow: never,
  fetchTransactions: api.fetchTransactions,
  fetchAccounts: () => Promise.resolve([]),
  fetchSync: never,
  requestPull: never,
  writeLimit: never,
}));
vi.mock("@/lib/finance-drill-api", () => ({
  fetchScope: api.fetchScope,
  fetchAccountDrill: api.fetchAccountDrill,
  fetchCategoryDrill: api.fetchCategoryDrill,
  fetchPayeeDrill: api.fetchPayeeDrill,
  fetchBookingDrill: api.fetchBookingDrill,
  writeSplits: api.writeSplits,
  writePayeeRule: api.writePayeeRule,
}));

const BOOKING = {
  id: 9,
  account_id: 1,
  booking_date: "2026-10-05",
  value_date: null,
  amount: "-100.00",
  currency: "EUR",
  purpose: "REWE SAGT DANKE",
  posting_text: "Kartenzahlung",
  counterparty_name: "REWE",
  counterparty_iban: null,
  bank_ref: null,
  raw: { amount: "-100,00" },
  source_key: "k9",
  imported_at: "2026-10-05T10:00:00Z",
  transfer_group: null,
  payee_id: 5,
  category_id: 4,
  category_set_by: "rule",
  splits: [],
};

const month = (at: string, figures: Record<string, string> = {}) => ({
  month: at,
  income: "0.00",
  other_scope: "0.00",
  fixed: "0.00",
  flexible: "0.00",
  non_monthly: "0.00",
  reserved: "0.00",
  saved: "0.00",
  unsorted: "0.00",
  left: "0.00",
  ...figures,
});

const SCOPE = {
  scope: "mine",
  month: "2026-10",
  months: [
    month("2026-09"),
    month("2026-10", {
      income: "3000.00",
      other_scope: "900.00",
      flexible: "100.00",
      saved: "300.00",
      left: "1700.00",
    }),
  ],
  accounts: [
    {
      id: 1,
      name: "Giro",
      kind: "giro",
      balance: "1680.00",
      balance_on: "2026-10-02",
      moved: "-1320.00",
    },
  ],
  bookings: [BOOKING],
};

const CATEGORY = {
  category: { id: 4, name: "Groceries", kind: "flexible" },
  month: "2026-10",
  months: [
    {
      month: "2026-10",
      mine: "100.00",
      household: "0.00",
      total: "100.00",
      from_reserve: "0.00",
      limit: "400.00",
      available: "400.00",
      average: "380.00",
    },
  ],
  payees: [{ id: 5, name: "REWE", amount: "100.00" }],
  plans: [],
  rules: [{ id: 3, kind: "payee", pattern: "rewe", category_id: 4 }],
  bookings: [BOOKING],
};

const PAYEE = {
  payee: { id: 5, key: "rewe markt", name: "REWE", category_id: null },
  month: "2026-10",
  months: [{ month: "2026-10", spent: "100.00", received: "0.00", saved: "0.00", bookings: 2 }],
  average: "90.00",
  average_received: "0.00",
  categories: [{ id: 4, name: "Groceries", kind: "flexible", amount: "100.00" }],
  rules: [],
  bookings: [BOOKING],
};

const DRILLED = {
  transaction: BOOKING,
  account: { id: 1, name: "Giro", bank: "DKB", iban: null, kind: "giro", shared: false },
  payee: PAYEE.payee,
  twin: null,
  plans: [],
  counts: [{ month: "2026-10", scope: "mine", part: "flexible", category_id: 4, amount: "100.00" }],
};

beforeEach(() => {
  api.fetchCategories.mockResolvedValue([
    { id: 4, name: "Groceries", kind: "flexible" },
    { id: 6, name: "Dining", kind: "flexible" },
  ]);
  api.fetchTransactions.mockResolvedValue([BOOKING]);
  api.fetchScope.mockResolvedValue(SCOPE);
  api.fetchAccountDrill.mockReturnValue(never());
  api.fetchCategoryDrill.mockResolvedValue(CATEGORY);
  api.fetchPayeeDrill.mockResolvedValue(PAYEE);
  api.fetchBookingDrill.mockResolvedValue(DRILLED);
  for (const write of [api.sortByHand, api.sortPayee, api.writeSplits, api.writePayeeRule])
    write.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const notice = vi.fn();

function renderPane() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <FinancePane commands={stubCommands()} focusSignal={0} onNotice={notice} today="2026-10-25" />
    </QueryClientProvider>,
  );
}

function press(key: string) {
  fireEvent.keyDown(screen.getByRole("region", { name: "Finance" }), { key });
}

function crumbs(): string {
  const nav = screen.getByRole("navigation", { name: "Breadcrumbs" });
  return within(nav)
    .getAllByRole("listitem")
    .map((item) => item.textContent)
    .join(" › ");
}

describe("the finance pane's drilldowns", () => {
  it("#1083 a scope opens from its card, shows its month and accounts, and Escape steps back", async () => {
    renderPane();
    fireEvent.click(await screen.findByRole("button", { name: "Mine ›" }));

    expect(await screen.findByRole("heading", { name: "Mine in October 2026" })).toBeTruthy();
    expect(api.fetchScope).toHaveBeenCalledWith("mine", "2026-10");
    const card = screen.getByRole("heading", { name: "Mine in October 2026" }).closest("article");
    const rows = within(card as HTMLElement).getAllByRole("row");
    expect(rows.map((row) => row.textContent?.replaceAll(" ", " "))).toEqual([
      "Income3.000 €",
      "Into household−900 €",
      "Flexible−100 €",
      "Saved−300 €",
    ]);
    expect(crumbs()).toBe("October 2026 › Mine");

    fireEvent.click(screen.getByRole("button", { name: /^Giro, 2026-10-02 ›/ }));
    await waitFor(() => expect(api.fetchAccountDrill).toHaveBeenCalledWith(1, "2026-10"));
    expect(crumbs()).toBe("October 2026 › Mine › Giro");

    press("Escape");
    expect(crumbs()).toBe("October 2026 › Mine");
    press("Escape");
    expect(screen.queryByRole("navigation", { name: "Breadcrumbs" })).toBeNull();
    expect(screen.getByRole("button", { name: "Mine ›" })).toBeTruthy();
  });

  it("#1083 a category leads to its payee, which takes a default category or a rule", async () => {
    renderPane();
    press("T");
    await screen.findByText("REWE SAGT DANKE");
    press("Enter");
    fireEvent.click(await screen.findByRole("button", { name: "Groceries ›" }));
    expect(await screen.findByText(/average 380\s€/)).toBeTruthy();
    expect(screen.getByText("rule: payee starts with “rewe”")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^REWE ›/ }));
    expect(
      await screen.findByText(/average 90\s€ a month; 50\s€ a booking this month/),
    ).toBeTruthy();
    expect(crumbs()).toBe("October 2026 › REWE › Groceries › REWE");

    fireEvent.change(screen.getByRole("combobox", { name: "Category for REWE" }), {
      target: { value: "6" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Make it the default" }));
    await waitFor(() => expect(api.sortPayee).toHaveBeenCalledWith(5, 6));
    fireEvent.click(screen.getByRole("button", { name: "Add a rule" }));
    await waitFor(() => expect(api.writePayeeRule).toHaveBeenCalledWith("rewe markt", 6));
  });

  it("#1083 a booking shows where it counts, re-sorts by key and splits into parts that add up", async () => {
    renderPane();
    press("T");
    await screen.findByText("REWE SAGT DANKE");
    press("Enter");

    expect(await screen.findByText(/^October 2026, mine, flexible, Groceries/)).toBeTruthy();
    expect(screen.getByText("Kartenzahlung")).toBeTruthy();
    expect(api.fetchBookingDrill).toHaveBeenCalledWith(9);

    // The second category's key, as on the to-sort list.
    press("2");
    await waitFor(() =>
      expect(api.sortByHand).toHaveBeenCalledWith({ transaction: 9, payee: 5 }, 6),
    );

    fireEvent.click(screen.getByRole("button", { name: "Split into parts" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Part 1 amount" }), {
      target: { value: "-70,00" },
    });
    expect(screen.getByText(/30,00\s€ still to share out/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save the splits" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Add a part" }));
    fireEvent.click(screen.getByRole("button", { name: "Save the splits" }));
    await waitFor(() =>
      expect(api.writeSplits).toHaveBeenCalledWith(9, [
        { amount: "-70.00", text: null },
        { amount: "-30.00", text: null },
      ]),
    );
  });

  it("#1083 a category lists a split booking by its part in that category, so the net is its own", async () => {
    const split = {
      ...BOOKING,
      category_id: null,
      splits: [
        { id: 1, amount: "-70.00", text: "food", category_id: 4, category_set_by: "hand" },
        { id: 2, amount: "-30.00", text: "wine", category_id: 6, category_set_by: "hand" },
      ],
    };
    api.fetchCategoryDrill.mockResolvedValue({ ...CATEGORY, bookings: [split] });
    renderPane();
    press("T");
    await screen.findByText("REWE SAGT DANKE");
    press("Enter");
    fireEvent.click(await screen.findByRole("button", { name: "Groceries ›" }));

    const bookings = await screen.findByRole("region", { name: "Bookings" });
    expect(within(bookings).getByRole("heading").textContent?.replaceAll("\u00a0", " ")).toBe(
      "1 booking, −70,00 € net",
    );
    expect(within(bookings).getByText(/^part of −100,00\s€, REWE SAGT DANKE$/)).toBeTruthy();
  });

  it("#1083 stepping back finds the tab's filter and the list's cursor as they were", async () => {
    const second = { ...BOOKING, id: 10, counterparty_name: "EDEKA", purpose: "EDEKA SAGT DANKE" };
    api.fetchCategoryDrill.mockResolvedValue({ ...CATEGORY, bookings: [BOOKING, second] });
    renderPane();
    press("T");
    await screen.findByText("REWE SAGT DANKE");
    fireEvent.change(screen.getByRole("searchbox", { name: "Text" }), {
      target: { value: "rewe" },
    });
    press("Enter");
    fireEvent.click(await screen.findByRole("button", { name: "Groceries ›" }));
    await screen.findByText("EDEKA SAGT DANKE");
    press("j");
    press("Enter");
    await waitFor(() => expect(api.fetchBookingDrill).toHaveBeenLastCalledWith(10));

    press("Escape");
    const rows = within(screen.getByRole("list", { name: "Bookings" })).getAllByRole("listitem");
    expect(rows[1]).toHaveAttribute("aria-selected", "true");
    press("Escape");
    press("Escape");
    expect(screen.getByRole("searchbox", { name: "Text" })).toHaveValue("rewe");
  });

  it("#1083 a month's bar keeps the keys in the pane, so Escape still steps back", async () => {
    const [october] = CATEGORY.months;
    const september = { ...october, month: "2026-09", total: "80.00" };
    api.fetchCategoryDrill.mockResolvedValue({ ...CATEGORY, months: [september, october] });
    renderPane();
    press("T");
    await screen.findByText("REWE SAGT DANKE");
    press("Enter");
    fireEvent.click(await screen.findByRole("button", { name: "Groceries ›" }));
    const bar = await screen.findByRole("button", { name: /^September 2026, 80\s€$/ });
    bar.focus();
    fireEvent.click(bar);
    await waitFor(() => expect(api.fetchCategoryDrill).toHaveBeenCalledTimes(2));
    expect(document.activeElement).toBe(screen.getByRole("region", { name: "Finance" }));
    press("Escape");
    expect(crumbs()).toBe("September 2026 › REWE");
  });

  it("#1083 a category key on a split booking says to sort its parts", async () => {
    const split = {
      ...BOOKING,
      category_id: null,
      splits: [
        { id: 1, amount: "-70.00", text: "food", category_id: 4, category_set_by: "hand" },
        { id: 2, amount: "-30.00", text: "wine", category_id: null, category_set_by: null },
      ],
    };
    api.fetchBookingDrill.mockResolvedValue({ ...DRILLED, transaction: split });
    renderPane();
    press("T");
    await screen.findByText("REWE SAGT DANKE");
    press("Enter");
    await screen.findByText("Part 1, −70,00 €, food");
    press("2");
    expect(notice).toHaveBeenCalledWith("This booking is split: sort each part below");
    expect(api.sortByHand).not.toHaveBeenCalled();
  });

  it("#1083 a payee that only pays in averages its money in", async () => {
    api.fetchPayeeDrill.mockResolvedValue({
      ...PAYEE,
      months: [
        { month: "2026-10", spent: "0.00", received: "3000.00", saved: "0.00", bookings: 1 },
      ],
      average: "0.00",
      average_received: "3000.00",
    });
    renderPane();
    press("T");
    await screen.findByText("REWE SAGT DANKE");
    press("Enter");
    fireEvent.click(await screen.findByRole("button", { name: "REWE ›" }));
    expect(await screen.findByText(/^average 3.000\s€ a month$/)).toBeTruthy();
  });
});
