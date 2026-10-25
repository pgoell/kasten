import type { LogDay } from "@/lib/food-api";
import type { LogKind } from "@/lib/log-kinds";
import { averagesOf, latestOn, meanOf, valueOn, weightOf } from "@/lib/log-weight";

const WEIGHT: LogKind = { mark: "⚖", name: "weight", unit: "kg", last: true };

/** A day with a weigh-in of `total` in its totals, or with none where `total` is null. */
function weighed(date: string, total: number | null): LogDay {
  return {
    date,
    path: `daily/${date}.md`,
    entries: [],
    totals: { mine: [{ mark: "⚖", name: "weight", unit: "kg", total }] },
  } as unknown as LogDay;
}

/** Consecutive dates from `first`, `count` of them. */
function dates(first: string, count: number): string[] {
  const start = Date.parse(`${first}T00:00:00Z`);
  return Array.from({ length: count }, (_, index) =>
    new Date(start + index * 86_400_000).toISOString().slice(0, 10),
  );
}

it("#805 A7 the day's value is its weigh-in, and null on a day with none", () => {
  expect(valueOn(WEIGHT, weighed("2026-10-01", 82.4))).toBe(82.4);
  expect(valueOn(WEIGHT, weighed("2026-10-02", null))).toBeNull();
  expect(valueOn(WEIGHT, undefined)).toBeNull();
});

it("#805 A7 the latest weigh-in on or before a date comes with its date", () => {
  const range = dates("2026-10-01", 5);
  const values = [82.4, null, 83.1, null, null];

  expect(latestOn(values, range, "2026-10-05")).toEqual({ value: 83.1, date: "2026-10-03" });
  expect(latestOn(values, range, "2026-10-02")).toEqual({ value: 82.4, date: "2026-10-01" });
  expect(latestOn([null, null, null, null, null], range, "2026-10-05")).toBeNull();
});

it("#805 A8 the 7-day average is the mean of the day and the six before it in the range", () => {
  // The first date has only itself to average, and the seventh has all seven.
  const values = [80, null, 81, 82, null, 83, 84, 85];
  const averages = averagesOf(values);

  expect(averages[0]).toBe(80);
  expect(averages[2]).toBe(80.5);
  expect(averages[6]).toBe(82);
  // The eighth date's window starts at the second, so the first 80 has left it.
  expect(averages[7]).toBe(83);
});

it("#805 A8 a 7-day average with no weigh-in in its seven dates is null", () => {
  const values = [82, null, null, null, null, null, null, null, 83];

  expect(averagesOf(values)[7]).toBeNull();
  expect(averagesOf(values)[8]).toBe(83);
});

it("#805 A9 the change is the last weigh-in minus the first, to a tenth", () => {
  const range = dates("2026-10-01", 4);
  const days = [weighed(range[0] ?? "", 83.6), weighed(range[2] ?? "", 82.4)];
  const weight = weightOf(WEIGHT, range, days);

  expect(weight.count).toBe(2);
  expect(weight.first).toBe(83.6);
  expect(weight.last).toBe(82.4);
  expect(weight.change).toBe(-1.2);
});

it("#805 A9 the change with one weigh-in or none is null", () => {
  const range = dates("2026-10-01", 3);

  expect(weightOf(WEIGHT, range, [weighed("2026-10-02", 82.4)]).change).toBeNull();
  expect(weightOf(WEIGHT, range, []).change).toBeNull();
  expect(weightOf(WEIGHT, range, []).count).toBe(0);
});

it("#805 A10 the week mean is the mean of its weigh-ins to a tenth, null with none", () => {
  expect(meanOf([82, 83, 83])).toBe(82.7);
  expect(meanOf([82, null, 84])).toBe(83);
  expect(meanOf([null, null])).toBeNull();
});
