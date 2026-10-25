import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FinancePane } from "@/components/finance-pane";
import { stubCommands } from "./stub-commands";

const { fetchCategories, fetchToSort, sortByHand, sortPayee } = vi.hoisted(() => ({
  fetchCategories: vi.fn(),
  fetchToSort: vi.fn(),
  sortByHand: vi.fn(),
  sortPayee: vi.fn(),
}));

vi.mock("@/lib/finance-api", () => ({ fetchCategories, fetchToSort, sortByHand, sortPayee }));
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

describe("the finance pane's to-sort view", () => {
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
