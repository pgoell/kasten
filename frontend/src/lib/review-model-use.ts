/**
 * The year review's model use, worked out from the usage lines the collector's notes hold: the
 * tokens and the cost per month, the tokens and cost per project, and the tokens no price covered.
 * Pure, as `review-year.ts` is, so each rule is checked on plain input.
 */

import type { ModelUseLine } from "@/lib/review-api";
import { byText } from "@/lib/review-year";

/** The tokens one line's messages used: its four counts added. */
export function tokensOf(line: ModelUseLine): number {
  return line.input + line.output + line.cache_write + line.cache_read;
}

/**
 * Tokens and cost of a month or a project. `cost` is the sum of its priced lines, and null
 * where none of them is priced, so a total with no price is never read as $0.00.
 */
export interface Use {
  tokens: number;
  cost: number | null;
}

const NOTHING: Use = { tokens: 0, cost: null };

/** A line added to a total: its tokens always, its cost only where the line has one. */
function added(total: Use, line: ModelUseLine): Use {
  return {
    tokens: total.tokens + tokensOf(line),
    cost: line.cost === null ? total.cost : (total.cost ?? 0) + line.cost,
  };
}

/** Twelve months of `year`, January first. A month with no line is no tokens and no cost. */
export function monthUse(lines: ModelUseLine[], year: number): Use[] {
  const months: Use[] = Array.from({ length: 12 }, () => NOTHING);
  for (const line of lines) {
    if (!line.day.startsWith(`${year}-`)) continue;
    const index = Number(line.day.slice(5, 7)) - 1;
    const month = months[index];
    if (month !== undefined) months[index] = added(month, line);
  }
  return months;
}

export interface ProjectUse extends Use {
  project: string;
}

/** One row per project, the most costly first, then the most tokens, then by name. */
export function projectUse(lines: ModelUseLine[]): ProjectUse[] {
  const totals = new Map<string, Use>();
  for (const line of lines) {
    totals.set(line.project, added(totals.get(line.project) ?? NOTHING, line));
  }
  return [...totals]
    .map(([project, use]) => ({ project, ...use }))
    .sort(
      (a, b) =>
        (b.cost ?? 0) - (a.cost ?? 0) || b.tokens - a.tokens || byText(a.project, b.project),
    );
}

/**
 * The tokens that had no price. A line with no cost at all counts every token it has; a line with
 * some priced messages counts its `unpriced`. Not both for one line, so none is counted twice.
 */
export function unpricedTokens(lines: ModelUseLine[]): number {
  return lines.reduce(
    (sum, line) => sum + (line.cost === null ? tokensOf(line) : line.unpriced),
    0,
  );
}

/**
 * Tokens in words: `12.3B` from a billion, `1.2M` from a million, `340k` from a thousand, `912` below.
 * The M step stops where the B step starts, at 999.5M, so a figure that rounds up to 1000M reads as 1.0B.
 */
export function tokenWords(tokens: number): string {
  if (tokens >= 999_500_000) return `${(tokens / 1_000_000_000).toFixed(1)}B`;
  if (tokens >= 999_500) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}k`;
  return String(tokens);
}

const DOLLARS = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** A cost in dollars with two decimals and a comma per thousand: `$4.10`, `$1,204.55`. */
export function costWords(cost: number): string {
  return `$${DOLLARS.format(cost)}`;
}
