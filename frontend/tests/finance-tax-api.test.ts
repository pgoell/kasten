import { confirmReceipt, MarkHeldError } from "@/lib/finance-tax-api";

const { POST } = vi.hoisted(() => ({ POST: vi.fn() }));

// The typed client keeps the `fetch` it was made with, so its answer is stubbed here instead.
vi.mock("@/lib/api-client", async (original) => ({
  ...(await original<typeof import("@/lib/api-client")>()),
  client: { POST },
}));

/** What the typed client hands back for the backend's 409 on a confirm, with its code. */
function conflict(code: string, message: string) {
  return { error: { detail: { code, message } }, response: new Response(null, { status: 409 }) };
}

const BODY = { transaction_id: 9, form_line: "werbungskosten" as const, tax_amount: null };

afterEach(() => {
  vi.clearAllMocks();
});

describe("confirming a receipt", () => {
  it("#1040 reads only mark_exists as a mark to replace", async () => {
    POST.mockResolvedValue(conflict("mark_exists", "Already marked 400.00"));
    await expect(confirmReceipt(3, BODY)).rejects.toBeInstanceOf(MarkHeldError);
  });

  it("#1040 says a receipt on another booking as it is, never as a mark to replace", async () => {
    POST.mockResolvedValue(conflict("receipt_linked", "This receipt is already on booking 4"));
    const refused = confirmReceipt(3, BODY);
    await expect(refused).rejects.toThrow("This receipt is already on booking 4");
    await expect(confirmReceipt(3, BODY)).rejects.not.toBeInstanceOf(MarkHeldError);
  });
});
