import type { TodoHit } from "@/lib/api";
import type { LogDay } from "@/lib/food-api";
import { DEFAULT_CONFIG, type LogConfig } from "@/lib/log-kinds";
import {
  carriedOver,
  doneIn,
  kcalPerDay,
  sessionMinutes,
  todosPerDay,
  weekTiles,
} from "@/lib/review-week";

// The week of 2026-10-19 (a Monday) to 2026-10-25 (a Sunday).
const FROM = "2026-10-19";
const TO = "2026-10-25";

const CONFIG: LogConfig = {
  kinds: [{ mark: "⚖", name: "weight", unit: "kg", last: true }],
  food: { kcal: { type: "ceiling", value: 2000 } },
  broken: [],
};

function todo(text: string): TodoHit {
  return { path: "02 Projects/tasks.md", line: 1, text, project: null, shared: false };
}

/** A log day with `entries` lines, its kcal and its weigh-in when given. */
function day(
  date: string,
  { entries = 1, kcal = 0, weight }: { entries?: number; kcal?: number; weight?: number },
): LogDay {
  return {
    date,
    path: `01 Periodic/00 Daily/${date}.md`,
    entries: Array.from({ length: entries }, () => ({})),
    totals: {
      food: { kcal },
      mine: weight === undefined ? [] : [{ mark: "⚖", name: "weight", unit: "kg", total: weight }],
    },
  } as unknown as LogDay;
}

/** Seven daily notes, the first holding `first` and the rest left empty. */
function notesWith(first: string): string[] {
  return [first, "", "", "", "", "", ""];
}

describe("the week's session minutes", () => {
  it("#807 A5 sessionMinutes adds up the closed sessions under Time", () => {
    const text = "# 2026-10-19 Monday\n\n## Time\n- 09:00-10:30 wire\n- 14:00-14:45 call\n";

    expect(sessionMinutes(text)).toBe(135);
  });

  it("#807 A5 sessionMinutes counts nothing for a running session", () => {
    const text = "## Time\n- 09:00-10:00 wire\n- 14:03-      call\n";

    expect(sessionMinutes(text)).toBe(60);
  });

  it("#807 A5 sessionMinutes counts nothing outside Time", () => {
    const text = "## Done\n- 09:00-10:00 wire\n## Time\n- 11:00-11:30 call\n";

    expect(sessionMinutes(text)).toBe(30);
  });

  it("#807 A5 sessionMinutes counts nothing for an end before its start", () => {
    expect(sessionMinutes("## Time\n- 10:00-09:00 wire\n")).toBe(0);
  });
});

describe("the week's tiles", () => {
  it("#807 A5 weekTiles adds up the week's tiles", () => {
    const tiles = weekTiles({
      todos: [todo("- [x] wire ✅ 2026-10-20"), todo("- [x] late ✅ 2026-10-26")],
      days: [
        // Before the week, so only the weight change reads it.
        day("2026-10-12", { weight: 82 }),
        day("2026-10-19", { entries: 2, kcal: 1800 }),
        day("2026-10-21", { kcal: 2400, weight: 81 }),
        day("2026-10-24", { kcal: 1900, weight: 80.4 }),
        // After the week, so nothing reads it.
        day("2026-10-26", { kcal: 900, weight: 79 }),
      ],
      config: CONFIG,
      notes: notesWith("## Time\n- 09:00-10:30 wire\n"),
      from: FROM,
      to: TO,
    });

    expect(tiles).toEqual({
      todosDone: 1,
      minutes: 90,
      withinKcal: 2,
      loggedDays: 3,
      weightChange: -1.6,
    });
  });

  it("#807 A5 weekTiles weight change is null with one weigh-in", () => {
    const tiles = weekTiles({
      todos: [],
      days: [day("2026-10-21", { weight: 81 })],
      config: CONFIG,
      notes: notesWith(""),
      from: FROM,
      to: TO,
    });

    expect(tiles.weightChange).toBeNull();
  });

  it("#807 A5 weekTiles has no kcal count with no kcal goal", () => {
    const tiles = weekTiles({
      todos: [],
      days: [day("2026-10-21", { kcal: 2400 })],
      config: { ...CONFIG, food: {} },
      notes: notesWith(""),
      from: FROM,
      to: TO,
    });

    expect(tiles.withinKcal).toBeNull();
  });

  it("#807 I1 the empty week gives zeros and nulls, never NaN", () => {
    const tiles = weekTiles({
      todos: [],
      days: [],
      config: DEFAULT_CONFIG,
      notes: notesWith(""),
      from: FROM,
      to: TO,
    });

    expect(tiles).toEqual({
      todosDone: 0,
      minutes: 0,
      withinKcal: null,
      loggedDays: 0,
      weightChange: null,
    });
    expect(todosPerDay([], [FROM])).toEqual([{ index: 0, amount: 0 }]);
    expect(carriedOver([], FROM, TO, "2026-10-22")).toEqual([]);
  });
});

describe("the week's charts and lists", () => {
  it("#807 A5 kcalPerDay leaves out a day with no log", () => {
    const bars = kcalPerDay(
      [
        day("2026-10-19", { kcal: 1500 }),
        day("2026-10-20", { entries: 0 }),
        day("2026-10-21", { kcal: 2000 }),
      ],
      CONFIG,
      ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22"],
    );

    expect(bars).toEqual([
      { index: 0, amount: 1500 },
      { index: 2, amount: 2000 },
    ]);
  });

  it("#807 A5 doneIn lists the week's done todos oldest first", () => {
    const done = doneIn(
      [
        todo("- [x] later ✅ 2026-10-22"),
        todo("- [x] first ✅ 2026-10-20"),
        todo("- [x] next week ✅ 2026-10-26"),
      ],
      FROM,
      TO,
    );

    expect(done.map((hit) => hit.text)).toEqual([
      "- [x] first ✅ 2026-10-20",
      "- [x] later ✅ 2026-10-22",
    ]);
  });

  it("#807 A5 carriedOver lists open todos dated in the window, earliest first", () => {
    // Today is the 22nd, so the window ends on the 21st: a todo dated today or later is not carried over yet.
    const carried = carriedOver(
      [
        todo("- [ ] late 📅 2026-10-20"),
        todo("- [ ] sched ⏳ 2026-10-19"),
        todo("- [ ] today 📅 2026-10-22"),
        todo("- [x] done 📅 2026-10-20 ✅ 2026-10-20"),
        todo("- [ ] both 📅 2026-10-23 ⏳ 2026-10-21"),
        todo("- [ ] old 📅 2026-10-01"),
      ],
      FROM,
      TO,
      "2026-10-22",
    );

    expect(carried.map((hit) => hit.text)).toEqual([
      "- [ ] sched ⏳ 2026-10-19",
      "- [ ] late 📅 2026-10-20",
      "- [ ] both 📅 2026-10-23 ⏳ 2026-10-21",
    ]);
  });
});
