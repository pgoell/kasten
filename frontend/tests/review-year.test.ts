import type { LineHit, TodoHit } from "@/lib/api";
import type { LogDay } from "@/lib/food-api";
import {
  minutesWords,
  monthCounts,
  projectRows,
  topTags,
  type WrittenNote,
  yearNumbers,
  yearRange,
} from "@/lib/review-year";

const FDE = "02 Projects/FDE";
const KASTEN = "02 Projects/Kasten";
const YEAR = { from: "2026-01-01", to: "2026-12-31" };

function todo(text: string, project: string | null = FDE): TodoHit {
  return { path: "02 Projects/tasks.md", line: 1, text, project };
}

function note(day: string, project: string | null, tags: string[] = []): WrittenNote {
  return { path: `${day}.md`, day, tags, project };
}

function card(text: string): LineHit {
  return { path: "10 Cards/cards.md", line: 1, text };
}

/** A log day holding `entries` lines, which is all the year numbers read of one. */
function logDay(date: string, entries: number): LogDay {
  return {
    date,
    path: `01 Periodic/00 Daily/${date}.md`,
    entries: Array.from({ length: entries }, () => ({})),
    totals: {},
  } as unknown as LogDay;
}

describe("the projects table", () => {
  it("#807 A2 counts a done todo's minutes and a project's notes in the year", () => {
    const rows = projectRows(
      [
        todo("- [x] ship ✅ 2026-03-02 ⏱ 1h20m"),
        todo("- [x] write ✅ 2026-05-01 ⏱ 45m"),
        todo("- [ ] open ⏱ 2h"),
        todo("- [x] tidy ✅ 2026-06-01 ⏱ 30m", KASTEN),
      ],
      [note("2026-04-10", FDE), note("2026-04-11", null)],
      YEAR.from,
      YEAR.to,
    );

    expect(rows).toEqual([
      { project: FDE, name: "FDE", done: 2, minutes: 125, notes: 1 },
      { project: KASTEN, name: "Kasten", done: 1, minutes: 30, notes: 0 },
    ]);
  });

  it("#807 A2 leaves out the minutes of a todo with no ✅", () => {
    const rows = projectRows(
      [todo("- [ ] open ⏱ 3h"), todo("- [x] ticked ⏱ 2h")],
      [],
      YEAR.from,
      YEAR.to,
    );

    expect(rows).toEqual([]);
  });

  it("#807 A2 leaves out a done todo dated outside the range", () => {
    const rows = projectRows(
      [todo("- [x] old ✅ 2025-12-31 ⏱ 1h"), todo("- [x] later ✅ 2027-01-01 ⏱ 1h")],
      [],
      YEAR.from,
      YEAR.to,
    );

    expect(rows).toEqual([]);
  });

  it("#807 A2 sorts rows by minutes, then done, then notes, then name", () => {
    const rows = projectRows(
      [
        todo("- [x] a ✅ 2026-01-05 ⏱ 1h", "02 Projects/Beta"),
        todo("- [x] b ✅ 2026-01-06", "02 Projects/Beta"),
        todo("- [x] c ✅ 2026-01-07 ⏱ 1h", "02 Projects/Alpha"),
      ],
      [
        note("2026-02-01", "02 Projects/Gamma"),
        note("2026-02-02", "02 Projects/Gamma"),
        note("2026-02-03", "02 Projects/Epsilon"),
        note("2026-02-04", "02 Projects/Delta"),
      ],
      YEAR.from,
      YEAR.to,
    );

    expect(rows.map((row) => row.name)).toEqual(["Beta", "Alpha", "Gamma", "Delta", "Epsilon"]);
  });
});

