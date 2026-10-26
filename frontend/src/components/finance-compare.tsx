import type { ScopeCompared } from "@/lib/finance-budget-api";
import type { Scope, ScopeDrill } from "@/lib/finance-drill-api";
import { euros } from "@/lib/finance-words";

export type ScopeMonth = ScopeDrill["months"][number];

/** A scope's parts in the order the sankey stacks them, each with the sign it has on the month. */
export function partsOf(scope: Scope): { key: keyof ScopeMonth; name: string; sign: 1 | -1 }[] {
  return [
    { key: "income", name: "Income", sign: 1 },
    scope === "household"
      ? { key: "other_scope", name: "From mine", sign: 1 }
      : { key: "other_scope", name: "Into household", sign: -1 },
    { key: "fixed", name: "Fixed", sign: -1 },
    { key: "flexible", name: "Flexible", sign: -1 },
    { key: "non_monthly", name: "Non-monthly", sign: -1 },
    { key: "reserved", name: "Reserved for plans", sign: -1 },
    { key: "saved", name: "Saved", sign: -1 },
    { key: "unsorted", name: "Not sorted", sign: -1 },
  ];
}

/** What a month or span spent: its fixed, flexible and non-monthly parts. */
export function spentIn(row: ScopeMonth): number {
  return Number(row.fixed) + Number(row.flexible) + Number(row.non_monthly);
}

/** A change as words beside a figure: `+12%` or `−5%`, nothing when there is no base. */
function change(now: number, before: number): string {
  if (before === 0) return "";
  const share = Math.round(((now - before) / Math.abs(before)) * 100);
  return share === 0 ? "±0%" : share > 0 ? `+${share}%` : `−${-share}%`;
}

/** The change from one figure to another beside it, or nothing when there is no base. */
function Change({ now, before }: { now: string; before: string }) {
  const words = change(Number(now), Number(before));
  return words === "" ? null : <span className="finance-muted"> {words}</span>;
}

/**
 * A scope's span against the same months a year before and the 6 months before it, a row per
 * part that is not zero in any of the three, then what was left. With no month before the span,
 * the average reads "none yet".
 */
export function CompareTable({
  scope,
  compared,
  label,
}: {
  scope: Scope;
  compared: ScopeCompared;
  label: string;
}) {
  const { now, last_year: before, average } = compared;
  const rows = [
    ...partsOf(scope),
    { key: "left" as const, name: "Left over", sign: 1 as const },
  ].filter(({ key }) => [now, before, average].some((row) => row && Number(row[key]) !== 0));
  return (
    <div className="finance-compare">
      <table className="finance-drill-table">
        <thead>
          <tr>
            <th scope="col">{scope === "mine" ? "Mine" : "Household"}</th>
            <th scope="col">{label}</th>
            <th scope="col">A year before</th>
            <th scope="col">6-month average</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ key, name, sign }) => (
            <tr key={key}>
              <th scope="row">{name}</th>
              <td>{euros(sign * Number(now[key]))}</td>
              <td>
                {euros(sign * Number(before[key]))}
                <Change now={now[key]} before={before[key]} />
              </td>
              <td>
                {average == null ? "none yet" : euros(sign * Number(average[key]))}
                {average == null ? null : <Change now={now[key]} before={average[key]} />}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A span's parts as the line under its figure: `10.350 € income, less 2.700 € into household…`. */
export function spanMadeOf(scope: Scope, row: ScopeMonth): string {
  const parts = partsOf(scope).filter(({ key }) => Number(row[key]) !== 0);
  const ins = parts
    .filter(({ sign }) => sign > 0)
    .map(({ key, name }) => `${euros(row[key])} ${name.toLowerCase()}`);
  const outs = parts
    .filter(({ sign }) => sign < 0)
    .map(({ key, name }) => `${euros(row[key])} ${name.toLowerCase()}`);
  return [ins.join(", "), outs.length > 0 ? `less ${outs.join(", ")}` : ""]
    .filter(Boolean)
    .join(", ");
}
