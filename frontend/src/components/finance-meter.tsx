import type { BudgetCategory } from "@/lib/finance/finance-budget-api";
import { euros } from "@/lib/finance/finance-words";

type Status = BudgetCategory["status"];

/**
 * A meter of what was spent against what is available, the log pane's track and fill. The fill
 * takes the status colour; a tick marks how far through the month today is, where pace matters.
 */
export function Meter({
  spent,
  available,
  status,
  tick,
}: {
  spent: number;
  available: number;
  status: Status;
  /** The share of the month gone, 0 to 1, or undefined for no tick. */
  tick?: number;
}) {
  // A refund can leave a negative sum; the fill stays between empty and full.
  const share = available <= 0 ? (spent > 0 ? 1 : 0) : Math.min(1, Math.max(0, spent / available));
  return (
    // Hidden from a screen reader: the words beside it say the same, the status included.
    <div className={`finance-meter finance-status-${status ?? "none"}`} aria-hidden="true">
      <div className="finance-meter-fill" style={{ width: `${share * 100}%` }} />
      {tick === undefined ? null : (
        <div className="finance-meter-tick" style={{ left: `${tick * 100}%` }} />
      )}
    </div>
  );
}

/**
 * What a category's status says in words, with a sign beside the colour so the colour is not
 * the only mark: `Over by 27 € ⚠`, `Near, 12 € left`, `153 € left`.
 */
export function statusWords(row: Pick<BudgetCategory, "status" | "available" | "spent">): string {
  if (row.available == null) return "No limit";
  const left = Number(row.available) - Number(row.spent);
  if (row.status === "over") return `Over by ${euros(-left)} ⚠`;
  if (row.status === "near") return `Near, ${euros(left)} left`;
  return `${euros(left)} left`;
}
