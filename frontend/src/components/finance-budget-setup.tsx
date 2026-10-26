import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { amountOf } from "@/components/finance-budget-tab";
import { type DrillProps, useWrite, Waiting } from "@/components/finance-drill-parts";
import { fetchSetup, type Setup, writeLimits } from "@/lib/finance-budget-api";
import { euros, monthName } from "@/lib/finance-words";

const KINDS: Record<string, string> = {
  fixed: "Fixed",
  flexible: "Flexible",
  non_monthly: "Non-monthly",
};

/** A limit as the field shows it: whole euros, or nothing for no limit. */
function shown(amount: string | null | undefined): string {
  return amount == null ? "" : String(Math.round(Number(amount)));
}

/** The figure a field holds, as a number; an empty or unreadable field is none. */
function figure(text: string): number {
  const amount = Number(amountOf(text));
  return text.trim() === "" || !Number.isFinite(amount) ? 0 : amount;
}

/**
 * Every spending category's limit on one screen, from the month shown on. Each field starts from
 * the category's plans where it has one, else its 6-month average; its limit now, average and
 * plans stand beside it. The total of the fields reads against the month's expected income, and
 * saving sets every changed limit at once.
 */
function SetupForm({
  setup,
  month,
  onSave,
}: {
  setup: Setup;
  month: string;
  onSave: (limits: { category_id: number; amount: string | null }[]) => Promise<void>;
}) {
  const [drafts, setDrafts] = useState<Record<number, string>>(() =>
    Object.fromEntries(setup.categories.map((c) => [c.id, shown(c.suggested ?? c.limit)])),
  );
  const total = setup.categories.reduce((sum, c) => sum + figure(drafts[c.id] ?? ""), 0);
  const income = Number(setup.expected_income);
  const left = income - total;
  const changed = setup.categories
    .map((c) => ({ category_id: c.id, amount: amountOf(drafts[c.id] ?? "") }))
    .filter((row, index) => {
      const before = setup.categories[index]?.limit;
      return (
        (row.amount == null ? null : Number(row.amount)) !==
        (before == null ? null : Number(before))
      );
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
            <th scope="col">Now</th>
            <th scope="col">Average</th>
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
                  <td>{c.limit == null ? "none" : euros(c.limit)}</td>
                  <td>{c.average == null ? "none" : euros(c.average)}</td>
                  <td>
                    <input
                      inputMode="decimal"
                      aria-label={`${c.name} limit from ${monthName(month)}`}
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
        a field starts from the category's plans where it has one, else from its 6-month average; an
        empty field takes the limit away. Saving sets every changed limit from {monthName(month)}{" "}
        on; the months before keep theirs.
      </p>
      <div className="finance-pane-categories">
        <button type="submit" className="finance-pane-button" disabled={changed.length === 0}>
          {changed.length === 0
            ? "Nothing changed"
            : `Save ${changed.length} ${changed.length === 1 ? "limit" : "limits"}`}
        </button>
      </div>
    </form>
  );
}

/** The budget setup as a drilldown of the Budget tab: one form for the month shown. */
export function DrillSetup({ month, today, onNotice }: DrillProps) {
  const write = useWrite(onNotice);
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
          onSave={(limits) => write(() => writeLimits(month, limits))}
        />
      </article>
    </div>
  );
}
