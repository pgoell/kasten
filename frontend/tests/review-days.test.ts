import { daysBetween, dayWords, intervalWords } from "@/lib/review/review-days";

// 2026-10-24 is a Saturday, the day every case below is counted from.
const TODAY = "2026-10-24";

describe("daysBetween", () => {
  it("counts whole days across a daylight saving change", () => {
    // Clocks went forward on 2026-03-29 and back on 2026-10-25: each week is still seven days.
    expect(daysBetween("2026-03-27", "2026-03-30")).toBe(3);
    expect(daysBetween("2026-10-22", "2026-10-25")).toBe(3);
    expect(daysBetween("2026-10-18", "2026-10-25")).toBe(7);
  });

  it("is negative when the second day is the earlier", () => {
    expect(daysBetween(TODAY, "2026-10-20")).toBe(-4);
    expect(daysBetween("2026-12-31", "2027-01-01")).toBe(1);
  });
});

describe("dayWords", () => {
  it("says today for today and for anything overdue, tomorrow for the day after", () => {
    expect(dayWords("2026-10-24", TODAY)).toBe("today");
    expect(dayWords("2026-10-20", TODAY)).toBe("today");
    expect(dayWords("2026-10-25", TODAY)).toBe("tomorrow");
  });

  it("names the weekday from two days to six", () => {
    expect(dayWords("2026-10-26", TODAY)).toBe("Monday");
    expect(dayWords("2026-10-30", TODAY)).toBe("Friday");
  });

  it("says next and the weekday from seven days to thirteen", () => {
    expect(dayWords("2026-10-31", TODAY)).toBe("next Saturday");
    expect(dayWords("2026-11-06", TODAY)).toBe("next Friday");
  });

  it("gives the day and month from fourteen days, with the year only when it is not this one", () => {
    expect(dayWords("2026-11-07", TODAY)).toBe("7 Nov");
    expect(dayWords("2026-11-12", TODAY)).toBe("12 Nov");
    expect(dayWords("2027-11-12", TODAY)).toBe("12 Nov 2027");
  });

  it("reads across a change of year", () => {
    // 2027-01-04 is a Monday, a week after the 28th of December.
    expect(dayWords("2027-01-04", "2026-12-28")).toBe("next Monday");
    expect(dayWords("2027-01-20", "2026-12-28")).toBe("20 Jan 2027");
  });
});

describe("intervalWords", () => {
  it("switches unit at fourteen days, sixty days and a year", () => {
    expect(intervalWords(1)).toBe("1d");
    expect(intervalWords(4)).toBe("4d");
    expect(intervalWords(13)).toBe("13d");
    expect(intervalWords(14)).toBe("2w");
    expect(intervalWords(21)).toBe("3w");
    expect(intervalWords(59)).toBe("8w");
    expect(intervalWords(60)).toBe("2mo");
    expect(intervalWords(364)).toBe("12mo");
    expect(intervalWords(365)).toBe("1.0y");
    expect(intervalWords(512)).toBe("1.4y");
  });
});
