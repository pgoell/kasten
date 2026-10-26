import { type ReactNode, useState } from "react";
import { BalanceLine, Bars } from "@/components/charts";
import { monthName } from "@/lib/finance-words";

/**
 * A figure per month as bars, or as a balance line, with the month pointed at read out above it
 * and the months under it. A button over each month names it for a screen reader and the readout,
 * on a mouse's hover or a key's focus; with `onPick`, a press shows that month. The spending
 * trend, the forecast and every drilldown draw their months with it, so they read as one chart.
 */
export function MonthChart({
  months,
  values,
  line = false,
  goal,
  month,
  onPick,
  label,
  hitLabel,
  readout,
}: {
  months: string[];
  values: number[];
  /** A balance line rather than bars. */
  line?: boolean;
  /** The dashed line across the bars, such as a limit. */
  goal?: number;
  /** The month shown, whose bar stands out and which the readout falls back to. */
  month?: string;
  onPick?: (month: string) => void;
  label: string;
  hitLabel: (index: number) => string;
  readout: (index: number) => ReactNode;
}) {
  const [hovered, setHovered] = useState<number>();
  const shown = month === undefined ? -1 : months.indexOf(month);
  const read = hovered ?? (shown === -1 ? months.length - 1 : shown);
  return (
    <>
      <p className="finance-trend-readout" aria-live="polite">
        {readout(read)}
      </p>
      <div className="finance-trend-plot">
        {line ? (
          <BalanceLine values={values} hovered={hovered} label={label} />
        ) : (
          <Bars
            label={label}
            // A month of refunds past its spending draws no bar below the axis.
            points={values.map((value, index) => ({ index, amount: Math.max(0, value) }))}
            slots={months.length}
            goal={goal === undefined ? undefined : { type: "ceiling", value: goal }}
            todayIndex={shown === -1 ? undefined : shown}
            stretch
          />
        )}
        <div className="finance-trend-hits">
          {months.map((at, index) => (
            <button
              key={at}
              type="button"
              aria-label={hitLabel(index)}
              aria-pressed={onPick === undefined ? undefined : index === shown}
              className="finance-trend-hit"
              onClick={onPick === undefined ? undefined : () => onPick(at)}
              onFocus={() => setHovered(index)}
              onBlur={() => setHovered(undefined)}
              // Only a mouse hovers: a finger's press would leave the readout on a month nobody points at.
              onPointerEnter={(event) => {
                if (event.pointerType === "mouse") setHovered(index);
              }}
              onPointerLeave={() => setHovered(undefined)}
            />
          ))}
        </div>
      </div>
      <div className="finance-trend-axis" aria-hidden="true">
        {months.map((at, index) => (
          <span key={at} className={index === shown ? "finance-trend-now" : undefined}>
            <span className="finance-wide">{monthName(at, true)}</span>
            <span className="finance-narrow">{Number(at.slice(5))}</span>
          </span>
        ))}
      </div>
    </>
  );
}