describe("the notes per month, tags and numbers", () => {
  it("#807 A3 counts notes per month of the year only", () => {
    const counts = monthCounts(
      ["2026-01-05", "2026-01-31", "2026-12-31", "2025-12-30", "2027-01-01"],
      2026,
      "2026-12-31",
    );

    expect(counts).toEqual([2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
  });

  it("#807 A3 leaves out a note dated after the range's last day, as Notes made does", () => {
    // Tomorrow's daily note is written ahead, and /api/written answers it for today's range.
    const counts = monthCounts(["2026-10-25", "2026-10-26"], 2026, "2026-10-25");

    expect(counts[9]).toBe(1);
    expect(counts.reduce((sum, count) => sum + count, 0)).toBe(1);
  });

  it("#807 A3 counts a tag once a note, most first, ties by tag, up to the limit", () => {
    const notes = [
      note("2026-02-01", FDE, ["#work", "#fde", "#work"]),
      note("2026-03-01", FDE, ["#work", "#alpha"]),
      note("2025-03-01", FDE, ["#work"]),
      note("2026-04-01", KASTEN, ["#fde", "#work", "#beta"]),
    ];

    expect(topTags(notes, YEAR.from, YEAR.to)).toEqual([
      { tag: "#work", count: 3 },
      { tag: "#fde", count: 2 },
      { tag: "#alpha", count: 1 },
      { tag: "#beta", count: 1 },
    ]);
    expect(topTags(notes, YEAR.from, YEAR.to, 2)).toEqual([
      { tag: "#work", count: 3 },
      { tag: "#fde", count: 2 },
    ]);
  });

  it("#807 A3 adds up the year's todos, time, notes, flashcards and log days", () => {
    const numbers = yearNumbers({
      todos: [
        todo("- [x] a ✅ 2026-02-01 ⏱ 1h20m"),
        todo("- [x] b ✅ 2025-12-30 ⏱ 2h"),
        todo("- [x] c ✅ 2026-03-01"),
        todo("- [ ] d ⏱ 1h"),
      ],
      written: ["2026-02-01", "2025-06-01"],
      // The first card was last rated on 2026-02-28, the second on 2025-12-31.
      cards: [card("Q <!--SR:!2026-03-10,10,250-->"), card("Q <!--SR:!2026-01-05,5,250-->")],
      days: [logDay("2026-02-01", 1), logDay("2026-02-02", 0), logDay("2025-12-31", 3)],
      from: YEAR.from,
      to: YEAR.to,
    });

    expect(numbers).toEqual({ todosDone: 2, minutes: 80, notes: 1, flashcards: 1, daysLogged: 1 });
  });
});

describe("the year range", () => {
  it("#807 I3 runs a past year from its first day to its last", () => {
    expect(yearRange(2025, "2026-10-25")).toEqual({ from: "2025-01-01", to: "2025-12-31" });
  });

  it("#807 I3 runs this year from its first day to today", () => {
    expect(yearRange(2026, "2026-10-25")).toEqual({ from: "2026-01-01", to: "2026-10-25" });
  });

  it("#807 I3 is null for a year not begun", () => {
    expect(yearRange(2027, "2026-10-25")).toBeNull();
  });
});

describe("the empty year", () => {
  it("#807 I1 gives zeros, empty lists and no NaN from nothing", () => {
    expect(projectRows([], [], YEAR.from, YEAR.to)).toEqual([]);
    expect(
      yearNumbers({
        todos: [],
        written: [],
        cards: [],
        days: [],
        from: YEAR.from,
        to: YEAR.to,
      }),
    ).toEqual({ todosDone: 0, minutes: 0, notes: 0, flashcards: 0, daysLogged: 0 });
    expect(monthCounts([], 2026, "2026-12-31")).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(topTags([], YEAR.from, YEAR.to)).toEqual([]);
    expect(minutesWords(0)).toBe("0m");
  });
});

describe("the local day of an instant", () => {
  it("#807 I4 counts an instant on the reader's local day", () => {
    // The repo pins no zone for its tests, so this one sets it and puts it back.
    // 23:30 UTC on 31 October is 00:30 on 1 November in Berlin.
    const before = process.env.TZ;
    process.env.TZ = "Europe/Berlin";
    try {
      const counts = monthCounts(["2026-10-31T23:30:00+00:00"], 2026, "2026-12-31");
      expect(counts[9]).toBe(0);
      expect(counts[10]).toBe(1);
    } finally {
      if (before === undefined) delete process.env.TZ;
      else process.env.TZ = before;
    }
  });
});
