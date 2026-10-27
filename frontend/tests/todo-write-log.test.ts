import type { TodoState } from "@/lib/todo/todo";
import {
  type CycleInput,
  cycleTodoWrites,
  doneLine,
  doneLogWrites,
  dropDone,
  type LogInput,
} from "@/lib/todo/todo-write";
import {
  DAILY,
  DAILY_PATH,
  FRESH_DAILY,
  NOTE,
  NOTE_PATH,
  TODAY,
  todo,
  UNKNOWN,
} from "./todo-write-fixture";

/** One press, with the note and the day above and nothing logged anywhere. */
function press(over: Partial<CycleInput> = {}): CycleInput {
  return {
    path: NOTE_PATH,
    text: NOTE,
    line: 7,
    dailyPath: DAILY_PATH,
    dailyText: FRESH_DAILY,
    logged: {},
    today: TODAY,
    id: "kt-3f9a2c",
    closed: UNKNOWN,
    ...over,
  };
}

describe("doneLine", () => {
  it("names the todo, links to the note it lives in and carries the id", () => {
    const line = todo("- [x] wire up the pane ✅ 2026-08-10 🆔 kt-3f9a2c");

    expect(doneLine(line, "projects/kasten.md", DAILY_PATH, TODAY)).toBe(
      "- ✅ 2026-08-10 wire up the pane [[projects/kasten]] kt-3f9a2c",
    );
  });

  it("leaves the link off a todo that lives in the note being written", () => {
    const line = todo("- [x] wire up the pane ✅ 2026-08-10 🆔 kt-3f9a2c");

    // A note pointing at itself records nothing.
    expect(doneLine(line, DAILY_PATH, DAILY_PATH, TODAY)).toBe(
      "- ✅ 2026-08-10 wire up the pane kt-3f9a2c",
    );
  });

  it("leaves a block id off and keeps unknown words, link and id", () => {
    const line = todo("\t- [x] part zzq-unknown 🆔 kt-3f9a2c ^blk1");

    expect(doneLine(line, NOTE_PATH, DAILY_PATH, TODAY)).toBe(
      "- ✅ 2026-08-10 part zzq-unknown [[projects/kasten]] kt-3f9a2c",
    );
  });

  it("keeps a caret inside the words and a block id that does not end them", () => {
    const line = todo("- [x] a^b then ^blk1 more 🆔 kt-3f9a2c");

    expect(doneLine(line, NOTE_PATH, DAILY_PATH, TODAY)).toBe(
      "- ✅ 2026-08-10 a^b then ^blk1 more [[projects/kasten]] kt-3f9a2c",
    );
  });
});

describe("dropDone", () => {
  it("takes the line naming the id back out", () => {
    expect(dropDone(DAILY, "kt-000001")).toBe(
      [
        "# 2026-08-10 Monday",
        "",
        "[[01 Periodic/00 Daily/2026-08-09]] | [[01 Periodic/00 Daily/2026-08-11]]",
        "",
        "## Done",
        "",
        "## Time",
        "- 09:12-10:32 read the spec",
        "",
      ].join("\n"),
    );
  });

  it("takes every line naming the id, not the first", () => {
    const note = [
      "## Done",
      "- ✅ 2026-08-10 read the spec [[projects/kasten]] kt-000001",
      "- ✅ 2026-08-10 read the spec [[projects/kasten]] kt-000001",
      "- ✅ 2026-08-10 buy milk kt-000002",
      "",
    ].join("\n");

    expect(dropDone(note, "kt-000001")).toBe(
      ["## Done", "- ✅ 2026-08-10 buy milk kt-000002", ""].join("\n"),
    );
  });

  it("answers null where the note names the id nowhere", () => {
    expect(dropDone(DAILY, "kt-3f9a2c")).toBeNull();
  });

  it("leaves the todo line itself alone, which is not a log line", () => {
    const note = ["- [x] wire up the pane ✅ 2026-08-10 🆔 kt-3f9a2c", ""].join("\n");

    expect(dropDone(note, "kt-3f9a2c")).toBeNull();
  });
});

