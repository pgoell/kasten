import { formatTodo, parseTodo, type Todo } from "@/lib/todo/todo";
import { formatRecurrence, nextDate, nextOccurrence, parseRecurrence } from "@/lib/todo/todo-recur";

/** The day every test below is written against, so no assertion expires. */
const TODAY = "2026-08-10";

function todo(line: string): Todo {
  const found = parseTodo(line);
  if (found === null) throw new Error(`not a todo: ${line}`);
  return found;
}

/** The fresh copy as the line it would be written as. Null stays null. */
function copy(line: string, today = TODAY): string | null {
  const fresh = nextOccurrence(todo(line), today);
  return fresh === null ? null : formatTodo(fresh);
}

describe("parseRecurrence", () => {
  it("reads the four units, with and without a number", () => {
    expect(parseRecurrence("every day")).toEqual({ every: 1, unit: "day", whenDone: false });
    expect(parseRecurrence("every week")).toEqual({ every: 1, unit: "week", whenDone: false });
    expect(parseRecurrence("every month")).toEqual({ every: 1, unit: "month", whenDone: false });
    expect(parseRecurrence("every year")).toEqual({ every: 1, unit: "year", whenDone: false });
    expect(parseRecurrence("every 3 days")).toEqual({ every: 3, unit: "day", whenDone: false });
    expect(parseRecurrence("every 2 weeks")).toEqual({ every: 2, unit: "week", whenDone: false });
  });

  it("reads the when done suffix", () => {
    expect(parseRecurrence("every month when done")).toEqual({
      every: 1,
      unit: "month",
      whenDone: true,
    });
  });

  it("answers null on anything it does not know", () => {
    expect(parseRecurrence("every fortnight")).toBeNull();
    expect(parseRecurrence("weekly")).toBeNull();
    expect(parseRecurrence("")).toBeNull();
  });
});

/** The rule as text, read and written back, so a test reads as the line does. */
function next(date: string, rule: string): string | null {
  const parsed = parseRecurrence(rule);
  if (parsed === null) throw new Error(`not a rule: ${rule}`);
  return nextDate(date, parsed);
}

describe("parseRecurrence, on rules naming their days", () => {
  it("reads every weekday as Monday to Friday", () => {
    expect(parseRecurrence("every weekday")).toEqual({
      every: 1,
      unit: "week",
      whenDone: false,
      on: { kind: "weekdays", days: [1, 2, 3, 4, 5] },
    });
  });

  it("reads the days of a week rule, in week order whatever order they were typed in", () => {
    expect(parseRecurrence("every week on Thursday, Monday")?.on).toEqual({
      kind: "weekdays",
      days: [1, 4],
    });
    expect(parseRecurrence("every 2 weeks on Friday")).toEqual({
      every: 2,
      unit: "week",
      whenDone: false,
      on: { kind: "weekdays", days: [5] },
    });
    // Sunday closes the week rather than opening it.
    expect(parseRecurrence("every week on Sunday, Saturday")?.on).toEqual({
      kind: "weekdays",
      days: [6, 0],
    });
  });

  it("reads a bare weekday as every week on it", () => {
    expect(parseRecurrence("every Sunday")).toEqual(parseRecurrence("every week on Sunday"));
  });

  it("reads a day of the month, and the last one", () => {
    expect(parseRecurrence("every month on the 15th")?.on).toEqual({ kind: "day", day: 15 });
    expect(parseRecurrence("every 3 months on the 1st")?.on).toEqual({ kind: "day", day: 1 });
    expect(parseRecurrence("every month on the last")?.on).toEqual({ kind: "day", day: -1 });
  });

  it("reads a weekday of the month", () => {
    expect(parseRecurrence("every month on the last Friday")?.on).toEqual({
      kind: "nth",
      nth: -1,
      weekday: 5,
    });
    expect(parseRecurrence("every 6 months on the 2nd Wednesday")?.on).toEqual({
      kind: "nth",
      nth: 2,
      weekday: 3,
    });
  });

  it("reads without regard to case, short names or spare spaces, and keeps when done", () => {
    expect(parseRecurrence("Every  week on mon,thu when done")).toEqual({
      every: 1,
      unit: "week",
      whenDone: true,
      on: { kind: "weekdays", days: [1, 4] },
    });
  });

  it("answers null on a rule it does not read", () => {
    expect(parseRecurrence("every week on the 15th")).toBeNull();
    expect(parseRecurrence("every month on Friday")).toBeNull();
    expect(parseRecurrence("every month on the 32nd")).toBeNull();
    expect(parseRecurrence("every month on the 5th Friday")).toBeNull();
    expect(parseRecurrence("every month on the 2nd last Friday")).toBeNull();
    expect(parseRecurrence("every day on Monday")).toBeNull();
    expect(parseRecurrence("every January on the 15th")).toBeNull();
    expect(parseRecurrence("every week on Monday, someday")).toBeNull();
    expect(parseRecurrence("every 0 days")).toBeNull();
  });
});

