/**
 * Numbers and goals in the words the log pane writes. Grouped the `en-US` way
 * whatever the browser's locale, so "2,200" reads the same everywhere and a
 * test does not drift with the machine it runs on.
 */

import { overMax } from "@/lib/log-day";
import type { Goal } from "@/lib/log-kinds";

const GROUPED = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

/** A number with a comma per thousand and at most one decimal: `2,200`, `82.4`. */
export function grouped(value: number): string {
  return GROUPED.format(value);
}

/**
 * A goal in words, with where the total stands: `at most 2,200, within` or
 * `at most 2,200, over` for a max, `at least 120` or `at least 120, met` for a min.
 */
export function goalPhrase(total: number, goal: Goal): string {
  const target = grouped(goal.value);
  if (goal.type === "ceiling")
    return `at most ${target}, ${overMax(total, goal) ? "over" : "within"}`;
  return total >= goal.value ? `at least ${target}, met` : `at least ${target}`;
}
