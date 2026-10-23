import {
  lastWeeks,
  linesPerWeek,
  parseWeek,
  weekNumber,
  weekOf,
  weekRange,
} from "@/lib/search-weeks";

// Dates in the tests are read as calendar days, so the expected weeks hold on a
// machine in any time zone.

describe("weekOf", () => {
  it("reads a Sunday as the week it ends", () => {
    // 2026-09-20 is a Sunday, the last day of the week running from the 14th.
    expect(weekOf("2026-09-20")).toBe("2026-W38");
  });

  it("reads a Monday as the first day of the week after", () => {
    expect(weekOf("2026-09-21")).toBe("2026-W39");
  });

  it("reads 2027-01-01 as the 53rd week of the year before", () => {
    expect(weekOf("2027-01-01")).toBe("2026-W53");
  });

  it("answers nothing for a string that is not a real day", () => {
    expect(weekOf("2026-02-30")).toBeUndefined();
    expect(weekOf("yesterday")).toBeUndefined();
  });
});

describe("lastWeeks", () => {
  it("counts fourteen weeks, oldest first, ending on the week of now", () => {
    // 2026-10-23 is a Friday in week 43.
    const weeks = lastWeeks(new Date(2026, 9, 23));

    expect(weeks).toHaveLength(14);
    expect(weeks[0]).toBe("2026-W30");
    expect(weeks[13]).toBe("2026-W43");
  });

  it("counts back across a year boundary", () => {
    // 2027-01-06 is in week 1 of 2027, with week 53 of 2026 before it.
    expect(lastWeeks(new Date(2027, 0, 6), 3)).toEqual(["2026-W52", "2026-W53", "2027-W01"]);
  });
});

describe("weekNumber", () => {
  it("reads the number off the end of a week's name", () => {
    expect(weekNumber("2026-W38")).toBe(38);
  });
});

describe("parseWeek", () => {
  it("accepts a week that exists", () => {
    expect(parseWeek("2026-W38")).toBe("2026-W38");
  });

  it("rejects a value that is not a week name", () => {
    expect(parseWeek("2026-W3")).toBeUndefined();
    expect(parseWeek("2026-38")).toBeUndefined();
    expect(parseWeek("2026-W00")).toBeUndefined();
    expect(parseWeek("2026-W54")).toBeUndefined();
    expect(parseWeek(38)).toBeUndefined();
  });

  it("accepts a 53rd week only in a year that has one", () => {
    // 2026 is a long year; 2025 stops at week 52.
    expect(parseWeek("2026-W53")).toBe("2026-W53");
    expect(parseWeek("2025-W53")).toBeUndefined();
  });
});

describe("weekRange", () => {
  it("gives the days of a week inside one month", () => {
    expect(weekRange("2026-W38")).toBe("14 to 20 September 2026");
  });

  it("gives the days of a week that crosses a month", () => {
    expect(weekRange("2026-W40")).toBe("28 September to 4 October 2026");
  });

  it("gives the days of a week that crosses a year", () => {
    expect(weekRange("2026-W53")).toBe("28 December 2026 to 3 January 2027");
  });
});

describe("linesPerWeek", () => {
  it("counts each date in its week, and an empty week as zero", () => {
    expect(linesPerWeek(["2026-09-14", "2026-09-20"], ["2026-W38", "2026-W39"])).toEqual([2, 0]);
  });

  it("counts a date outside the weeks in none of them", () => {
    expect(linesPerWeek(["2026-08-01"], ["2026-W38", "2026-W39"])).toEqual([0, 0]);
  });

  it("counts a missing date in none of them", () => {
    expect(linesPerWeek([null, undefined], ["2026-W38"])).toEqual([0]);
  });
});
