import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { FinancePane } from "@/components/finance-pane";
import { ReceiptsToSort } from "@/components/finance-receipts";
import { BookingTaxCard } from "@/components/finance-tax-mark";
import { stubCommands } from "./stub-commands";

const tax = vi.hoisted(() => ({
  fetchTaxYear: vi.fn(),
  fetchBookingTax: vi.fn(),
  writeMark: vi.fn(),
  deleteMark: vi.fn(),
  uploadReceipt: vi.fn(),
  fetchReceiptsToSort: vi.fn(),
  confirmReceipt: vi.fn(),
  patchReceipt: vi.fn(),
}));

vi.mock("@/lib/finance/finance-tax-api", async (original) => ({
  ...(await original<typeof import("@/lib/finance/finance-tax-api")>()),
  ...tax,
}));
vi.mock("@/lib/finance/finance-api", () => ({
  fetchCategories: async () => [],
  fetchToSort: async () => ({ total: 0, bookings: [] }),
}));
vi.mock("@/lib/finance/finance-budget-api", () => ({
  fetchBudget: () => new Promise(() => {}),
  fetchFree: () => new Promise(() => {}),
  fetchTrend: () => new Promise(() => {}),
  fetchSync: () => new Promise(() => {}),
}));

const LINES = [
  ["werbungskosten", "Werbungskosten (Anlage N)", "1400.00", 2, 1],
  ["sonderausgaben", "Sonderausgaben", "50.00", 1, 0],
  ["haushaltsnahe_dienste", "§35a haushaltsnahe Dienstleistungen", "0.00", 0, 0],
  ["handwerker", "§35a Handwerkerleistungen", "0.00", 0, 0],
  ["aussergewoehnliche_belastungen", "Außergewöhnliche Belastungen", "0.00", 0, 0],
].map(([form_line, label, total, bookings, missing]) => ({
  form_line,
  label,
  total,
  bookings,
  missing,
}));

const ENTRY = {
  transaction_id: 5,
  booking_date: "2026-03-04",
  payee: "Thalia",
  purpose: "Fachbuch",
  amount: "-400.00",
  tax_amount: "400.00",
  counted: "400.00",
  form_line: "werbungskosten",
  receipt_status: "missing",
  receipt_ids: [],
  shared: false,
  note: null,
};

const YEAR = {
  year: 2026,
  lines: LINES,
  allowance: "1230.00",
  werbungskosten_over: "170.00",
  missing: [ENTRY],
  money_back: [],
  entries: [ENTRY],
};

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

beforeEach(() => {
  tax.fetchTaxYear.mockImplementation(async (year: number) => ({ ...YEAR, year }));
  tax.fetchReceiptsToSort.mockResolvedValue([]);
  for (const write of [tax.writeMark, tax.deleteMark, tax.uploadReceipt]) {
    write.mockResolvedValue(undefined);
  }
  tax.confirmReceipt.mockResolvedValue(undefined);
  tax.patchReceipt.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("the finance pane's Tax tab", () => {
  it("#1040 shows each line's year, the Werbungskosten over the allowance and what is missing", async () => {
    wrap(
      <FinancePane
        commands={stubCommands()}
        focusSignal={0}
        onNotice={vi.fn()}
        today="2026-10-25"
      />,
    );
    const pane = screen.getByRole("region", { name: "Finance" });

    fireEvent.keyDown(pane, { key: "X" });

    expect(await screen.findByText("Tax year 2026")).toBeInTheDocument();
    expect(
      await screen.findByRole("row", { name: /Werbungskosten \(Anlage N\) \(2\)/ }),
    ).toHaveTextContent("1.400,00 €");
    expect(screen.getByText(/170,00 € over the allowance of 1.230,00 €/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /2026-03-04, Thalia/ })).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: "CSV" })[0]).toHaveAttribute(
      "href",
      "/api/finance/tax/2026/lines/werbungskosten.csv",
    );

    fireEvent.keyDown(pane, { key: "]" });

    expect(await screen.findByText("Tax year 2027")).toBeInTheDocument();
    expect(tax.fetchTaxYear).toHaveBeenLastCalledWith(2027);
    expect(await screen.findByRole("link", { name: /ZIP/ })).toHaveAttribute(
      "href",
      "/api/finance/tax/2027/receipts.zip",
    );
  });
});