describe("formatRecurrence", () => {
  it("writes a rule back the way obsidian-tasks spells it", () => {
    const spelled = (text: string) => {
      const rule = parseRecurrence(text);
      return rule === null ? null : formatRecurrence(rule);
    };

    expect(spelled("every 3 days")).toBe("every 3 days");
    expect(spelled("every week when done")).toBe("every week when done");
    expect(spelled("every week on mon, tue, wed, thu, fri")).toBe("every weekday");
    expect(spelled("every 2 weeks on thu,mon")).toBe("every 2 weeks on Monday, Thursday");
    expect(spelled("every sunday")).toBe("every week on Sunday");
    expect(spelled("every month on the 22nd")).toBe("every month on the 22nd");
    expect(spelled("every month on the 11th")).toBe("every month on the 11th");
    expect(spelled("every month on the last")).toBe("every month on the last");
    expect(spelled("every 2 months on the 3rd tue when done")).toBe(
      "every 2 months on the 3rd Tuesday when done",
    );
  });
});

describe("nextDate, on rules naming their days", () => {
  // 2026-08-10 is a Monday.
  it("lands on the next named weekday, and never on the day it counts from", () => {
    expect(next("2026-08-10", "every week on Monday")).toBe("2026-08-17");
    expect(next("2026-08-10", "every week on Monday, Thursday")).toBe("2026-08-13");
    expect(next("2026-08-13", "every week on Monday, Thursday")).toBe("2026-08-17");
    expect(next("2026-08-12", "every week on Sunday")).toBe("2026-08-16");
  });

  it("skips the weekend on every weekday", () => {
    expect(next("2026-08-13", "every weekday")).toBe("2026-08-14");
    expect(next("2026-08-14", "every weekday")).toBe("2026-08-17");
    expect(next("2026-08-15", "every weekday")).toBe("2026-08-17");
  });

  it("counts the weeks of a longer rule from the week it starts in", () => {
    // A Wednesday: the Friday of that week still counts.
    expect(next("2026-08-12", "every 2 weeks on Friday")).toBe("2026-08-14");
    expect(next("2026-08-14", "every 2 weeks on Friday")).toBe("2026-08-28");
    // A Sunday is the last day of its week, so the week after is skipped.
    expect(next("2026-08-16", "every 2 weeks on Friday")).toBe("2026-08-28");
  });

  it("lands on the named day of the month", () => {
    expect(next("2026-08-10", "every month on the 15th")).toBe("2026-08-15");
    expect(next("2026-08-15", "every month on the 15th")).toBe("2026-09-15");
    expect(next("2026-12-15", "every month on the 15th")).toBe("2027-01-15");
    expect(next("2026-08-15", "every 3 months on the 15th")).toBe("2026-11-15");
  });

  it("passes over a month that lacks the day, as obsidian-tasks does", () => {
    expect(next("2026-01-31", "every month on the 31st")).toBe("2026-03-31");
  });

  it("lands on the last day of each month, whatever its length", () => {
    expect(next("2026-01-31", "every month on the last")).toBe("2026-02-28");
    expect(next("2026-02-28", "every month on the last")).toBe("2026-03-31");
  });

  it("lands on a weekday of the month", () => {
    expect(next("2026-08-10", "every month on the last Friday")).toBe("2026-08-28");
    expect(next("2026-08-28", "every month on the last Friday")).toBe("2026-09-25");
    expect(next("2026-08-10", "every month on the 2nd Tuesday")).toBe("2026-08-11");
    expect(next("2026-08-11", "every month on the 2nd Tuesday")).toBe("2026-09-08");
    expect(next("2026-08-01", "every month on the 1st Saturday")).toBe("2026-09-05");
  });

  it("answers null for a day its months never have", () => {
    expect(next("2026-02-10", "every 12 months on the 30th")).toBeNull();
  });
});

