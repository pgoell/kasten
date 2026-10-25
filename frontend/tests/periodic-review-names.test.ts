import { periodicNote, weeklyWeek, yearlyYear } from "@/lib/periodic";

const YEARLY = "01 Periodic/04 Yearly";
const WEEKLY = "01 Periodic/01 Weekly";

describe("yearlyYear", () => {
  it("#807 I3 reads the year off a yearly note's name", () => {
    expect(yearlyYear(`${YEARLY}/2026.md`)).toBe(2026);
    expect(yearlyYear(periodicNote("yearly", new Date(2026, 7, 6)).path)).toBe(2026);
  });

  it("#807 I3 answers nothing for any other note", () => {
    expect(yearlyYear(`${YEARLY}/index.md`)).toBeNull();
    expect(yearlyYear(`${YEARLY}/2026 notes.md`)).toBeNull();
    expect(yearlyYear(`${YEARLY}/2026-Q1.md`)).toBeNull();
    expect(yearlyYear("01 Periodic/00 Daily/2026.md")).toBeNull();
    expect(yearlyYear("projects/2026.md")).toBeNull();
  });
});

describe("weeklyWeek", () => {
  it("#807 I4 gives the Monday and Sunday of an ISO week", () => {
    expect(weeklyWeek(`${WEEKLY}/2026-W43.md`)).toEqual({
      year: 2026,
      week: 43,
      monday: "2026-10-19",
      sunday: "2026-10-25",
    });
  });

  it("#807 I4 counts week 1 across New Year, from the Monday before", () => {
    // 2026-01-01 is a Thursday, so week 1 of 2026 starts on the Monday before it.
    expect(weeklyWeek(`${WEEKLY}/2026-W01.md`)).toEqual({
      year: 2026,
      week: 1,
      monday: "2025-12-29",
      sunday: "2026-01-04",
    });
  });

  it("#807 I4 has a 53rd week only in a year that has one", () => {
    // 2026 and 2020 are long years; 2025 stops at week 52.
    expect(weeklyWeek(`${WEEKLY}/2026-W53.md`)).toEqual({
      year: 2026,
      week: 53,
      monday: "2026-12-28",
      sunday: "2027-01-03",
    });
    expect(weeklyWeek(`${WEEKLY}/2020-W53.md`)?.sunday).toBe("2021-01-03");
    expect(weeklyWeek(`${WEEKLY}/2025-W53.md`)).toBeNull();
  });

  it("#807 I4 answers nothing for week 0, a note that is not a week, or another folder", () => {
    expect(weeklyWeek(`${WEEKLY}/2026-W00.md`)).toBeNull();
    expect(weeklyWeek(`${WEEKLY}/2026-W43 notes.md`)).toBeNull();
    expect(weeklyWeek(`${WEEKLY}/index.md`)).toBeNull();
    expect(weeklyWeek("01 Periodic/00 Daily/2026-W43.md")).toBeNull();
  });
});
