import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type RefObject, useState } from "react";
import { Meter, statusWords } from "@/components/finance-meter";
import type { TabKeys } from "@/components/finance-sort-bar";
import { type BudgetCategory, fetchBudget, writeLimit } from "@/lib/finance-budget-api";
import { categoryColour, euros, monthName, percent, shiftMonth } from "@/lib/finance-words";

const KINDS = [
  { kind: "fixed", name: "Fixed" },
  { kind: "flexible", name: "Flexible" },
  { kind: "non_monthly", name: "Non-monthly" },
];

/** The words under a category's meter: its average, and what an overspend cut from its limit. */
function aside(row: BudgetCategory, month: string): string {
  const average = row.average == null ? "no average yet" : `average ${euros(row.average)}`;
  // The limit shows on its own only when a cut makes it differ from the figure beside the sum.
  const cut =
    Number(row.carried) > 0
      ? `, limit ${euros(row.limit ?? 0)} cut by ${euros(row.carried)} after ${monthName(shiftMonth(month, -1), true)}`
      : "";
  return `${average}${cut}`;
}

/**
 * A typed limit as the API takes it: `1.234,56` and `1234.56` alike, the German way when a
 * comma is in it; an empty field is no limit.
 */
export function amountOf(text: string): string | null {
  // The minus sign the pane writes amounts with reads as a hyphen's.
  const typed = text.trim().replace(/\s|€/g, "").replace("\u2212", "-");
  if (typed === "") return null;
  if (typed.includes(",")) return typed.replaceAll(".", "").replace(",", ".");
  // `1.200` with no comma is twelve hundred the German way, not one point two; `-1.200` too.
  return /^-?\d{1,3}(\.\d{3})+$/.test(typed) ? typed.replaceAll(".", "") : typed;
}

/** A typed amount as a number, or undefined for one that is not a number above zero. */
export function positive(text: string): number | undefined {
  const amount = Number(amountOf(text));
  return Number.isFinite(amount) && amount > 0 ? amount : undefined;
}

interface RowProps {
  row: BudgetCategory;
  month: string;
  share: number;
  selected: boolean;
  editing: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onSave: (amount: string | null) => void;
  onCancel: () => void;
}

/** The limit's field, Enter to save and Escape to leave it; an empty field takes the limit away. */
function LimitField({
  row,
  month,
  onSave,
  onCancel,
}: Pick<RowProps, "row" | "month" | "onSave" | "onCancel">) {
  const [draft, setDraft] = useState(
    row.limit == null ? "" : String(Math.round(Number(row.limit))),
  );
  const save = () => onSave(amountOf(draft));
  return (
    <span className="finance-budget-edit">
      <input
        // biome-ignore lint/a11y/noAutofocus: the field opens on a key or a tap meant to type into it.
        autoFocus
        inputMode="decimal"
        aria-label={`${row.name} limit from ${monthName(month)}`}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") save();
          else if (event.key === "Escape") onCancel();
          else return;
          event.preventDefault();
          event.stopPropagation();
        }}
      />
      <button type="button" className="finance-pane-button finance-small" onClick={save}>
        Save
      </button>
      <button type="button" className="finance-pane-button finance-small" onClick={onCancel}>
        Cancel
      </button>
    </span>
  );
}

/** The field while editing, Edit on the cursor's row, and the suggestion wherever there is one. */
function RowActions({
  row,
  month,
  selected,
  editing,
  onEdit,
  onSave,
  onCancel,
}: Omit<RowProps, "share" | "onSelect">) {
  const suggestion = row.suggestion;
  if (editing) {
    return (
      <div className="finance-budget-actions">
        <LimitField row={row} month={month} onSave={onSave} onCancel={onCancel} />
      </div>
    );
  }
  if (!selected && suggestion == null) return null;
  return (
    <div className="finance-budget-actions">
      {selected ? (
        <button type="button" className="finance-pane-button finance-small" onClick={onEdit}>
          <kbd>e</kbd> {row.limit == null ? "Set a limit" : "Edit limit"}
        </button>
      ) : null}
      {suggestion == null ? null : (
        <button
          type="button"
          className="finance-pane-button finance-small finance-suggest"
          onClick={() => onSave(suggestion.amount)}
        >
          <kbd>y</kbd> {suggestion.direction === "raise" ? "Raise" : "Lower"} to{" "}
          {euros(suggestion.amount)}
        </button>
      )}
    </div>
  );
}

