import { blockLine } from "@/lib/todo-blocked";
import { closeSessions, type TimerInput, timerWrites } from "@/lib/todo-timer";
import type { Write } from "@/lib/todo-write";
import { DAILY, DAILY_PATH, FRESH_DAILY, NOTE, NOTE_PATH, TODAY } from "./todo-write-fixture";

/** Today's note with a todo of its own, on line 6, and no time log yet. */
const DAILY_TODO = [
  "# 2026-08-10 Monday",
  "",
  "[[01 Periodic/00 Daily/2026-08-09]] | [[01 Periodic/00 Daily/2026-08-11]]",
  "",
  "## TODOs",
  "- [ ] call the dentist 🆔 kt-4c2d11",
  "",
].join("\n");

/** The project note's line 7, which is the line every press below is on. */
const OPEN_TASK = "- [/] wire up the pane 📅 2026-08-14 ⏫ #kasten";

/** The same note with that line already named, so a press has nothing to stamp. */
const NAMED = NOTE.replace(OPEN_TASK, `${OPEN_TASK} 🆔 kt-3f9a2c`);

/** The line one press writes, once the id is on it: after the `⏫`, the tag where it was. */
const TASK = "- [/] wire up the pane 📅 2026-08-14 ⏫ 🆔 kt-3f9a2c #kasten";

/** One press of `t`, on the project note's line 7, with nothing running. */
function timer(over: Partial<TimerInput> = {}): TimerInput {
  return {
    path: NOTE_PATH,
    line: 7,
    dailyPath: DAILY_PATH,
    notes: { [NOTE_PATH]: NOTE, [DAILY_PATH]: FRESH_DAILY },
    sessions: [],
    today: TODAY,
    now: "14:03",
    id: "kt-3f9a2c",
    ...over,
  };
}

describe("timerWrites, starting", () => {
  it("stamps an id and opens a session in today's note", () => {
    expect(timerWrites(timer())).toEqual([
      { path: NOTE_PATH, text: NOTE.replace(OPEN_TASK, TASK) },
      {
        path: DAILY_PATH,
        text: [
          "# 2026-08-10 Monday",
          "",
          "[[01 Periodic/00 Daily/2026-08-09]] | [[01 Periodic/00 Daily/2026-08-11]]",
          "",
          "## Time",
          "- 14:03-      wire up the pane #kasten [[projects/kasten]] kt-3f9a2c",
          "",
        ].join("\n"),
      },
    ]);
  });

  it("leaves the task line alone where the todo is already named", () => {
    const writes = timerWrites(timer({ notes: { [NOTE_PATH]: NAMED, [DAILY_PATH]: FRESH_DAILY } }));

    expect(writes.map(({ path }) => path)).toEqual([DAILY_PATH]);
    expect(writes[0]?.text).toContain(
      "- 14:03-      wire up the pane #kasten [[projects/kasten]] kt-3f9a2c",
    );
  });

  it("writes one note, and no link, for a todo living in today's own note", () => {
    // The todo's note, the note being appended to and the note holding the
    // session are one note here, so the three writes have to be one.
    expect(
      timerWrites(timer({ path: DAILY_PATH, line: 6, notes: { [DAILY_PATH]: DAILY_TODO } })),
    ).toEqual([
      {
        path: DAILY_PATH,
        text: [
          "# 2026-08-10 Monday",
          "",
          "[[01 Periodic/00 Daily/2026-08-09]] | [[01 Periodic/00 Daily/2026-08-11]]",
          "",
          "## TODOs",
          "- [ ] call the dentist 🆔 kt-4c2d11",
          "",
          "## Time",
          "- 14:03-      call the dentist kt-4c2d11",
          "",
        ].join("\n"),
      },
    ]);
  });

  it("appends under a section the note already has", () => {
    const writes = timerWrites(timer({ notes: { [NOTE_PATH]: NAMED, [DAILY_PATH]: DAILY } }));

    expect(writes[0]?.text).toBe(
      [
        "# 2026-08-10 Monday",
        "",
        "[[01 Periodic/00 Daily/2026-08-09]] | [[01 Periodic/00 Daily/2026-08-11]]",
        "",
        "## Done",
        "- ✅ 2026-08-10 read the spec [[projects/kasten]] kt-000001",
        "",
        "## Time",
        "- 09:12-10:32 read the spec",
        "- 14:03-      wire up the pane #kasten [[projects/kasten]] kt-3f9a2c",
        "",
      ].join("\n"),
    );
  });

  it("answers with nothing where the line is no longer a todo", () => {
    expect(timerWrites(timer({ line: 5 }))).toEqual([]);
  });

  it("keeps a tab indent, a block id and unknown text when it stamps the id", () => {
    const note = ["- [ ] parent", "\t- [ ] part zork 🜲 words ^blk1", ""].join("\n");
    const writes = timerWrites(timer({ line: 2, notes: { [NOTE_PATH]: note } }));

    expect(writes[0]).toEqual({
      path: NOTE_PATH,
      text: ["- [ ] parent", "\t- [ ] part zork 🜲 words 🆔 kt-3f9a2c ^blk1", ""].join("\n"),
    });
  });

  it("leaves the block id off the session line", () => {
    const note = ["- [ ] parent", "\t- [ ] part zzq-unknown ^blk1", ""].join("\n");
    const writes = timerWrites(timer({ line: 2, notes: { [NOTE_PATH]: note } }));

    expect(writes[1]?.text).toContain(
      "- 14:03-      part zzq-unknown [[projects/kasten]] kt-3f9a2c\n",
    );
  });
});

