import { useQuery } from "@tanstack/react-query";
import { type RefObject, useState } from "react";
import { amountOf } from "@/components/finance-budget-tab";
import { type DrillProps, useWrite, Waiting } from "@/components/finance-drill-parts";
import type { TabKeys } from "@/components/finance-sort-bar";
import { fetchSetup, type Setup, writeLimits } from "@/lib/finance-budget-api";
import { euros, monthName, monthOf } from "@/lib/finance-words";

const KINDS: Record<string, string> = {
  fixed: "Fixed",
  flexible: "Flexible",
  non_monthly: "Non-monthly",
};

/** An amount as a field shows it, the German way and to the cent: `1450,50`, `1450`, or empty. */
function shown(amount: string | null | undefined): string {
  if (amount == null) return "";
  const [whole, cents] = Number(amount).toFixed(2).split(".");
  return cents === "00" ? (whole ?? "") : `${whole},${cents}`;
}

/** A field's amount in cents, or null for an empty or unreadable one, which is no limit. */
function cents(text: string): number | null {
  const amount = Number(amountOf(text));
  return text.trim() === "" || !Number.isFinite(amount) ? null : Math.round(amount * 100);
}

/** A stored amount in cents, or null for none. */
function stored(amount: string | null | undefined): number | null {
  return amount == null ? null : Math.round(Number(amount) * 100);
}

/**
 * Every spending category's limit on one screen. Each field starts from the limit in force; the
 * suggestion stands beside it, the larger of the category's monthly plans and its 6-month average,
 * and `u` or `Use suggestions` fills every field with them. The fields add up against the month's
 * expected income, and saving sends only the limits that changed.
 */
function SetupForm({
  setup,
  month,
  keys,
  onSave,
}: {
  setup: Setup;
  month: string;
  keys: RefObject<TabKeys | null>;
  onSave: (limits: { category_id: number; amount: string | null }[]) => Promise<void>;
}) {
  const [drafts, setDrafts] = useState<Record<number, string>>(() =>
    Object.fromEntries(setup.categories.map((c) => [c.id, shown(c.limit)])),
  );
  const suggest = () =>
    setDrafts(
      Object.fromEntries(setup.categories.map((c) => [c.id, shown(c.suggested ?? c.limit)])),
    );
  keys.current = (key) => {
    if (key !== "u") return false;
    suggest();
    return true;
  };
  const total =
    setup.categories.reduce((sum, c) => sum + (cents(drafts[c.id] ?? "") ?? 0), 0) / 100;
  const income = Number(setup.expected_income);
  const left = income - total;
  const changed = setup.categories
    .filter((c) => cents(drafts[c.id] ?? "") !== stored(c.limit))
    .map((c) => {
      const amount = cents(drafts[c.id] ?? "");
      return { category_id: c.id, amount: amount === null ? null : (amount / 100).toFixed(2) };
    });
  return (
    <form
      className="finance-setup"
      onSubmit={(event) => {
        event.preventDefault();
        void onSave(changed);
      }}
    >
      <table className="finance-drill-table finance-setup-table">
        <thead>
          <tr>
            <th scope="col">Category</th>
            <th scope="col">Average</th>
            <th scope="col">Suggested</th>
            <th scope="col">{`From ${monthName(month, true)}`}</th>
          </tr>
        </thead>
        {Object.entries(KINDS).map(([kind, name]) => {
          const rows = setup.categories.filter((c) => c.kind === kind);
          if (rows.length === 0) return null;
          return (
            <tbody key={kind}>
              <tr>
                <th scope="rowgroup" colSpan={4} className="finance-setup-kind">
                  {name}
                </th>
              </tr>
              {rows.map((c) => (
                <tr key={c.id}>
                  <th scope="row">
                    {c.name}
                    {c.plans.length === 0 ? null : (
                      <span className="finance-muted">{` plans: ${c.plans.join(", ")}, ${euros(c.planned ?? 0)}`}</span>
                    )}
                  </th>
                  <td>{c.average == null ? "none" : euros(c.average)}</td>
                  <td>{c.suggested == null ? "none" : euros(c.suggested)}</td>
                  <td>
                    <input
                      inputMode="decimal"
                      aria-label={`${c.name} limit from ${monthName(month)}`}
                      placeholder="none"
                      value={drafts[c.id] ?? ""}
                      onChange={(event) => setDrafts({ ...drafts, [c.id]: event.target.value })}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          );
        })}
      </table>
      <p className="overview-words">
        {`${euros(total)} of limits against ${euros(income)} expected income: `}
        <strong className={left < 0 ? "finance-danger" : undefined}>
          {left < 0 ? `${euros(-left)} over ⚠` : `${euros(left)} left`}
        </strong>
      </p>
      <p className="overview-caption">
        each field starts from the limit in force; a suggestion is the larger of the category's
        monthly plans and its 6-month average. An empty field takes the limit away. Saving sets the
        limits you changed from {monthName(month)} on; the months before keep theirs.
      </p>
      <div className="finance-pane-categories">
        <button type="button" className="finance-pane-button" onClick={suggest}>
          <kbd>u</kbd> Use suggestions
        </button>
        <button type="submit" className="finance-pane-button" disabled={changed.length === 0}>
          {changed.length === 0
            ? "Nothing changed"
            : `Save ${changed.length} ${changed.length === 1 ? "limit" : "limits"}`}
        </button>
      </div>
    </form>
  );
}

/**
 * The budget setup as a drilldown of the Budget tab. It always sets limits from this month on,
 * whatever month is shown, so a month already over never changes under it.
 */
export function DrillSetup({ today, keys, onNotice }: DrillProps) {
  const write = useWrite(onNotice);
  const month = monthOf(today);
  const setup = useQuery({
    queryKey: ["finance", "setup", month, today],
    queryFn: () => fetchSetup(month, today),
  });
  if (setup.data === undefined) return <Waiting error={setup.error} />;
  return (
    <div className="finance-drill">
      <article className="overview-card">
        <h3 className="overview-name">{`Every limit from ${monthName(month)}`}</h3>
        <SetupForm
          key={setup.dataUpdatedAt}
          setup={setup.data}
          month={month}
          keys={keys}
          onSave={(limits) => write(() => writeLimits(month, limits))}
        />
      </article>
    </div>
  );
}