function BudgetRow({
  row,
  month,
  share,
  selected,
  editing,
  onSelect,
  onEdit,
  onSave,
  onCancel,
}: RowProps) {
  const spent = Number(row.spent);
  const available = row.available == null ? null : Number(row.available);
  return (
    // biome-ignore lint/a11y/useAriaPropsSupportedByRole: the cursor row is the one marked, as the log pane's is.
    <li
      aria-selected={selected}
      className={selected ? "finance-budget-row finance-pane-selected" : "finance-budget-row"}
    >
      <button type="button" className="finance-budget-line" onClick={onSelect}>
        <span
          className="finance-budget-name"
          style={{ "--finance-dot": categoryColour(row.name) } as React.CSSProperties}
        >
          {row.name}
        </span>
        <span className="finance-budget-sum">
          {euros(spent)}
          {available === null ? null : <span className="finance-muted"> / {euros(available)}</span>}
        </span>
      </button>
      {available === null ? null : (
        <Meter
          spent={spent}
          available={available}
          status={row.status}
          tick={row.kind === "flexible" ? share : undefined}
        />
      )}
      <p className="finance-budget-aside">
        <span>{aside(row, month)}</span>
        <span className={`finance-status-text-${row.status ?? "none"}`}>{statusWords(row)}</span>
      </p>
      <RowActions
        row={row}
        month={month}
        selected={selected}
        editing={editing}
        onEdit={onEdit}
        onSave={onSave}
        onCancel={onCancel}
      />
    </li>
  );
}

/**
 * Every spending category by kind: what it spent against what it may, a meter with the month's
 * tick for a flexible one, its average, a cut an overspend made, the suggestion to change the
 * limit, and the limit itself to edit in place, from the month shown on.
 */
export function FinanceBudget({
  month,
  today,
  keys,
  onNotice,
  refocus,
}: {
  month: string;
  today: string;
  keys: RefObject<TabKeys | null>;
  onNotice: (text: string | undefined) => void;
  /** Gives the pane the keys back once the field it held closes. */
  refocus: () => void;
}) {
  const queries = useQueryClient();
  const budget = useQuery({
    queryKey: ["finance", "budget", month, today],
    queryFn: () => fetchBudget(month, today),
  });
  const [cursor, setCursor] = useState(0);
  const [editing, setEditing] = useState<number>();
  const rows = KINDS.flatMap(({ kind }) =>
    (budget.data?.categories ?? []).filter((row) => row.kind === kind),
  );
  const at = Math.max(0, Math.min(cursor, rows.length - 1));
  const share = Number(budget.data?.share_of_month ?? 0);

  /** Write the limit; a refused one leaves the field open with what was typed. */
  async function save(row: BudgetCategory, amount: string | null) {
    try {
      await writeLimit(row.id, amount, month);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      onNotice(error.message);
      return;
    }
    onNotice(undefined);
    setEditing(undefined);
    refocus();
    await queries.invalidateQueries({ queryKey: ["finance"] });
  }

  keys.current = (key) => {
    const row = rows[at];
    if (key === "j" || key === "k")
      setCursor(Math.max(0, Math.min(at + (key === "j" ? 1 : -1), rows.length - 1)));
    else if (key === "e" && row !== undefined) setEditing(row.id);
    else if (key === "y" && row?.suggestion != null) void save(row, row.suggestion.amount);
    else return false;
    return true;
  };

  const limited = rows.filter((row) => row.available != null);
  const limits = limited.reduce((sum, row) => sum + Number(row.available), 0);
  const spent = limited.reduce((sum, row) => sum + Number(row.spent), 0);
  return (
    <div className="finance-budget">
      {budget.error ? <p role="alert">{budget.error.message}</p> : null}
      {budget.data === undefined ? null : (
        <p className="finance-pane-count">
          {`${euros(spent)} spent of ${euros(limits)} in limits, ${percent(share)} of ${monthName(month)} gone`}
        </p>
      )}
      {KINDS.map(({ kind, name }) => (
        <section key={kind} aria-label={name} className="finance-budget-group">
          <h3>{name}</h3>
          <ul className="finance-budget-list">
            {rows.map((row, index) =>
              row.kind !== kind ? null : (
                <BudgetRow
                  key={row.id}
                  row={row}
                  month={month}
                  share={share}
                  selected={index === at}
                  editing={editing === row.id}
                  onSelect={() => setCursor(index)}
                  onEdit={() => {
                    setCursor(index);
                    setEditing(row.id);
                  }}
                  onSave={(amount) => void save(row, amount)}
                  onCancel={() => {
                    setEditing(undefined);
                    refocus();
                  }}
                />
              ),
            )}
          </ul>
        </section>
      ))}
    </div>
  );
}