describe("the receipts to sort", () => {
  it("#1040 confirms a proposal only when pressed, with its line and labour share", async () => {
    tax.fetchReceiptsToSort.mockResolvedValue([
      {
        receipt: {
          id: 3,
          name: "Rechnung.pdf",
          read_at: "2026-10-26T10:00:00Z",
          read_error: null,
          read_date: "2026-10-01",
          read_payee: "Malerbetrieb Huber",
          read_amount: "476.00",
          read_labour: "300.00",
          read_line: "handwerker",
        },
        form_line: "handwerker",
        candidates: [
          {
            transaction_id: 9,
            booking_date: "2026-10-28",
            amount: "-476.00",
            payee: "Malerbetrieb Huber GmbH",
            purpose: null,
            tax_amount: "300.00",
          },
        ],
      },
    ]);
    wrap(<ReceiptsToSort onNotice={vi.fn()} />);

    const proposal = await screen.findByRole("button", {
      name: /2026-10-28, Malerbetrieb Huber GmbH/,
    });
    expect(proposal).toHaveTextContent("§35a Handwerker (Arbeitskosten) 300,00 €");
    expect(tax.confirmReceipt).not.toHaveBeenCalled();

    fireEvent.click(proposal);
    await waitFor(() =>
      expect(tax.confirmReceipt).toHaveBeenCalledWith(3, {
        transaction_id: 9,
        form_line: "handwerker",
        tax_amount: "300.00",
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Put aside" }));
    await waitFor(() => expect(tax.patchReceipt).toHaveBeenCalledWith(3, { dismissed: true }));
  });
});

describe("a proposal on a booking already marked or on the shared account", () => {
  const queued = (shared: boolean) => [
    {
      receipt: { id: 3, name: "R.pdf", read_at: "2026-10-26T10:00:00Z", read_error: null },
      form_line: "haushaltsnahe_dienste",
      candidates: [
        {
          transaction_id: 9,
          booking_date: "2026-10-28",
          amount: "-800.00",
          payee: "Garten GmbH",
          purpose: null,
          tax_amount: shared ? null : "800.00",
          shared,
        },
      ],
    },
  ];

  it("#1040 asks for your share on the shared account and sends what you typed", async () => {
    tax.fetchReceiptsToSort.mockResolvedValue(queued(true));
    const ask = vi.spyOn(window, "prompt").mockReturnValue("400,00");
    wrap(<ReceiptsToSort onNotice={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: /your share/ }));

    expect(ask).toHaveBeenCalled();
    await waitFor(() =>
      expect(tax.confirmReceipt).toHaveBeenCalledWith(3, {
        transaction_id: 9,
        form_line: "haushaltsnahe_dienste",
        tax_amount: "400.00",
      }),
    );
    ask.mockRestore();
  });

  it("#1040 replaces a mark the booking holds only when you say so", async () => {
    const { MarkHeldError } = await vi.importActual<typeof import("@/lib/finance/finance-tax-api")>(
      "@/lib/finance/finance-tax-api",
    );
    tax.fetchReceiptsToSort.mockResolvedValue(queued(false));
    tax.confirmReceipt.mockRejectedValueOnce(new MarkHeldError("Already marked 400.00"));
    const ask = vi.spyOn(window, "confirm").mockReturnValue(false);
    wrap(<ReceiptsToSort onNotice={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: /Garten GmbH/ }));

    await waitFor(() => expect(ask).toHaveBeenCalledWith("Already marked 400.00?"));
    expect(tax.confirmReceipt).toHaveBeenCalledTimes(1);
    ask.mockRestore();
  });
});

describe("a booking's tax card", () => {
  it("#1040 saves a mark with the amount typed the German way, and keeps a dropped file", async () => {
    tax.fetchBookingTax.mockResolvedValue({ mark: null, receipts: [] });
    wrap(<BookingTaxCard id={5} onNotice={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText("Line"), { target: { value: "werbungskosten" } });
    fireEvent.change(screen.getByLabelText("Tax amount"), { target: { value: "1.200,50" } });
    fireEvent.click(screen.getByRole("button", { name: "Save the mark" }));

    await waitFor(() =>
      expect(tax.writeMark).toHaveBeenCalledWith(5, {
        form_line: "werbungskosten",
        tax_amount: "1200.50",
        receipt_needed: true,
        note: null,
      }),
    );

    const file = new File(["%PDF-1"], "Rechnung.pdf", { type: "application/pdf" });
    fireEvent.drop(screen.getByRole("article", { name: "Tax and receipts" }), {
      dataTransfer: { files: [file] },
    });
    await waitFor(() => expect(tax.uploadReceipt).toHaveBeenCalledWith(file, 5));
  });

  it("#1040 shows the receipt's status and takes a receipt off the booking", async () => {
    tax.fetchBookingTax.mockResolvedValue({
      mark: {
        transaction_id: 5,
        form_line: "sonderausgaben",
        tax_amount: "50.00",
        receipt_needed: true,
        note: null,
        receipt_status: "attached",
      },
      receipts: [{ id: 8, name: "Spende.pdf" }],
    });
    wrap(<BookingTaxCard id={5} onNotice={vi.fn()} />);

    expect(await screen.findByText("50,00 € counts, receipt attached")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Spende.pdf" })).toHaveAttribute(
      "href",
      "/api/finance/receipts/8/file",
    );
    fireEvent.click(screen.getByRole("button", { name: "Take off" }));
    await waitFor(() => expect(tax.patchReceipt).toHaveBeenCalledWith(8, { transaction_id: null }));
  });
});
