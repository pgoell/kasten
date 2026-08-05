import { readClock } from "@/lib/clock";

// Built from local parts rather than parsed from a string, because a bare ISO
// date parses as UTC and the strip reports the wall clock.

describe("readClock", () => {
  it("reads the weekday, the date and the time", () => {
    expect(readClock(new Date(2026, 7, 5, 15, 52))).toMatchObject({
      weekday: "Wednesday",
      date: "2026-08-05",
      time: "15:52",
    });
  });

  it("pads a single digit hour and minute", () => {
    expect(readClock(new Date(2026, 7, 5, 9, 5)).time).toBe("09:05");
  });

  it("counts the ISO week", () => {
    expect(readClock(new Date(2026, 7, 5)).week).toBe(32);
  });

  it("puts the start of January in the week holding its Thursday", () => {
    // 2026-01-01 is itself a Thursday, so it opens week 1.
    expect(readClock(new Date(2026, 0, 1)).week).toBe(1);
  });

  it("counts a late December date into the next year's first week", () => {
    // 2025-12-29 is a Monday whose Thursday lands in 2026, so it is week 1
    // while still being December. Counting from January 1 would say 52.
    expect(readClock(new Date(2025, 11, 29)).week).toBe(1);
  });

  it("counts an early January date into the last year's final week", () => {
    // 2027-01-03 is a Sunday whose Thursday fell back in 2026.
    expect(readClock(new Date(2027, 0, 3)).week).toBe(53);
  });

  it("gives a long year its 53rd week", () => {
    expect(readClock(new Date(2026, 11, 31)).week).toBe(53);
  });
});
