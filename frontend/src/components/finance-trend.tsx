import { useState } from "react";
import { Bars } from "@/components/charts";
import type { Trend } from "@/lib/finance-budget-api";
import { euros, monthName } from "@/lib/finance-words";

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
  const [hovered, setHovered] = useState<number>();
  const shown = trend.months.indexOf(month);
  const limit = trend.limits[shown === -1 ? trend.months.length - 1 : shown];
  const goal = limit == null ? undefined : { type: "ceiling" as const, value: Number(limit) };
  // A month of refunds past its spending draws no bar below the axis.
  const points = trend.totals.map((total, index) => ({
    index,
    amount: Math.max(0, Number(total)),
  }));
  const read = hovered ?? (shown === -1 ? trend.months.length - 1 : shown);
  const over = goal === undefined ? 0 : points.filter((point) => point.amount > goal.value).length;

  return (
    <figure className="finance-trend">
      <p className="finance-trend-readout" aria-live="polite">
        <span>{monthName(trend.months[read] ?? month)}</span>{" "}
        <strong>{euros(trend.totals[read] ?? 0)}</strong>
        {trend.limits[read] == null ? null : (
          <span className="finance-muted"> of {euros(trend.limits[read] ?? 0)} limits</span>
        )}
      </p>
      <div className="finance-trend-plot">
        <Bars
          label={`spending per month over ${trend.months.length} months${over ? `, ${over} over this month's limits` : ""}`}
          points={points}
          slots={trend.months.length}
          goal={goal}
          todayIndex={shown === -1 ? undefined : shown}
          stretch
        />
        <div className="finance-trend-hits">
          {trend.months.map((at, index) => (
            <button
              key={at}
              type="button"
              aria-label={`${monthName(at)}, ${euros(trend.totals[index] ?? 0)} spent`}
              aria-pressed={index === shown}
              className="finance-trend-hit"
              onClick={() => onPick(at)}
              onFocus={() => setHovered(index)}
              onBlur={() => setHovered(undefined)}
              // Only a mouse hovers: a finger's press would leave the readout on a bar nobody points at.
              onPointerEnter={(event) => {
                if (event.pointerType === "mouse") setHovered(index);
              }}
              onPointerLeave={() => setHovered(undefined)}
            />
          ))}
        </div>
      </div>
      <div className="finance-trend-axis" aria-hidden="true">
        {trend.months.map((at, index) => (
          <span key={at} className={index === shown ? "finance-trend-now" : undefined}>
            <span className="finance-wide">{monthName(at, true)}</span>
            <span className="finance-narrow">{Number(at.slice(5))}</span>
          </span>
        ))}
      </div>
      <figcaption className="overview-caption">
        {goal === undefined
          ? "spent per month, 12 months"
          : "spent per month, 12 months; the dashed line is this month's limits"}
      </figcaption>
    </figure>
  );
}
