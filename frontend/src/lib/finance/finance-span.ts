/**
 * The span of months the finance pane reads: one month, its quarter, its year, or any months
 * from one to another. The pane keeps a kind and the month shown; the span is worked out from
 * them, and never runs past the month today is in, so a quarter or year still running reads
 * "so far" and compares with the same months a year before, not with whole ones.
 */

import { monthName, shiftMonth } from "@/lib/finance/finance-words";

export type SpanKind = "month" | "quarter" | "year" | "custom";

export const SPAN_KINDS: readonly { kind: SpanKind; label: string }[] = [
  { kind: "month", label: "Month" },
  { kind: "quarter", label: "Quarter" },
  { kind: "year", label: "Year" },
  { kind: "custom", label: "Custom" },
];

/** The first and last month of a span, `YYYY-MM`, both included. */
export interface Span {
  from: string;
  to: string;
}

/** How many months the kind steps by; custom steps by its own length. */
const STEP: Record<Exclude<SpanKind, "custom">, number> = { month: 1, quarter: 3, year: 12 };

/** The months from one to another, both included. */
export function monthsIn(span: Span): number {
  const [fy, fm] = span.from.split("-").map(Number);
  const [ty, tm] = span.to.split("-").map(Number);
  return ((ty ?? 0) - (fy ?? 0)) * 12 + (tm ?? 0) - (fm ?? 0) + 1;
}

/** The earlier of two months. */
function earlier(a: string, b: string): string {
  return a < b ? a : b;
}

/**
 * The span a kind makes around `month`: the month, the quarter or year it is in, or `custom`
 * as given; cut at `now`, the month today is in.
 */
export function spanOf(kind: SpanKind, month: string, now: string, custom?: Span): Span {
  if (kind === "custom" && custom !== undefined) {
    // In either order: a first month typed past the last reads as the span between them.
    const [from, to] = [custom.from, custom.to].sort();
    return { from: earlier(from ?? now, now), to: earlier(to ?? now, now) };
  }
  const number = Number(month.slice(5));
  const start =
    kind === "quarter"
      ? shiftMonth(month, -((number - 1) % 3))
      : kind === "year"
        ? `${month.slice(0, 4)}-01`
        : month;
  const end = shiftMonth(start, (kind === "custom" ? 1 : STEP[kind]) - 1);
  return { from: earlier(start, now), to: earlier(end, now) };
}

/** The month a step of `count` spans moves the month shown to. */
export function stepMonth(kind: SpanKind, month: string, count: number, custom?: Span): string {
  const length = kind === "custom" ? (custom === undefined ? 1 : monthsIn(custom)) : STEP[kind];
  return shiftMonth(month, count * length);
}

/** A span in words: `October 2026`, `Q3 2026`, `2026`, or `Jul 2026 to Sep 2026`. */
export function spanName(kind: SpanKind, span: Span, now: string): string {
  const running = span.to === now && monthsIn(span) > 1 ? " so far" : "";
  if (span.from === span.to && kind === "month") return monthName(span.from);
  if (kind === "quarter")
    return `Q${Math.ceil(Number(span.from.slice(5)) / 3)} ${span.from.slice(0, 4)}${running}`;
  if (kind === "year") return `${span.from.slice(0, 4)}${running}`;
  if (span.from === span.to) return monthName(span.from);
  return `${monthName(span.from, true)} ${span.from.slice(0, 4)} to ${monthName(span.to, true)} ${span.to.slice(0, 4)}`;
}