describe("nextDate", () => {
  it("counts whole days and weeks on", () => {
    expect(nextDate("2026-08-10", { every: 1, unit: "week", whenDone: false })).toBe("2026-08-17");
    expect(nextDate("2026-08-10", { every: 3, unit: "day", whenDone: false })).toBe("2026-08-13");
  });

  it("clamps to the last day of the month the day does not reach", () => {
    expect(nextDate("2026-01-31", { every: 1, unit: "month", whenDone: false })).toBe("2026-02-28");
    expect(nextDate("2024-02-29", { every: 1, unit: "year", whenDone: false })).toBe("2025-02-28");
  });

  it("carries a month rule over the turn of the year", () => {
    expect(nextDate("2026-12-15", { every: 1, unit: "month", whenDone: false })).toBe("2027-01-15");
  });
});

describe("nextOccurrence", () => {
  it("writes the copy one period on, open and with nothing the last one earned", () => {
    expect(
      copy("- [/] water the plants 🔁 every week 📅 2026-08-10 ✅ 2026-08-10 🆔 kt-000001"),
    ).toBe("- [ ] water the plants 📅 2026-08-17 🔁 every week");
  });

  it("moves every date it carries by the same number of days", () => {
    // The gaps between the dates are what the person set up, so they survive.
    expect(copy("- [/] a 🔁 every week 📅 2026-08-14 ⏳ 2026-08-12")).toBe(
      "- [ ] a 📅 2026-08-21 ⏳ 2026-08-19 🔁 every week",
    );
  });

  it("counts when done from the day it was ticked", () => {
    expect(copy("- [/] a 🔁 every week when done 📅 2026-08-01")).toBe(
      "- [ ] a 📅 2026-08-17 🔁 every week when done",
    );
  });

  it("keeps the created date, that being the recurrence's own birthday", () => {
    expect(copy("- [/] a 🔁 every day 📅 2026-08-10 ➕ 2026-01-01")).toContain("➕ 2026-01-01");
  });

  it("counts a rule naming its days off the date the todo carried", () => {
    expect(copy("- [/] a 🔁 every week on Monday, Thursday 📅 2026-08-10 ⏳ 2026-08-09")).toBe(
      "- [ ] a 📅 2026-08-13 ⏳ 2026-08-12 🔁 every week on Monday, Thursday",
    );
    expect(copy("- [/] a 🔁 every month on the 15th 📅 2026-07-15")).toBe(
      "- [ ] a 📅 2026-08-15 🔁 every month on the 15th",
    );
  });

  it("counts a rule naming its days off today when it says when done", () => {
    expect(copy("- [/] a 🔁 every weekday when done 📅 2026-08-01", "2026-08-14")).toBe(
      "- [ ] a 📅 2026-08-17 🔁 every weekday when done",
    );
  });

  it("writes no copy for a rule that never lands again", () => {
    expect(copy("- [/] a 🔁 every 12 months on the 30th 📅 2026-02-10")).toBeNull();
  });

  it("answers null for a recurring todo carrying no date to count from", () => {
    expect(copy("- [/] a 🔁 every week")).toBeNull();
  });

  it("answers null for a todo that does not recur", () => {
    expect(copy("- [/] a 📅 2026-08-10")).toBeNull();
  });
});
