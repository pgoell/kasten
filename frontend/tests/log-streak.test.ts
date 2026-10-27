import type { LogDay } from "@/lib/log/food-api";
import type { Goal } from "@/lib/log/log-kinds";
import { streakOf } from "@/lib/log/log-streak";

type Entry = LogDay["entries"][number];

const TODAY = "2026-10-20";
const CEILING: Goal = { type: "ceiling", value: 2200 };
const FLOOR: Goal = { type: "floor", value: 1800 };

const food = (kcal: number): Entry => ({
  line: 1,
  text: `- 🍽 🔥 ${kcal} kcal`,
  kind: "food",
  kcal,
});
const drink: Entry = { line: 2, text: "- ☕ 1 coffee", kind: "coffee", count: 1 };
const mine: Entry = { line: 3, text: "- ⚖ 70 kg", kind: "mine" };

/** A day's `## Log` with these lines, its food total summed from the food lines as the server sums it. */
function logOf(date: string, ...entries: Entry[]): LogDay {
  const kcal = entries.reduce(
    (sum, entry) => sum + (entry.kind === "food" ? (entry.kcal ?? 0) : 0),
    0,
  );
  return {
    date,
    path: `01 Periodic/00 Daily/${date}.md`,
    entries,
    totals: {
      water: { ml: 0 },
      coffee: { count: 0 },
      alcohol: { count: 0, ml: 0, grams: 0 },
      food: { kcal, protein: 0, carbs: 0, fat: 0 },
      mine: [],
    },
  };
}

/** The days keyed by date, as `streakOf` reads them. */
const byDate = (...days: LogDay[]) => new Map(days.map((day) => [day.date, day]));

it("#1012 A1 a past day with drinks only ends the food streak under a kcal ceiling, and a food line of 0 kcal still counts", () => {
  // A food line of 0 kcal is a day with food, so it is within the ceiling and counts.
  expect(streakOf(["2026-10-19"], byDate(logOf("2026-10-19", food(0))), TODAY, CEILING)).toBe(1);

  // The 18th has drinks only, so it ends the run before the 17th, which is within the ceiling.
  const days = byDate(
    logOf("2026-10-17", food(1500)),
    logOf("2026-10-18", drink),
    logOf("2026-10-19", food(1500)),
  );
  expect(streakOf(["2026-10-17", "2026-10-18", "2026-10-19"], days, TODAY, CEILING)).toBe(1);
});

it("#1012 A2 today with drinks only is skipped, so it neither grows nor ends the food streak", () => {
  const days = byDate(
    logOf("2026-10-18", food(1500)),
    logOf("2026-10-19", food(1500)),
    logOf(TODAY, drink),
  );
  expect(streakOf(["2026-10-18", "2026-10-19", TODAY], days, TODAY, CEILING)).toBe(2);
});

it("#1012 I1 with a kcal floor, today with drinks only is skipped instead of dropping the food streak to zero", () => {
  const days = byDate(
    logOf("2026-10-18", food(2000)),
    logOf("2026-10-19", food(1900)),
    logOf(TODAY, drink),
  );
  expect(streakOf(["2026-10-18", "2026-10-19", TODAY], days, TODAY, FLOOR)).toBe(2);
});

it("#1012 I2 with no kcal goal, a past day with drinks only ends the food streak and today with drinks only is skipped", () => {
  // Both days have food, so with no goal the run counts both.
  const fed = byDate(logOf("2026-10-18", food(1500)), logOf("2026-10-19", food(2600)));
  expect(streakOf(["2026-10-18", "2026-10-19"], fed, TODAY, undefined)).toBe(2);

  // The 19th has drinks only, so it ends the run and the 18th does not count.
  const drinksOnLast = byDate(logOf("2026-10-18", food(1500)), logOf("2026-10-19", drink));
  expect(streakOf(["2026-10-18", "2026-10-19"], drinksOnLast, TODAY, undefined)).toBe(0);

  // Today has drinks only and is skipped, so the 19th and 18th count.
  const drinksToday = byDate(
    logOf("2026-10-18", food(1500)),
    logOf("2026-10-19", food(2600)),
    logOf(TODAY, drink),
  );
  expect(streakOf(["2026-10-18", "2026-10-19", TODAY], drinksToday, TODAY, undefined)).toBe(2);
});

it("#1012 I3 a past day with only a line of your own, such as weight, ends the food streak as a day of drinks only does", () => {
  const days = byDate(logOf("2026-10-18", food(1500)), logOf("2026-10-19", mine));
  expect(streakOf(["2026-10-18", "2026-10-19"], days, TODAY, CEILING)).toBe(0);
});
