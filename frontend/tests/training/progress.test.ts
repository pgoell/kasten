// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { TrainingDay } from "@/lib/log/training/exercises";
import {
  bestsOf,
  cardioWeeks,
  changeOf,
  deloadWeeks,
  fiveK,
  liftWeeks,
  mainLifts,
  mondayOf,
  paceWords,
  recordsOf,
  sessionsIn,
  volumeWeeks,
  weekStarts,
  weekStreak,
  weekTally,
} from "@/lib/log/training/progress";
import { parseTrainingLine } from "@/lib/log/training/training-lines";

/** The progress the training pane reads (#1718), over days written as their lines. */

function day(date: string, ...lines: string[]): TrainingDay {
  return {
    date,
    entries: lines.map((line) => {
      const entry = parseTrainingLine(line);
      if (entry === null) throw new Error(`no entry: ${line}`);
      return entry;
    }),
  };
}

// Mondays: 2026-10-19, 10-26, 11-02, 11-09. Today is Wednesday 2026-11-11.
const TODAY = "2026-11-11";
const DAYS = [
  day("2026-10-20", "- 🏋 [[Kniebeuge]] 80 kg 8 8 8", "- 🏋 [[Bankdrücken]] 60 kg 8 8"),
  day("2026-10-22", "- 🚶 [[Gehen]] 40 min", "- 🏃 [[Joggen]] 30 min 5 km"),
  day("2026-10-27", "- 🏋 [[Kniebeuge]] 82.5 kg 8 8 7", "- 🚲 [[Radfahren]] 60 min 20 km"),
  day("2026-11-03", "- 🏋 [[Kniebeuge]] 60 kg 5 5"),
  day("2026-11-09", "- 🏋 [[Kniebeuge]] 85 kg 8 6", "- 🏃 [[Joggen]] 27 min 5 km"),
  day("2026-11-10", "- 📏 [[Knie-zur-Wand]] L 11 cm R 10 cm"),
];

describe("weeks", () => {
  it("runs Monday to Sunday", () => {
    expect(mondayOf(TODAY)).toBe("2026-11-09");
    expect(mondayOf("2026-11-08")).toBe("2026-11-02");
    expect(weekStarts(TODAY, 4)).toEqual(["2026-10-19", "2026-10-26", "2026-11-02", "2026-11-09"]);
  });
});

describe("lifts", () => {
  const starts = weekStarts(TODAY, 4);

  it("ranks the lifts by days trained and takes the best e1RM a week", () => {
    expect(mainLifts(DAYS)).toEqual(["Kniebeuge", "Bankdrücken"]);
    const weeks = liftWeeks(DAYS, "Kniebeuge", starts);
    expect(weeks[0]).toBeCloseTo(101.3, 1);
    expect(weeks[3]).toBeCloseTo(107.7, 1);
    expect(changeOf(weeks)).toBeCloseTo(6.4, 1);
    expect(changeOf([null, 80, null])).toBeNull();
  });

  it("shades a week whose volume falls under 60 % of the weeks before", () => {
    const volumes = volumeWeeks(DAYS, starts, "Kniebeuge");
    expect(volumes).toEqual([1920, 1897.5, 600, 1190]);
    expect(deloadWeeks(volumes)).toEqual([false, false, true, false]);
  });

  it("counts records against the days before, one per weight and day", () => {
    expect(recordsOf(DAYS)).toEqual([
      { date: "2026-10-27", exercise: "Kniebeuge", kind: "heaviest", kg: 82.5, amount: 0 },
      { date: "2026-11-09", exercise: "Kniebeuge", kind: "heaviest", kg: 85, amount: 0 },
    ]);
    const more = [...DAYS, day("2026-11-11", "- 🏋 [[Kniebeuge]] 85 kg 9 9 9")];
    expect(recordsOf(more).slice(2)).toEqual([
      { date: "2026-11-11", exercise: "Kniebeuge", kind: "reps", kg: 85, amount: 9 },
      { date: "2026-11-11", exercise: "Kniebeuge", kind: "volume", kg: 0, amount: 2295 },
    ]);
    expect(bestsOf(more, "Kniebeuge")).toEqual({
      heaviest: 85,
      reps: { kg: 85, reps: 9 },
      volume: 2295,
    });
  });
});

describe("cardio and sessions", () => {
  it("adds the minutes of each kind per week", () => {
    expect(cardioWeeks(DAYS, weekStarts(TODAY, 4))).toEqual([
      { walk: 40, ride: 0, run: 30 },
      { walk: 0, ride: 60, run: 0 },
      { walk: 0, ride: 0, run: 0 },
      { walk: 0, ride: 0, run: 27 },
    ]);
  });

  it("counts sessions without a test day, and weeks in a row", () => {
    expect(sessionsIn(DAYS, "2026-10-19", TODAY)).toBe(5);
    expect(weekStreak(DAYS, TODAY)).toBe(4);
    expect(weekStreak(DAYS, "2026-11-23")).toBe(0);
  });

  it("reads 5 km pace off runs of 5 km or more", () => {
    expect(fiveK(DAYS)).toEqual({ best: 5.4, latest: 5.4, date: "2026-11-09" });
    expect(paceWords(5.4)).toBe("5:24 /km");
    expect(fiveK([day("2026-11-01", "- 🏃 [[Joggen]] 20 min 3 km")])).toBeNull();
  });

  it("sums a week for the review", () => {
    expect(weekTally(DAYS, "2026-11-09")).toEqual({
      sessions: 1,
      sets: 2,
      minutes: 27,
      records: [{ date: "2026-11-09", exercise: "Kniebeuge", kind: "heaviest", kg: 85, amount: 0 }],
    });
  });
});