describe("cycleTodoWrites", () => {
  it("writes the todo's own note, and only that, on a press that logs nothing", () => {
    const writes = cycleTodoWrites(press({ line: 8 }));

    expect(writes).toEqual([
      {
        path: NOTE_PATH,
        text: NOTE.replace("- [ ] buy milk", "- [/] buy milk"),
      },
    ]);
  });

  it("keeps a tab indent, a block id and the field order, as the board's press does", () => {
    const text = [
      "- [ ] parent",
      "\t- [/] part ⏫ 📅 2026-10-20 #kasten",
      "- [ ] a 📅 2026-10-20 ^blk1",
      "",
    ].join("\n");
    const own = (line: number, state?: TodoState) =>
      cycleTodoWrites(press({ text, line, state }))[0]?.text.split("\n")[line - 1];

    expect(own(2)).toBe(`\t- [x] part ⏫ 📅 2026-10-20 ✅ ${TODAY} 🆔 kt-3f9a2c #kasten`);
    expect(own(2, "blocked")).toBe("\t- [b] part ⏫ 📅 2026-10-20 #kasten");
    expect(own(3, "done")).toBe(`- [x] a 📅 2026-10-20 ✅ ${TODAY} 🆔 kt-3f9a2c ^blk1`);
  });

  it("logs a todo entering done under today's Done heading", () => {
    const writes = cycleTodoWrites(press());

    expect(writes).toHaveLength(2);
    expect(writes[0]).toEqual({
      path: NOTE_PATH,
      text: NOTE.replace(
        "- [/] wire up the pane 📅 2026-08-14 ⏫ #kasten",
        "- [x] wire up the pane 📅 2026-08-14 ⏫ ✅ 2026-08-10 🆔 kt-3f9a2c #kasten",
      ),
    });
    expect(writes[1]).toEqual({
      path: DAILY_PATH,
      text: `${FRESH_DAILY.replace(/\n+$/, "")}\n\n## Done\n- ✅ 2026-08-10 wire up the pane #kasten [[projects/kasten]] kt-3f9a2c\n`,
    });
  });

  it("logs a todo ticked out of review under today's Done heading, as out of doing", () => {
    const review = NOTE.replace("- [/] wire up the pane", "- [r] wire up the pane");
    const writes = cycleTodoWrites(press({ text: review }));

    expect(writes).toHaveLength(2);
    expect(writes[0]).toEqual({
      path: NOTE_PATH,
      text: review.replace(
        "- [r] wire up the pane 📅 2026-08-14 ⏫ #kasten",
        "- [x] wire up the pane 📅 2026-08-14 ⏫ ✅ 2026-08-10 🆔 kt-3f9a2c #kasten",
      ),
    });
    expect(writes[1]).toEqual({
      path: DAILY_PATH,
      text: `${FRESH_DAILY.replace(/\n+$/, "")}\n\n## Done\n- ✅ 2026-08-10 wire up the pane #kasten [[projects/kasten]] kt-3f9a2c\n`,
    });
  });

  it("appends nothing where the id is already logged", () => {
    const already = [
      "# 2026-08-10 Monday",
      "",
      "## Done",
      "- ✅ 2026-08-10 wire up the pane [[projects/kasten]] kt-3f9a2c",
      "",
    ].join("\n");
    // The todo carries the id it was given the first time it was ticked, and a
    // fresh one is passed in to prove the line's own id is what is read.
    const writes = cycleTodoWrites(
      press({
        text: NOTE.replace("⏫ #kasten", "⏫ 🆔 kt-3f9a2c #kasten"),
        dailyText: already,
        logged: { [DAILY_PATH]: already },
        id: "kt-ffffff",
      }),
    );

    expect(writes.map((write) => write.path)).toEqual([NOTE_PATH]);
  });

  it("takes the log line back out of whichever day it was written on", () => {
    const tuesday = "01 Periodic/00 Daily/2026-08-04.md";
    const logged = [
      "# 2026-08-04 Tuesday",
      "",
      "## Done",
      "- ✅ 2026-08-04 wire up the pane [[projects/kasten]] kt-3f9a2c",
      "- ✅ 2026-08-04 read the spec [[projects/kasten]] kt-000001",
      "",
    ].join("\n");
    const done = "- [x] wire up the pane #kasten 📅 2026-08-14 ⏫ ✅ 2026-08-04 🆔 kt-3f9a2c";

    const writes = cycleTodoWrites(
      press({
        text: NOTE.replace("- [/] wire up the pane 📅 2026-08-14 ⏫ #kasten", done),
        logged: { [tuesday]: logged },
        state: "blocked",
      }),
    );

    expect(writes).toHaveLength(2);
    expect(writes[0]?.path).toBe(NOTE_PATH);
    expect(writes[0]?.text).toContain(
      "- [b] wire up the pane #kasten 📅 2026-08-14 ⏫ 🆔 kt-3f9a2c",
    );
    expect(writes[1]).toEqual({
      path: tuesday,
      text: [
        "# 2026-08-04 Tuesday",
        "",
        "## Done",
        "- ✅ 2026-08-04 read the spec [[projects/kasten]] kt-000001",
        "",
      ].join("\n"),
    });
  });

  it("logs a todo already living in today's note, in that note, with no link", () => {
    // The daily note is where a todo most often lives, so skipping the log
    // there would leave `## Done` empty for the commonest way of working. The
    // link is what a note pointing at itself does not need, and `doneLine`
    // leaves that off on its own.
    const daily = ["# 2026-08-10 Monday", "", "## TODOs", "- [/] call the dentist ⏫", ""].join(
      "\n",
    );

    const writes = cycleTodoWrites(
      press({ path: DAILY_PATH, text: daily, line: 4, dailyText: daily }),
    );

    // One write, not two: the tick and the log land in the same note.
    expect(writes).toHaveLength(1);
    expect(writes[0]?.path).toBe(DAILY_PATH);
    expect(writes[0]?.text).toContain("- [x] call the dentist ⏫ ✅ 2026-08-10 🆔 kt-3f9a2c");
    expect(writes[0]?.text).toContain("## Done\n- ✅ 2026-08-10 call the dentist kt-3f9a2c");
    expect(writes[0]?.text).not.toContain("[[");
  });
});

