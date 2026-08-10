import { formatTodo, parseTodo, type Todo } from "@/lib/todo";
import { nextDate, nextOccurrence, parseRecurrence } from "@/lib/todo-recur";

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

  it("answers null for a recurring todo carrying no date to count from", () => {
    expect(copy("- [/] a 🔁 every week")).toBeNull();
  });

  it("answers null for a todo that does not recur", () => {
    expect(copy("- [/] a 📅 2026-08-10")).toBeNull();
  });
});
