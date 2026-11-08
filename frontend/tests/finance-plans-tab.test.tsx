import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { amountOf, positive } from "@/components/finance-budget-tab";
import { madeOf } from "@/components/finance-overview";
import { FinancePane } from "@/components/finance-pane";
import { euros, money } from "@/lib/panes/finance/finance-words";
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
  fetchContracts: vi.fn(),
  makeContract: vi.fn(),
}));
const http = vi.hoisted(() => ({ POST: vi.fn(), GET: vi.fn() }));

vi.mock("@/lib/core/api-client", async (actual) => ({
  ...(await actual<typeof import("@/lib/core/api-client")>()),
  client: http,
}));

vi.mock("@/lib/panes/finance/finance-plans-api", async (actual) => ({
  ...(await actual<typeof import("@/lib/panes/finance/finance-plans-api")>()),
  ...api,
}));
vi.mock("@/lib/panes/finance/finance-api", () => ({
  fetchCategories: () => Promise.resolve([]),
  fetchToSort: () => Promise.resolve({ total: 0, bookings: [] }),
}));
vi.mock("@/lib/panes/finance/finance-budget-api", () => ({
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
  api.fetchContracts.mockResolvedValue({ contracts: [], yearly: "0.00" });
  api.makeContract.mockResolvedValue({ path: "03 Areas/03 Money/Contracts/Haftpflicht.md" });
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

function renderPane(onNotice: (text: string | undefined) => void = () => undefined) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <FinancePane
        commands={stubCommands()}
        focusSignal={1}
        onNotice={onNotice}
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
    // A split part or a refund is typed with its sign, the German way too.
    expect(amountOf("-1.200")).toBe("-1200");
    expect(amountOf("\u22121.200,50")).toBe("-1200.50");
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

  it("#1675 the contracts list by cancel-by date, with its plan, cost a year and the total", async () => {
    const row = {
      plan_id: null,
      plan_name: null,
      amount: null,
      every_months: null,
      yearly: null,
      cancel_by: null,
      renews: null,
      ends: null,
      problem: null,
    };
    api.fetchContracts.mockResolvedValue({
      contracts: [
        { ...row, path: "c/Gym.md", name: "Gym", cancel_by: "2026-11-14", renews: "2027-01-15" },
        {
          ...row,
          path: "c/Haftpflicht.md",
          name: "Haftpflicht",
          plan_id: 3,
          plan_name: "HUK",
          amount: "-600.00",
          every_months: 12,
          yearly: "600.00",
          cancel_by: "2026-11-28",
          renews: "2027-03-01",
        },
        {
          ...row,
          path: "c/Phone.md",
          name: "Phone",
          plan_id: 9,
          cancel_by: "2026-11-28",
          renews: "2027-03-01",
          problem: "plan 9 is gone",
        },
        { ...row, path: "c/Paper.md", name: "Paper", problem: "term missing or unreadable" },
      ],
      yearly: "600.00",
    });
    renderPane();
    const list = await screen.findByRole("region", { name: "Contracts" });
    await waitFor(() => expect(list.querySelectorAll("li")).toHaveLength(4));
    const rows = [...list.querySelectorAll("li")].map((li) => li.textContent);
    expect(rows).toEqual([
      "Gymcancel by 14 Nov 2026, else renews 15 Jan 2027; no plan",
      `Haftpflicht${euros(600)} a yearcancel by 28 Nov 2026, else renews 1 Mar 2027; HUK, ${money("-600.00")} yearly`,
      "Phonecancel by 28 Nov 2026, else renews 1 Mar 2027; plan 9 is gone",
      "Paperterm missing or unreadable; no plan",
    ]);
    expect(list.querySelector("ul + p")?.textContent).toBe(`${euros(600)} a year in all`);
    expect(api.fetchContracts).toHaveBeenCalledWith("2026-10-25");
  });

  const contractButtons = () =>
    screen.getAllByRole("button", { name: "Make a contract note for Haftpflicht" });

  it("#1675 a plan's and a proposal's Contract button start the note and say where", async () => {
    api.fetchPlans.mockResolvedValue([{ ...PROPOSAL, id: 3, reserves: true, share: "41.50" }]);
    const notices: (string | undefined)[] = [];
    renderPane((text) => notices.push(text));
    const plans = await screen.findByRole("region", { name: "Plans" });
    await waitFor(() => expect(plans.querySelector("li")).toBeTruthy());
    fireEvent.click(contractButtons()[1] as HTMLElement);
    await waitFor(() => expect(api.makeContract).toHaveBeenCalledTimes(1));
    expect(api.makeContract.mock.calls[0]?.[0]).toMatchObject({ id: 3 });
    expect((await screen.findByRole("status")).textContent).toBe(
      "Wrote 03 Areas/03 Money/Contracts/Haftpflicht.md: fill in its terms there.",
    );
    fireEvent.click(contractButtons()[0] as HTMLElement);
    await waitFor(() => expect(api.makeContract).toHaveBeenCalledTimes(2));
    expect(api.makeContract.mock.calls[1]).toEqual([PROPOSAL, "2026-10-25"]);
    api.makeContract.mockRejectedValue(new Error("A note is already there"));
    fireEvent.click(contractButtons()[1] as HTMLElement);
    await waitFor(() => expect(notices.at(-1)).toBe("A note is already there"));
  });

  it("#1675 a proposal is confirmed as a plan before its contract note, by its new id", async () => {
    const real = await vi.importActual<typeof import("@/lib/panes/finance/finance-plans-api")>(
      "@/lib/panes/finance/finance-plans-api",
    );
    const ok = { ok: true, status: 200 };
    http.POST.mockResolvedValueOnce({ data: { id: 41 }, response: ok }).mockResolvedValueOnce({
      data: { path: "c/Haftpflicht.md" },
      response: { ok: true, status: 201 },
    });
    expect(await real.makeContract(PROPOSAL as never, "2026-10-25")).toEqual({
      path: "c/Haftpflicht.md",
    });
    const { key: _k, source: _s, seen: _n, last: _l, ...plan } = PROPOSAL;
    expect(http.POST.mock.calls).toEqual([
      ["/api/finance/plans", { body: plan, params: { query: { today: "2026-10-25" } } }],
      ["/api/finance/contracts", { body: { plan_id: 41 } }],
    ]);
    http.POST.mockResolvedValueOnce({ data: { path: "c/Miete.md" }, response: ok });
    await real.makeContract({ id: 5 } as never, "2026-10-25");
    expect(http.POST.mock.calls[2]).toEqual(["/api/finance/contracts", { body: { plan_id: 5 } }]);
  });

  it("#1675 opening the list writes the cancel-by todos first, then reads the contracts", async () => {
    const real = await vi.importActual<typeof import("@/lib/panes/finance/finance-plans-api")>(
      "@/lib/panes/finance/finance-plans-api",
    );
    const order: string[] = [];
    http.POST.mockImplementation((url: string) => {
      order.push(url);
      return Promise.resolve({ data: [], response: { ok: true, status: 200 } });
    });
    http.GET.mockImplementation((url: string) => {
      order.push(url);
      return Promise.resolve({ data: { contracts: [], yearly: "0.00" }, response: { ok: true } });
    });
    expect(await real.fetchContracts("2026-10-25")).toEqual({ contracts: [], yearly: "0.00" });
    expect(order).toEqual(["/api/finance/contracts/reminders", "/api/finance/contracts"]);
    http.POST.mockReset();
  });

  it("#1675 a proposal with nothing to match by offers no Contract until it is a plan", async () => {
    api.fetchProposals.mockResolvedValue([{ ...PROPOSAL, payee_id: null, text: null }]);
    renderPane();
    const button = await screen.findByRole("button", {
      name: "Make a contract note for Haftpflicht",
    });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.title).toBe("Confirm it as a plan first: it has nothing to match by");
    fireEvent.click(button);
    expect(api.makeContract).not.toHaveBeenCalled();
  });
});
