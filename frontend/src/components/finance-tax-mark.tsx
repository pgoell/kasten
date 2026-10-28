import { useQuery } from "@tanstack/react-query";
import { type DragEvent, useRef, useState } from "react";
import { amountOf } from "@/components/finance-budget-tab";
import { useWrite } from "@/components/finance-drill-parts";
import {
  type BookingTax,
  deleteMark,
  FORM_LINES,
  type FormLine,
  fetchBookingTax,
  patchReceipt,
  RECEIPT_STATUS,
  receiptUrl,
  uploadReceipt,
  writeMark,
} from "@/lib/finance/finance-tax-api";
import { money } from "@/lib/finance/finance-words";

/** What the files a receipt may be; the backend checks the bytes again. */
const ACCEPT = "application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png";

/** The mark's fields as typed, before a save. */
interface Draft {
  line: FormLine | "";
  amount: string;
  needed: boolean;
  note: string;
}

function draftOf(tax: BookingTax): Draft {
  const mark = tax.mark;
  return {
    line: (mark?.form_line as FormLine | undefined) ?? "",
    amount: mark?.tax_amount ?? "",
    needed: mark?.receipt_needed ?? true,
    note: mark?.note ?? "",
  };
}

/** The mark's line, tax amount, whether a receipt is needed and a note, with save and remove. */
function MarkForm({
  id,
  tax,
  write,
}: {
  id: number;
  tax: BookingTax;
  write: (what: () => Promise<void>) => Promise<void>;
}) {
  const [draft, setDraft] = useState(() => draftOf(tax));
  const set = (fields: Partial<Draft>) => setDraft({ ...draft, ...fields });
  const typed = draft.amount.trim();
  const amount = typed === "" ? null : amountOf(typed);
  const line = draft.line;
  const save = () => {
    if (line === "") return;
    void write(() =>
      writeMark(id, {
        form_line: line,
        tax_amount: amount,
        receipt_needed: draft.needed,
        note: draft.note.trim() || null,
      }),
    );
  };
  return (
    <div className="finance-tax-form">
      <label>
        Line
        <select
          value={draft.line}
          onChange={(event) => set({ line: event.target.value as FormLine })}
        >
          <option value="">No tax mark</option>
          {FORM_LINES.map((entry) => (
            <option key={entry.line} value={entry.line}>
              {entry.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Tax amount
        <input
          inputMode="decimal"
          placeholder="the whole booking"
          value={draft.amount}
          onChange={(event) => set({ amount: event.target.value })}
        />
      </label>
      <label className="finance-tax-check">
        <input
          type="checkbox"
          checked={draft.needed}
          onChange={(event) => set({ needed: event.target.checked })}
        />
        Keep a receipt
      </label>
      <label>
        Note
        <input value={draft.note} onChange={(event) => set({ note: event.target.value })} />
      </label>
      <div className="finance-pane-categories">
        <button
          type="button"
          className="finance-pane-button"
          disabled={line === "" || (typed !== "" && amount === null)}
          onClick={save}
        >
          Save the mark
        </button>
        {tax.mark == null ? null : (
          <button
            type="button"
            className="finance-pane-button"
            onClick={() => void write(() => deleteMark(id))}
          >
            Remove the mark
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * A booking's tax: its mark on a line of the return, and its receipts, with a place to drop a
 * file or pick one. On the shared account the tax amount is the owner's share, which the
 * backend asks for rather than guess.
 */
export function BookingTaxCard({
  id,
  onNotice,
}: {
  id: number;
  onNotice: (text: string | undefined) => void;
}) {
  const write = useWrite(onNotice);
  const picker = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const tax = useQuery({
    queryKey: ["finance", "tax", "booking", id],
    queryFn: () => fetchBookingTax(id),
  });
  const data = tax.data;

  const keep = (files: FileList | null) => {
    for (const file of Array.from(files ?? [])) void write(() => uploadReceipt(file, id));
  };
  const drop = (event: DragEvent) => {
    event.preventDefault();
    setOver(false);
    keep(event.dataTransfer.files);
  };

  return (
    <article
      className={
        over
          ? "overview-card finance-wide-card finance-tax-drop"
          : "overview-card finance-wide-card"
      }
      aria-label="Tax and receipts"
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={drop}
    >
      <h3 className="overview-name">Tax and receipts</h3>
      {tax.error ? <p role="alert">{tax.error.message}</p> : null}
      {data === undefined ? null : (
        <>
          {data.mark == null ? null : (
            <p className="overview-caption">
              {`${money(data.mark.tax_amount)} counts, ${RECEIPT_STATUS[data.mark.receipt_status] ?? data.mark.receipt_status}`}
            </p>
          )}
          <MarkForm
            key={`${data.mark?.form_line}-${data.mark?.tax_amount}-${data.mark?.note}`}
            id={id}
            tax={data}
            write={write}
          />
          <ul className="finance-drill-notes">
            {data.receipts.map((receipt) => (
              <li key={receipt.id} className="finance-tax-receipt">
                <a href={receiptUrl(receipt.id)} target="_blank" rel="noreferrer">
                  {receipt.name ?? `Receipt ${receipt.id}`}
                </a>
                <button
                  type="button"
                  className="finance-pane-button"
                  onClick={() =>
                    void write(() => patchReceipt(receipt.id, { transaction_id: null }))
                  }
                >
                  Take off
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <button type="button" className="finance-pane-button" onClick={() => picker.current?.click()}>
        Add a receipt
      </button>
      <input
        ref={picker}
        type="file"
        accept={ACCEPT}
        multiple
        hidden
        aria-label="Receipt file"
        onChange={(event) => {
          keep(event.target.files);
          event.target.value = "";
        }}
      />
      <p className="overview-caption">or drop a PDF, JPEG or PNG here</p>
    </article>
  );
}
