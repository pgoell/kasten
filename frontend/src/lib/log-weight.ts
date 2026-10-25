/**
 * What a last kind (weight, say) reads over a range: its value on each day, the 7-day
 * average, the first and last weigh-ins and the change between them. Pure, so the pane's
 * rows, line, tile and column read the same numbers.
 *
 * A day's value is the total `GET /api/log` gives its last kind, null on a day with no
 * line of it. The averages and the change stay inside the range, so no fetch is needed
 * before it.
 */

import { shiftDay } from "@/lib/clock";
import type { LogDay } from "@/lib/food-api";
import type { LogKind } from "@/lib/log-kinds";
import { tenth } from "@/lib/log-lines";

/** The dates from `from` for `range` days, oldest first. */
export function rangeDates(from: string, range: number): string[] {
  return Array.from({ length: range }, (_, index) => shiftDay(from, index));
}

/** The day's value of a last kind, or null where the day has no line of it. */
export function valueOn(kind: LogKind, day: LogDay | undefined): number | null {
  return day?.totals.mine?.find((mine) => mine.mark === kind.mark)?.total ?? null;
}

/** The mean of the weigh-ins among `values` to a tenth, or null with none. */
export function meanOf(values: (number | null)[]): number | null {
  const found = values.filter((value): value is number => value !== null);
  if (found.length === 0) return null;
  return tenth(found.reduce((sum, value) => sum + value, 0) / found.length);
}

/**
 * The 7-day average for each date: the mean of its weigh-ins and the six dates before it
 * inside the range. Null where none of those seven has a weigh-in.
 */
export function averagesOf(values: (number | null)[]): (number | null)[] {
  return values.map((_, index) => meanOf(values.slice(Math.max(0, index - 6), index + 1)));
}

/** The latest weigh-in on or before `date`, with its date, or null where there is none. */
export function latestOn(
  values: (number | null)[],
  dates: string[],
  date: string,
): { value: number; date: string } | null {
  for (let index = dates.length - 1; index >= 0; index -= 1) {
    const day = dates[index];
    const value = values[index];
    if (day !== undefined && day <= date && value !== undefined && value !== null) {
      return { value, date: day };
    }
  }
  return null;
}

/** What a last kind reads over a range. */
export interface Weight {
  /** The value on each date, null where there is no weigh-in. */
  values: (number | null)[];
  averages: (number | null)[];
  count: number;
  first: number | null;
  last: number | null;
  /** The last weigh-in minus the first, to a tenth; null with fewer than two. */
  change: number | null;
}

/** A last kind's weigh-ins over `dates`, which `days` answers for. */
export function weightOf(kind: LogKind, dates: string[], days: LogDay[]): Weight {
  const byDate = new Map(days.map((day) => [day.date, day]));
  const values = dates.map((date) => valueOn(kind, byDate.get(date)));
  const found = values.filter((value): value is number => value !== null);
  const first = found[0] ?? null;
  const last = found[found.length - 1] ?? null;
  return {
    values,
    averages: averagesOf(values),
    count: found.length,
    first,
    last,
    change: found.length < 2 || first === null || last === null ? null : tenth(last - first),
  };
}