const SESSION_OPEN = "- 09:12-      wire up the pane #kasten [[projects/kasten]] kt-3f9a2c";
const SESSION_CLOSED = "- 09:12-10:32 wire up the pane #kasten [[projects/kasten]] kt-3f9a2c";

/** Today's note with the time log holding the lines it is given. */
function timeLog(...lines: string[]): string {
  return [
    "# 2026-08-10 Monday",
    "",
    "[[01 Periodic/00 Daily/2026-08-09]] | [[01 Periodic/00 Daily/2026-08-11]]",
    "",
    "## Time",
    ...lines,
    "",
  ].join("\n");
}

/** The task line as a stop leaves it, the total read off the log and put after the `⏫`. */
function worked(total: string): string {
  return `- [/] wire up the pane 📅 2026-08-14 ⏫ ⏱ ${total} #kasten 🆔 kt-3f9a2c`;
}

/** The named task line rewritten with a total, which is what a stop writes. */
function totalled(total: string): string {
  return NOTE.replace(OPEN_TASK, worked(total));
}

/** One press of `t` with `lines` in today's log, which is where a stop looks. */
function stop(lines: string[], over: Partial<TimerInput> = {}): Write[] {
  return timerWrites(
    timer({
      notes: { [NOTE_PATH]: NAMED, [DAILY_PATH]: timeLog(...lines) },
      sessions: lines.map((text) => ({ path: DAILY_PATH, text })),
      now: "10:32",
      ...over,
    }),
  );
}

