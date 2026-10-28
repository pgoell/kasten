import { MonthChart } from "@/components/finance-month-chart";
import type { Trend } from "@/lib/finance/finance-budget-api";
import { euros, monthName } from "@/lib/finance/finance-words";

/**
 * Spending per month over the trend's months, one bar each, in the log pane's bar chart. The
 * dashed line is the month shown's limits added up, so a bar past it is drawn in the warning
 * colour. A button over each bar names its month and amount for a screen reader and the
 * readout line, on a mouse's hover or a key's focus, and a press shows that month.
 */
export function SpendingTrend({
  trend,
  month,
  onPick,
}: {
  trend: Trend;
  month: string;
  onPick: (month: string) => void;
}) {
  const shown = trend.months.indexOf(month);
  const limit = trend.limits[shown === -1 ? trend.months.length - 1 : shown];
  const goal = limit == null ? undefined : Number(limit);
  const values = trend.totals.map(Number);
  const over = goal === undefined ? 0 : values.filter((value) => value > goal).length;

  return (
    <figure className="finance-trend">
      <MonthChart
        months={trend.months}
        values={values}
        goal={goal}
        month={month}
        onPick={onPick}
        label={`spending per month over ${trend.months.length} months${over ? `, ${over} over this month's limits` : ""}`}
        hitLabel={(index) =>
          `${monthName(trend.months[index] ?? month)}, ${euros(trend.totals[index] ?? 0)} spent`
        }
        readout={(read) => (
          <>
            <span>{monthName(trend.months[read] ?? month)}</span>{" "}
            <strong>{euros(trend.totals[read] ?? 0)}</strong>
            {trend.limits[read] == null ? null : (
              <span className="finance-muted"> of {euros(trend.limits[read] ?? 0)} limits</span>
            )}
          </>
        )}
      />
      <figcaption className="overview-caption">
        {goal === undefined
          ? "spent per month, 12 months"
          : "spent per month, 12 months; the dashed line is this month's limits"}
      </figcaption>
    </figure>
  );
}
