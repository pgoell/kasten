import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FinancePane } from "@/components/finance-pane";
import { stubCommands } from "./stub-commands";

const { fetchCategories, fetchToSort, sortByHand, sortPayee, fetchUnmatchedOrders } = vi.hoisted(
  () => ({
    fetchCategories: vi.fn(),
    fetchToSort: vi.fn(),
    sortByHand: vi.fn(),
    sortPayee: vi.fn(),
    fetchUnmatchedOrders: vi.fn(),
  }),
);

vi.mock("@/lib/finance-api", () => ({ fetchCategories, fetchToSort, sortByHand, sortPayee }));
vi.mock("@/lib/finance-orders-api", async (original) => ({
  ...(await original<typeof import("@/lib/finance-orders-api")>()),
  fetchUnmatchedOrders,
}));
// The overview and the bank card read these as the pane opens; the to-sort list needs none.
vi.mock("@/lib/finance-budget-api", () => ({
  fetchBudget: () => new Promise(() => {}),
  fetchFree: () => new Promise(() => {}),
  fetchTrend: () => new Promise(() => {}),
  fetchSync: () => new Promise(() => {}),
}));

const CATEGORIES = [
  { id: 7, name: "Food", kind: "flexible" },
  { id: 9, name: "Shopping", kind: "flexible" },
];

const BAKERY = {
  id: 1,
  account_id: 1,
  booking_date: "2026-10-01",
  amount: "-4.20",
  currency: "EUR",
  purpose: "Brot",
  counterparty_name: "Bäckerei Müller",
  payee_id: 3,
  payee_name: "Bäckerei Müller",
  splits: [],
};

const ORDER = {
  ...BAKERY,
  id: 2,
  booking_date: "2026-10-02",
  amount: "-30.00",
  purpose: "AMAZON",
  payee_id: null,
  payee_name: null,
  counterparty_name: "Amazon",
  splits: [{ id: 11, amount: "-10.00", text: "Cable" }],
};

beforeEach(() => {
  fetchCategories.mockResolvedValue(CATEGORIES);
  fetchToSort.mockResolvedValue({ total: 2, bookings: [BAKERY, ORDER] });
  sortByHand.mockResolvedValue(undefined);
  sortPayee.mockResolvedValue(undefined);
  fetchUnmatchedOrders.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderPane() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onNotice = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <FinancePane
        commands={stubCommands()}
        focusSignal={0}
        onNotice={onNotice}
        today="2026-10-25"
      />
    </QueryClientProvider>,
  );
  // The pane opens on its overview; these are the to-sort list's tests.
  fireEvent.click(screen.getByRole("tab", { name: /^To sort/ }));
  return { onNotice };
}

function press(key: string) {
  fireEvent.keyDown(screen.getByRole("region", { name: "Finance" }), { key });
}

const charge = (
  id: number,
  amount: string,
  status: string,
  transaction_id: number | null = null,
) => ({
  id,
  kind: "charge",
  key: `k${id}`,
  charged_on: "2026-10-17",
  amount,
  transaction_id,
  status,
  items: [],
});

describe("the finance pane's to-sort view", () => {
  it("#1039 lists each order charge no booking holds, and why, under the bookings", async () => {
    fetchUnmatchedOrders.mockResolvedValue([
      {
        id: 1,
        source: "paypal",
        order_key: "1AB23456CD789012E",
        ordered_on: "2026-10-17",
        merchant: "Example Shop GmbH",
        total: "30.00",
        currency: "EUR",
        charges: [charge(1, "30.00", "ambiguous")],
      },
      {
        id: 2,
        source: "amazon",
        order_key: "123-4567890-1234567",
        ordered_on: "2026-10-15",
        merchant: "Amazon",
        total: "40.00",
        currency: "EUR",
        charges: [charge(2, "25.00", "split", 9), charge(3, "15.00", "items_off")],
      },
      {
        id: 3,
        source: "amazon",
        order_key: "123-0000000-0000001",
        ordered_on: "2026-10-14",
        merchant: "Amazon",
        total: "12.00",
        currency: "EUR",
        charges: [],
      },
    ]);
    renderPane();

    const orders = await screen.findByRole("region", { name: "Orders without a booking" });
    const lines = orders.querySelectorAll("li");
    expect([...lines].map((line) => line.textContent?.replaceAll("\u00a0", " "))).toEqual([
      "2026-10-17, Example Shop GmbH, 30,00 €: two bookings fit alike",
      "2026-10-15, Amazon, 15,00 €: its items do not add up",
      "2026-10-14, Amazon, 12,00 €: not dispatched yet",
    ]);
  });

  it("#1035 shows a row per booking and per loose split, oldest first, with a key per category", async () => {
    renderPane();

    expect(await screen.findByText("Cable")).toBeTruthy();
    const rows = screen.getAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("Bäckerei Müller"),
      expect.stringContaining("Amazon"),
    ]);
    expect(screen.getByRole("button", { name: "1 Food" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "2 Shopping" })).toBeTruthy();
  });

  it("#1035 a category key sorts the cursor's row by hand, a split by its own id", async () => {
    renderPane();
    await screen.findByText("Cable");

    press("1");
    // The next sort waits until this one is written.
    await waitFor(() => expect(screen.getByRole("button", { name: "1 Food" })).toBeEnabled());
    press("j");
    press("2");

    await waitFor(() => expect(sortByHand).toHaveBeenCalledTimes(2));
    expect(sortByHand.mock.calls[0]).toEqual([expect.objectContaining({ transaction: 1 }), 7]);
    expect(sortByHand.mock.calls[1]).toEqual([
      expect.objectContaining({ transaction: 2, split: 11 }),
      9,
    ]);
  });

  it("#1035 always for this payee sorts the payee, by key and by tap", async () => {
    const { onNotice } = renderPane();
    await screen.findByText("Cable");

    press("a");
    press("2");
    await waitFor(() => expect(sortPayee).toHaveBeenCalledWith(3, 9));
    await waitFor(() => expect(screen.getByRole("button", { name: "1 Food" })).toBeEnabled());

    const order = screen.getAllByRole("listitem")[1]?.querySelector("button");
    fireEvent.click(order as HTMLElement);
    fireEvent.click(screen.getByRole("button", { name: "a Always for this payee" }));
    fireEvent.click(screen.getByRole("button", { name: "1 Food" }));

    await waitFor(() => expect(onNotice).toHaveBeenCalledWith("This booking has no payee to sort"));
    expect(sortPayee).toHaveBeenCalledTimes(1);
    expect(sortByHand).not.toHaveBeenCalled();
  });

  it("#1035 a key held with Ctrl, Alt or Meta sorts nothing", async () => {
    renderPane();
    await screen.findByText("Cable");

    for (const held of ["ctrlKey", "altKey", "metaKey"]) {
      fireEvent.keyDown(screen.getByRole("region", { name: "Finance" }), {
        key: "1",
        [held]: true,
      });
    }

    expect(sortByHand).not.toHaveBeenCalled();
  });

  it("#1035 a second press while a sort is in the air sorts nothing more", async () => {
    let finish: () => void = () => {};
    sortByHand.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    renderPane();
    await screen.findByText("Cable");

    press("1");
    press("2");
    expect(screen.getByRole("button", { name: "1 Food" })).toBeDisabled();
    finish();

    await waitFor(() => expect(screen.getByRole("button", { name: "1 Food" })).toBeEnabled());
    expect(sortByHand).toHaveBeenCalledTimes(1);
    expect(screen.getByText("2 to sort")).toBeTruthy();
  });
});