describe("timerWrites, stopping", () => {
  it("closes the session and writes the total onto the task line", () => {
    expect(stop([SESSION_OPEN])).toEqual([
      { path: DAILY_PATH, text: timeLog(SESSION_CLOSED) },
      { path: NOTE_PATH, text: totalled("1h20m") },
    ]);
  });

  it("sums the log rather than adding to what the line carried", () => {
    const earlier = "- 11:00-11:20 wire up the pane [[projects/kasten]] kt-3f9a2c";

    expect(stop([earlier, SESSION_OPEN])[1]?.text).toBe(totalled("1h40m"));
  });

  it("replaces a total the log does not back", () => {
    // The log is the record with times and dates in it. `⏱` is kasten's
    // summary of it, so a number typed over the top is the one that gives way.
    const typed = `${OPEN_TASK} ⏱ 9h 🆔 kt-3f9a2c`;
    const writes = stop([SESSION_OPEN], {
      notes: { [NOTE_PATH]: NOTE.replace(OPEN_TASK, typed), [DAILY_PATH]: timeLog(SESSION_OPEN) },
    });

    expect(writes[1]?.text).toBe(NOTE.replace(OPEN_TASK, `${OPEN_TASK} ⏱ 1h20m 🆔 kt-3f9a2c`));
  });

  it("keeps a tab indent, a block id and unknown text when it writes the total", () => {
    const note = ["- [ ] parent", "\t- [/] part zork 🜲 words 🆔 kt-3f9a2c ^blk1", ""].join("\n");
    const writes = stop([SESSION_OPEN], {
      line: 2,
      notes: { [NOTE_PATH]: note, [DAILY_PATH]: timeLog(SESSION_OPEN) },
    });

    expect(writes[1]?.text).toBe(
      ["- [ ] parent", "\t- [/] part zork 🜲 words ⏱ 1h20m 🆔 kt-3f9a2c ^blk1", ""].join("\n"),
    );
  });

  it("writes the new total over the old one where it sits", () => {
    const note = `\t- [/] part ⏱ 9h zork 🆔 kt-3f9a2c ^blk1`;
    const writes = stop([SESSION_OPEN], {
      line: 1,
      notes: { [NOTE_PATH]: note, [DAILY_PATH]: timeLog(SESSION_OPEN) },
    });

    expect(writes[1]?.text).toBe(`\t- [/] part ⏱ 1h20m zork 🆔 kt-3f9a2c ^blk1`);
  });

  it("closes every session running on the todo, and counts them all", () => {
    const second = "- 10:00-      wire up the pane [[projects/kasten]] kt-3f9a2c";
    const writes = stop([SESSION_OPEN, second]);

    expect(writes[0]?.text).toBe(
      timeLog(SESSION_CLOSED, "- 10:00-10:32 wire up the pane [[projects/kasten]] kt-3f9a2c"),
    );
    expect(writes[1]?.text).toBe(totalled("1h52m"));
  });

  it("writes a zero total rather than dropping it", () => {
    const now = "- 10:32-      wire up the pane [[projects/kasten]] kt-3f9a2c";

    expect(stop([now])[1]?.text).toBe(totalled("0m"));
  });

  it("counts an interval typed in backwards as nothing", () => {
    const backwards = "- 12:00-11:00 wire up the pane [[projects/kasten]] kt-3f9a2c";

    expect(stop([backwards, SESSION_OPEN])[1]?.text).toBe(totalled("1h20m"));
  });

  it("leaves a session in a note that is not a daily one alone", () => {
    // A `## Time` section written by hand into a project note is somebody's own
    // log: nothing says which day it belongs to, so a press starts instead.
    const writes = stop([], {
      sessions: [{ path: NOTE_PATH, text: SESSION_OPEN }],
      notes: { [NOTE_PATH]: NAMED, [DAILY_PATH]: FRESH_DAILY },
    });

    expect(writes.map(({ path }) => path)).toEqual([DAILY_PATH]);
    expect(writes[0]?.text).toContain("- 10:32-      wire up the pane");
  });
});

describe("closeSessions", () => {
  it("keeps the words and both links as written when the words hold a link", () => {
    const open = "\t- 09:00-      call [[ada]] about zork-qux [[projects/x]] kt-1 ^blk9";

    expect(closeSessions(open, "kt-1", "10:00")).toBe(
      "\t- 09:00-10:00 call [[ada]] about zork-qux [[projects/x]] kt-1 ^blk9",
    );
  });

  it("keeps a tab indent, a block id and unknown text, and the words' column", () => {
    const open = "\t- 09:00-      zork-qux words [[projects/x]] kt-1 ^blk9";
    const closed = closeSessions(open, "kt-1", "10:00");

    expect(closed).toBe("\t- 09:00-10:00 zork-qux words [[projects/x]] kt-1 ^blk9");
    expect(closed?.indexOf("zork-qux")).toBe(open.indexOf("zork-qux"));
  });

  it("closes a line with no own link and words ending in a link byte for byte but the end", () => {
    const open = "\t- 09:00-      call about zork-qux [[ada]] kt-1 ^blk9";

    expect(closeSessions(open, "kt-1", "10:00")).toBe(
      "\t- 09:00-10:00 call about zork-qux [[ada]] kt-1 ^blk9",
    );
  });
});

