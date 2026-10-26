import { useQuery } from "@tanstack/react-query";
import { amountOf } from "@/components/finance-budget-tab";
import { useWrite } from "@/components/finance-drill-parts";
import {
  type ConfirmBody,
  confirmReceipt,
  type FormLine,
  fetchReceiptsToSort,
  lineLabel,
  MarkHeldError,
  patchReceipt,
  type ReceiptToSort,
  receiptUrl,
} from "@/lib/finance-tax-api";
import { money } from "@/lib/finance-words";

type Candidate = ReceiptToSort["candidates"][number];

/**
 * What pressing a proposal sends. On the shared account kasten proposes no amount, since only
 * the owner knows their share, so it asks for one; cancelled, nothing is sent.
 */
function proposal(candidate: Candidate, line: FormLine | null): ConfirmBody | null {
  const base = { transaction_id: candidate.transaction_id };
  if (line != null && candidate.shared) {
    const typed = window.prompt(
      `Your share of ${money(candidate.amount)} for ${lineLabel(line)}, in euros`,
    );
    if (typed == null) return null;
    const amount = amountOf(typed);
    return amount == null ? null : { ...base, form_line: line, tax_amount: amount };
  }
  const amount = candidate.tax_amount ?? null;
  return { ...base, form_line: amount == null ? null : line, tax_amount: amount };
}

/** Confirm, and when the booking holds a mark already, ask before replacing it. */
async function confirmAsking(id: number, body: ConfirmBody): Promise<void> {
  try {
    await confirmReceipt(id, body);
  } catch (error) {
    if (!(error instanceof MarkHeldError)) throw error;
    if (!window.confirm(`${error.message}?`)) return;
    await confirmReceipt(id, { ...body, replace: true });
  }
}

/** The words on a proposal's button: the booking, and the mark it would set. */
function proposalWords(candidate: Candidate, line: FormLine | null): string {
  const head = `${candidate.booking_date}, ${candidate.payee}, ${money(candidate.amount)}`;
  if (line == null) return head;
  if (candidate.shared) return `${head}: ${lineLabel(line)}, your share`;
  return candidate.tax_amount == null
    ? head
    : `${head}: ${lineLabel(line)} ${money(candidate.tax_amount)}`;
}

/** What the reader found on a receipt, in one line, or why it found nothing. */
function readWords({ receipt }: ReceiptToSort): string {
  if (receipt.read_at == null) return "not read yet";
  if (receipt.read_error != null) return receipt.read_error;
  return [
    receipt.read_date,
    receipt.read_payee,
    receipt.read_amount == null ? null : money(receipt.read_amount),
    receipt.read_labour == null ? null : `labour ${money(receipt.read_labour)}`,
    receipt.read_line == null ? null : lineLabel(receipt.read_line),
  ]
    .filter(Boolean)
    .join(", ");
}

/**
 * The receipts on no booking, under the to-sort list: what the reader found, the bookings each
 * may have paid with the mark kasten proposes, and a button per proposal. Nothing is linked
 * or marked until one is pressed; a receipt that is no tax receipt is put aside.
 */
export function ReceiptsToSort({ onNotice }: { onNotice: (text: string | undefined) => void }) {
  const write = useWrite(onNotice);
  const queue = useQuery({
    queryKey: ["finance", "receipts", "to-sort"],
    queryFn: fetchReceiptsToSort,
  });
  if (queue.error) return <p role="alert">{queue.error.message}</p>;
  const found = queue.data ?? [];
  if (found.length === 0) return null;
  return (
    <section aria-label="Receipts to sort">
      <h3 className="overview-name">{`Receipts to sort (${found.length})`}</h3>
      <ul className="finance-tax-queue">
        {found.map((item) => {
          const { receipt } = item;
          const line = item.form_line as FormLine | null;
          return (
            <li key={receipt.id} className="overview-card">
              <a href={receiptUrl(receipt.id)} target="_blank" rel="noreferrer">
                {receipt.name ?? `Receipt ${receipt.id}`}
              </a>
              <p className="overview-caption">{readWords(item)}</p>
              {item.candidates.length === 0 && receipt.read_at != null ? (
                <p className="overview-caption">
                  no booking of that amount near that date; drop the file on its booking instead
                </p>
              ) : null}
              <div className="finance-pane-categories">
                {item.candidates.map((candidate) => (
                  <button
                    key={candidate.transaction_id}
                    type="button"
                    className="finance-pane-button"
                    onClick={() => {
                      const body = proposal(candidate, line);
                      if (body != null) void write(() => confirmAsking(receipt.id, body));
                    }}
                  >
                    {proposalWords(candidate, line)}
                  </button>
                ))}
                <button
                  type="button"
                  className="finance-pane-button"
                  onClick={() => void write(() => patchReceipt(receipt.id, { dismissed: true }))}
                >
                  Put aside
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
