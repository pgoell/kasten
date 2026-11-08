import { useQuery } from "@tanstack/react-query";
import { scheduleName } from "@/components/finance-plan-form";
import { type Contract, fetchContracts } from "@/lib/panes/finance/finance-plans-api";
import { euros, money } from "@/lib/panes/finance/finance-words";

/** A date as `28 Nov 2026`, counted in UTC so no zone moves it. */
function longDay(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function terms(contract: Contract): string {
  if (contract.ends) return `cancelled, ends ${longDay(contract.ends)}`;
  if (contract.cancel_by && contract.renews) {
    return `cancel by ${longDay(contract.cancel_by)}, else renews ${longDay(contract.renews)}`;
  }
  return contract.problem ? "" : "renews no more";
}

function plan(contract: Contract): string {
  if (contract.plan_id != null && contract.plan_name == null) return "";
  if (contract.plan_name == null || contract.amount == null) return "no plan";
  return `${contract.plan_name}, ${money(contract.amount)} ${scheduleName(contract.every_months).toLowerCase()}`;
}

/**
 * Every contract note by its next cancel-by date, with its plan and what it costs a year, and
 * the total, and the note just made. Opening it writes each note's next cancel-by todo first.
 */
export function Contracts({ today, made }: { today: string; made?: string }) {
  const contracts = useQuery({
    queryKey: ["finance", "contracts", today],
    queryFn: () => fetchContracts(today),
  });
  if (contracts.error) return <p role="alert">{contracts.error.message}</p>;
  const rows = contracts.data?.contracts ?? [];
  return (
    <section aria-label="Contracts" className="finance-plans-group">
      <h3>Contracts</h3>
      {made === undefined ? null : <p role="status">{`Wrote ${made}: fill in its terms there.`}</p>}
      {rows.length === 0 ? (
        <p className="finance-muted">
          No contract notes yet: press Contract on a plan or a proposal to start one.
        </p>
      ) : (
        <ul className="finance-plans-list">
          {rows.map((contract) => (
            <li key={contract.path} className="finance-plans-row">
              <span className="finance-plans-name">{contract.name}</span>
              <span className="finance-plans-sum">
                {contract.yearly == null ? "" : `${euros(contract.yearly)} a year`}
              </span>
              <span className="finance-muted finance-plans-aside">
                {[terms(contract), contract.problem, plan(contract)].filter(Boolean).join("; ")}
              </span>
            </li>
          ))}
        </ul>
      )}
      {rows.length === 0 ? null : <p>{`${euros(contracts.data?.yearly ?? 0)} a year in all`}</p>}
    </section>
  );
}