const YESTERDAY_PATH = "01 Periodic/00 Daily/2026-08-09.md";

/** Yesterday's note, with whatever the log holds left open in it. */
function yesterday(...lines: string[]): string {
  return ["# 2026-08-09 Sunday", "", "## Time", ...lines, ""].join("\n");
}

describe("timerWrites, a session somebody forgot", () => {
  const LEFT_OPEN = "- 14:03-      wire up the pane [[projects/kasten]] kt-3f9a2c";

  it("closes it at 23:59 in the note it lives in", () => {
    const writes = timerWrites(
      timer({
        notes: {
          [NOTE_PATH]: NAMED,
          [YESTERDAY_PATH]: yesterday(LEFT_OPEN),
          [DAILY_PATH]: FRESH_DAILY,
        },
        sessions: [{ path: YESTERDAY_PATH, text: LEFT_OPEN }],
        now: "09:00",
      }),
    );

    // Yesterday's, not today's: kasten never splits a session across two daily
    // notes, and 23:59 is the latest it could have run.
    expect(writes).toEqual([
      {
        path: YESTERDAY_PATH,
        text: yesterday("- 14:03-23:59 wire up the pane [[projects/kasten]] kt-3f9a2c"),
      },
      { path: NOTE_PATH, text: totalled("9h56m") },
    ]);
  });

  it("closes one left open yesterday and one running today on the same press", () => {
    const today = "- 08:00-      wire up the pane [[projects/kasten]] kt-3f9a2c";
    const writes = timerWrites(
      timer({
        notes: {
          [NOTE_PATH]: NAMED,
          [YESTERDAY_PATH]: yesterday(LEFT_OPEN),
          [DAILY_PATH]: timeLog(today),
        },
        sessions: [
          { path: YESTERDAY_PATH, text: LEFT_OPEN },
          { path: DAILY_PATH, text: today },
        ],
        now: "09:00",
      }),
    );

    expect(writes[0]?.text).toContain("- 14:03-23:59");
    expect(writes[1]?.text).toContain("- 08:00-09:00");
    expect(writes[2]?.text).toBe(totalled("10h56m"));
  });

  it("records twenty minutes over midnight as nine", () => {
    const late = "- 23:50-      wire up the pane [[projects/kasten]] kt-3f9a2c";
    const writes = timerWrites(
      timer({
        notes: {
          [NOTE_PATH]: NAMED,
          [YESTERDAY_PATH]: yesterday(late),
          [DAILY_PATH]: FRESH_DAILY,
        },
        sessions: [{ path: YESTERDAY_PATH, text: late }],
        now: "00:10",
      }),
    );

    // The rule, not a bug: the part that ran into today is lost, and both times
    // are on the line for anybody who wants to correct it.
    expect(writes[1]?.text).toBe(totalled("9m"));
  });
});

describe("field reads before a code span and with the variation selector", () => {
  it("adds a blocker at its place and leaves a code span after a bare ⛔ whole", () => {
    expect(blockLine("\t- [ ] a zzq ⛔ `c d` x ^blk1", "c", () => false)).toBe(
      "\t- [b] a zzq ⛔ `c d` x ⛔ c ^blk1",
    );
  });

  it("writes a stop's total over a ⏱ typed with the variation selector", () => {
    const writes = stop([SESSION_OPEN], {
      line: 1,
      notes: {
        [NOTE_PATH]: "\t- [/] part zork ⏱️ 1h 🆔 kt-3f9a2c ^blk1",
        [DAILY_PATH]: timeLog(SESSION_OPEN),
      },
    });

    expect(writes[1]?.text).toBe("\t- [/] part zork ⏱️ 1h20m 🆔 kt-3f9a2c ^blk1");
  });
});