/** One press read as the log alone, which is what the editor's key needs. */
function logged(over: Partial<LogInput> = {}): LogInput {
  return {
    was: todo("- [/] wire up the pane #kasten"),
    now: todo("- [x] wire up the pane #kasten ✅ 2026-08-10 🆔 kt-3f9a2c"),
    path: NOTE_PATH,
    dailyPath: DAILY_PATH,
    dailyText: FRESH_DAILY,
    logged: {},
    today: TODAY,
    ...over,
  };
}

describe("doneLogWrites", () => {
  // The log on its own, without the note the todo lives in. `<leader>x` cycles
  // the buffer and autosave writes that note, so the key needs the other half
  // and only the other half.
  it("logs a todo that has entered done, and writes no note of its own", () => {
    const writes = doneLogWrites(logged());

    expect(writes.map((write) => write.path)).toEqual([DAILY_PATH]);
    expect(writes[0]?.text).toContain(
      "- ✅ 2026-08-10 wire up the pane #kasten [[projects/kasten]] kt-3f9a2c",
    );
  });

  it("drops the line again when the todo leaves done", () => {
    const writes = doneLogWrites(
      logged({
        was: todo("- [x] read the spec ✅ 2026-08-10 🆔 kt-000001"),
        now: todo("- [b] read the spec 🆔 kt-000001"),
        logged: { [DAILY_PATH]: DAILY },
      }),
    );

    expect(writes.map((write) => write.path)).toEqual([DAILY_PATH]);
    expect(writes[0]?.text).not.toContain("kt-000001");
  });

  it("writes nothing at all where the press touched neither end of done", () => {
    const was = todo("- [ ] buy milk");
    const now = todo("- [/] buy milk");

    expect(doneLogWrites(logged({ was, now }))).toEqual([]);
  });
});
