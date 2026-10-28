import { useState } from "react";
import {
  SPAN_KINDS,
  type Span,
  type SpanKind,
  spanName,
  spanOf,
  stepMonth,
} from "@/lib/finance/finance-span";
import { monthName, monthOf, shiftMonth } from "@/lib/finance/finance-words";

/**
 * The months the pane reads: the month shown, and around it the span the overview and the
 * drilldowns read, a month, its quarter or year, or any months from one to another. The tabs
 * that read one month (transactions, budget, plans) read the month shown alone.
 */
export function useSpan(today: string) {
  const now = monthOf(today);
  const [kind, setKind] = useState<SpanKind>("month");
  const [month, setMonth] = useState(now);
  const [custom, setCustom] = useState<Span>({ from: shiftMonth(now, -2), to: now });
  const span = spanOf(kind, month, now, custom);
  return {
    kind,
    setKind,
    month,
    setMonth,
    custom,
    setCustom,
    span,
    label: spanName(kind, span, now),
    /** Step the month shown by a whole span, or by one month where only the month counts. */
    step(count: number, spans: boolean) {
      if (spans && kind === "custom") {
        setCustom({
          from: stepMonth(kind, custom.from, count, custom),
          to: stepMonth(kind, custom.to, count, custom),
        });
        return;
      }
      setMonth(spans ? stepMonth(kind, month, count) : shiftMonth(month, count));
    },
  };
}

export type SpanState = ReturnType<typeof useSpan>;

/**
 * The span in the pane's head: `‹`, its name and `›`, a way back to this month, and, where the
 * view reads a span, the kind to read and, for a custom one, its first and last month.
 */
export function SpanBar({
  state,
  spans,
  today,
}: {
  state: SpanState;
  spans: boolean;
  today: string;
}) {
  const { kind, setKind, month, setMonth, custom, setCustom, label, step } = state;
  const now = monthOf(today);
  return (
    <div className="finance-pane-month">
      <button
        type="button"
        className="finance-pane-button"
        aria-label={spans ? "Span before" : "Month before"}
        onClick={() => step(-1, spans)}
      >
        ‹
      </button>
      <h2>{spans ? label : monthName(month)}</h2>
      <button
        type="button"
        className="finance-pane-button"
        aria-label={spans ? "Span after" : "Month after"}
        onClick={() => step(1, spans)}
      >
        ›
      </button>
      {month === now ? null : (
        <button type="button" className="finance-pane-button" onClick={() => setMonth(now)}>
          This month
        </button>
      )}
      {spans ? (
        <select
          aria-label="Span"
          className="finance-span-kind"
          value={kind}
          onChange={(event) => setKind(event.target.value as SpanKind)}
        >
          {SPAN_KINDS.map((option) => (
            <option key={option.kind} value={option.kind}>
              {option.label}
            </option>
          ))}
        </select>
      ) : null}
      {spans && kind === "custom" ? (
        <span className="finance-span-custom">
          <input
            type="month"
            aria-label="First month"
            max={custom.to}
            value={custom.from}
            onChange={(event) =>
              event.target.value && setCustom({ ...custom, from: event.target.value })
            }
          />
          <input
            type="month"
            aria-label="Last month"
            min={custom.from}
            max={now}
            value={custom.to}
            onChange={(event) =>
              event.target.value && setCustom({ ...custom, to: event.target.value })
            }
          />
        </span>
      ) : null}
    </div>
  );
}
