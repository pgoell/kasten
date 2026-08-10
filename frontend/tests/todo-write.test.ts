import { parseTodo, type Todo } from "@/lib/todo";
import {
  addTodoWrites,
  appendUnder,
  type CycleInput,
  cycleLines,
  cycleTodoWrites,
  doneLine,
  doneLogWrites,
  dropDone,
  type LogInput,
} from "@/lib/todo-write";

/** The day every test below is written against, so no assertion expires. */
const TODAY = "2026-08-10";

const DAILY_PATH = "01 Periodic/00 Daily/2026-08-10.md";

/** Today's daily note as the vault holds it, log line and all. */
const DAILY = [
  "# 2026-08-10 Monday",
  "",
  "[[01 Periodic/00 Daily/2026-08-09]] | [[01 Periodic/00 Daily/2026-08-11]]",
  "",
  "## Done",
  "- ✅ 2026-08-10 read the spec [[projects/kasten]] kt-000001",
  "",
  "## Time",
  "- 09:12-10:32 read the spec",
  "",
].join("\n");

/** The same day's note before anything was logged in it. */
const FRESH_DAILY = [
  "# 2026-08-10 Monday",
  "",
  "[[01 Periodic/00 Daily/2026-08-09]] | [[01 Periodic/00 Daily/2026-08-11]]",
  "",
].join("\n");

const NOTE_PATH = "projects/kasten.md";

/** The note the todos live in. Line 7 is doing, line 8 is open. */
const NOTE = [
  "---",
  "id: 019874aa",
  "---",
  "",
  "# kasten",
  "",
  "- [/] wire up the pane 📅 2026-08-14 ⏫ #kasten",
  "- [ ] buy milk",
  "",
].join("\n");

/** A todo out of a line, for the tests that want a record rather than a string. */
function todo(line: string): Todo {
  const found = parseTodo(line);
  if (found === null) throw new Error(`not a todo: ${line}`);
  return found;
}

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
    ...over,
  };
}

describe("appendUnder", () => {
  it("puts the line at the end of the section, above the heading after it", () => {
    expect(appendUnder(DAILY, "## Done", "- ✅ 2026-08-10 buy milk kt-000002")).toBe(
      [
        "# 2026-08-10 Monday",
        "",
        "[[01 Periodic/00 Daily/2026-08-09]] | [[01 Periodic/00 Daily/2026-08-11]]",
        "",
        "## Done",
        "- ✅ 2026-08-10 read the spec [[projects/kasten]] kt-000001",
        "- ✅ 2026-08-10 buy milk kt-000002",
        "",
        "## Time",
        "- 09:12-10:32 read the spec",
        "",
      ].join("\n"),
    );
  });

  it("makes the section at the end of a note that has none", () => {
    const note = ["# 2026-08-10 Monday", "", "[[01 Periodic/00 Daily/2026-08-09]]", ""].join("\n");

    expect(appendUnder(note, "## Done", "- ✅ 2026-08-10 buy milk kt-000002")).toBe(
      [
        "# 2026-08-10 Monday",
        "",
        "[[01 Periodic/00 Daily/2026-08-09]]",
        "",
        "## Done",
        "- ✅ 2026-08-10 buy milk kt-000002",
        "",
      ].join("\n"),
    );
  });
});

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

/** One press over a note's lines, which is what the cascade is a rule about. */
function cycle(note: string[], line: number) {
  return cycleLines({ lines: note, line, today: TODAY, id: "kt-3f9a2c" });
}

describe("cycleLines", () => {
  it("answers the one line the press moved, where nothing hangs off it", () => {
    expect(cycle(["- [ ] buy milk"], 1)).toEqual(new Map([[1, "- [/] buy milk"]]));
  });

  it("takes every open part into done with the parent", () => {
    const note = [
      "- [/] wire up the pane",
      "  - [x] read the spec ✅ 2026-08-01 🆔 kt-000001",
      "  - [ ] write it",
      "  - [b] ship it",
    ];

    // No entry for the child that was already done: it is where it belongs.
    // The blocked one is not done, so the parent's tick takes it too.
    expect(cycle(note, 1)).toEqual(
      new Map([
        [1, `- [x] wire up the pane ✅ ${TODAY} 🆔 kt-3f9a2c`],
        [3, `  - [x] write it ✅ ${TODAY}`],
        [4, `  - [x] ship it ✅ ${TODAY}`],
      ]),
    );
  });

  it("reaches a grandchild and leaves a rejected part alone", () => {
    const note = ["- [/] a", "  - [ ] b", "    - [ ] c", "  - [-] d ❌ 2026-08-01"];

    expect([...cycle(note, 1).keys()]).toEqual([1, 2, 3]);
  });

  it("stamps no id on a part it ticked, nothing naming one", () => {
    const note = ["- [/] a", "  - [ ] b"];
    const moved = cycle(note, 1);

    expect(moved.get(1)).toContain("🆔 kt-3f9a2c");
    expect(moved.get(2)).not.toContain("🆔");
  });

  it("leaves the parts where they are when the parent leaves done", () => {
    const note = [`- [x] a ✅ ${TODAY} 🆔 kt-000001`, `  - [x] b ✅ ${TODAY}`];

    expect(cycle(note, 1)).toEqual(new Map([[1, "- [b] a 🆔 kt-000001"]]));
  });

  it("leaves the parent alone when the last part is ticked", () => {
    const note = ["- [/] a", `  - [x] b ✅ ${TODAY}`, "  - [/] c"];

    expect(cycle(note, 3)).toEqual(new Map([[3, `  - [x] c ✅ ${TODAY} 🆔 kt-3f9a2c`]]));
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

  it("logs a todo entering done under today's Done heading", () => {
    const writes = cycleTodoWrites(press());

    expect(writes).toHaveLength(2);
    expect(writes[0]).toEqual({
      path: NOTE_PATH,
      text: NOTE.replace(
        "- [/] wire up the pane 📅 2026-08-14 ⏫ #kasten",
        "- [x] wire up the pane #kasten 📅 2026-08-14 ⏫ ✅ 2026-08-10 🆔 kt-3f9a2c",
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

describe("addTodoWrites", () => {
  const ADDED = "- [ ] call the dentist #health 📅 2026-08-14 ⏫ ➕ 2026-08-10";

  it("puts the todo at the end of the section the daily note already has", () => {
    const daily = [
      "# 2026-08-10 Monday",
      "",
      "[[01 Periodic/00 Daily/2026-08-09]]",
      "",
      "## TODOs",
      "- [ ] buy milk",
      "",
    ].join("\n");

    expect(addTodoWrites({ dailyPath: DAILY_PATH, dailyText: daily, todo: todo(ADDED) })).toEqual([
      {
        path: DAILY_PATH,
        text: [
          "# 2026-08-10 Monday",
          "",
          "[[01 Periodic/00 Daily/2026-08-09]]",
          "",
          "## TODOs",
          "- [ ] buy milk",
          ADDED,
          "",
        ].join("\n"),
      },
    ]);
  });

  it("makes the section in a daily note that has none", () => {
    // A note written before this feature landed, or one somebody wrote by hand.
    expect(
      addTodoWrites({ dailyPath: DAILY_PATH, dailyText: FRESH_DAILY, todo: todo(ADDED) }),
    ).toEqual([
      {
        path: DAILY_PATH,
        text: [
          "# 2026-08-10 Monday",
          "",
          "[[01 Periodic/00 Daily/2026-08-09]] | [[01 Periodic/00 Daily/2026-08-11]]",
          "",
          "## TODOs",
          ADDED,
          "",
        ].join("\n"),
      },
    ]);
  });
});
