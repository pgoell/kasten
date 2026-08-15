import { dailyDate, periodicNote } from "@/lib/periodic";

// Built from local parts rather than parsed from a string, because a bare ISO
// date parses as UTC and a note is named for the day the reader is having.

const DAILY = "01 Periodic/00 Daily";
const WEEKLY = "01 Periodic/01 Weekly";
const MONTHLY = "01 Periodic/02 Monthly";
const QUARTERLY = "01 Periodic/03 Quarterly";
const YEARLY = "01 Periodic/04 Yearly";

/** The line of links, which every periodic note carries under its heading. */
function nav(body: string): string {
  return body.split("\n").find((line) => line.startsWith("[[")) ?? "";
}

/** The heading, which is the first line under the frontmatter block. */
function heading(body: string): string {
  return body.split("\n").find((line) => line.startsWith("# ")) ?? "";
}

describe("the daily note", () => {
  // 2026-08-06 is a Thursday in ISO week 32.
  const made = periodicNote("daily", new Date(2026, 7, 6));

  it("is named for the day", () => {
    expect(made.path).toBe(`${DAILY}/2026-08-06.md`);
  });

  it("opens with the block that says what it is", () => {
    expect(made.body.startsWith("---\ntype: Periodic Note\n---\n\n")).toBe(true);
  });

  it("heads the note with the date and the weekday", () => {
    expect(heading(made.body)).toBe("# 2026-08-06 Thursday");
  });

  it("links back a day, up to the week, and on a day", () => {
    expect(nav(made.body)).toBe(
      `[[${DAILY}/2026-08-05]] | [[${WEEKLY}/2026-W32]] | [[${DAILY}/2026-08-07]]`,
    );
  });

  it("steps over the end of a month", () => {
    expect(nav(periodicNote("daily", new Date(2026, 7, 31)).body)).toContain(
      `[[${DAILY}/2026-09-01]]`,
    );
    expect(nav(periodicNote("daily", new Date(2026, 7, 1)).body)).toContain(
      `[[${DAILY}/2026-07-31]]`,
    );
  });

  it("steps over the end of a year", () => {
    expect(nav(periodicNote("daily", new Date(2026, 11, 31)).body)).toContain(
      `[[${DAILY}/2027-01-01]]`,
    );
  });

  it("ends with the section the add prompt writes into", () => {
    expect(made.body).toMatch(/\n\n## TODOs\n$/);
  });
});

describe("dailyDate", () => {
  it("answers with the day a daily note is named for", () => {
    expect(dailyDate(periodicNote("daily", new Date(2026, 7, 6)).path)).toBe("2026-08-06");
  });

  it("answers with nothing for a note named for anything else", () => {
    // Closing a session needs the day its note stands for, and only the day
    // notes have one.
    expect(dailyDate(periodicNote("weekly", new Date(2026, 7, 6)).path)).toBeNull();
    expect(dailyDate("projects/kasten.md")).toBeNull();
    expect(dailyDate(`${DAILY}/backlog.md`)).toBeNull();
  });
});

describe("the other four grains", () => {
  it("carry no TODOs section", () => {
    // A heading with nothing under it is clutter on every week you did not use
    // it, so only the day the prompt writes to gets one.
    for (const period of ["weekly", "monthly", "quarterly", "yearly"] as const) {
      expect(periodicNote(period, new Date(2026, 7, 6)).body).not.toContain("## TODOs");
    }
  });
});

describe("the weekly note", () => {
  const made = periodicNote("weekly", new Date(2026, 7, 6));

  it("is named for the ISO week", () => {
    expect(made.path).toBe(`${WEEKLY}/2026-W32.md`);
    expect(heading(made.body)).toBe("# 2026-W32");
  });

  it("links back a week, up to the month, and on a week", () => {
    expect(nav(made.body)).toBe(
      `[[${WEEKLY}/2026-W31]] | [[${MONTHLY}/2026-08]] | [[${WEEKLY}/2026-W33]]`,
    );
  });

  it("keeps a January date in the week its Thursday belongs to", () => {
    // 2027-01-01 is a Friday whose Thursday fell back in 2026, so the week is
    // that year's 53rd and the month above it is December.
    const january = periodicNote("weekly", new Date(2027, 0, 1));

    expect(january.path).toBe(`${WEEKLY}/2026-W53.md`);
    expect(nav(january.body)).toBe(
      `[[${WEEKLY}/2026-W52]] | [[${MONTHLY}/2026-12]] | [[${WEEKLY}/2027-W01]]`,
    );
  });
});

describe("the monthly note", () => {
  const made = periodicNote("monthly", new Date(2026, 7, 6));

  it("is named for the month", () => {
    expect(made.path).toBe(`${MONTHLY}/2026-08.md`);
    expect(heading(made.body)).toBe("# 2026-08");
  });

  it("links back a month, up to the quarter, and on a month", () => {
    expect(nav(made.body)).toBe(
      `[[${MONTHLY}/2026-07]] | [[${QUARTERLY}/2026-Q3]] | [[${MONTHLY}/2026-09]]`,
    );
  });

  it("steps over the end of a year", () => {
    expect(nav(periodicNote("monthly", new Date(2026, 0, 15)).body)).toBe(
      `[[${MONTHLY}/2025-12]] | [[${QUARTERLY}/2026-Q1]] | [[${MONTHLY}/2026-02]]`,
    );
  });
});

describe("the quarterly note", () => {
  const made = periodicNote("quarterly", new Date(2026, 7, 6));

  it("is named for the quarter", () => {
    expect(made.path).toBe(`${QUARTERLY}/2026-Q3.md`);
    expect(heading(made.body)).toBe("# 2026-Q3");
  });

  it("links back a quarter, up to the year, and on a quarter", () => {
    expect(nav(made.body)).toBe(
      `[[${QUARTERLY}/2026-Q2]] | [[${YEARLY}/2026]] | [[${QUARTERLY}/2026-Q4]]`,
    );
  });

  it("steps over the end of a year", () => {
    expect(nav(periodicNote("quarterly", new Date(2026, 0, 15)).body)).toContain(
      `[[${QUARTERLY}/2025-Q4]]`,
    );
    expect(nav(periodicNote("quarterly", new Date(2026, 10, 15)).body)).toContain(
      `[[${QUARTERLY}/2027-Q1]]`,
    );
  });
});

describe("the yearly note", () => {
  const made = periodicNote("yearly", new Date(2026, 7, 6));

  it("is named for the year", () => {
    expect(made.path).toBe(`${YEARLY}/2026.md`);
    expect(heading(made.body)).toBe("# 2026");
  });

  it("links back a year and on a year, with nothing above it", () => {
    expect(nav(made.body)).toBe(`[[${YEARLY}/2025]] | [[${YEARLY}/2027]]`);
  });
});
