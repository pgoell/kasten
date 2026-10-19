import {
  cycleLine,
  formatTodo,
  isOpen,
  nameAt,
  newId,
  parseTodo,
  patchLine,
  setStateOn,
  type Todo,
  type TodoState,
} from "@/lib/todo";

/** The day the press lands on, and the id it brings with it. */
const TODAY = "2026-08-10";
const FRESH = "kt-000001";

function press(line: string): string {
  return cycleLine(line, TODAY, FRESH);
}

/** The spec's own line, which carries every field at once. */
const EXAMPLE =
  "- [/] wire up the pane 📅 2026-08-14 ⏳ 2026-08-12 🛫 2026-08-11 ⏫ 🔁 every week ➕ 2026-08-09 ⏲ 2h ⏱ 1h20m 🆔 kt-3f9a2c ⛔ kt-8b1e04 #kasten";

/** The parse, which every case below expects to answer something. */
function parsed(line: string): Todo {
  const todo = parseTodo(line);
  if (todo === null) throw new Error(`not a todo: ${line}`);
  return todo;
}

describe("parseTodo", () => {
  it("reads each state character", () => {
    expect(parsed("- [ ] buy milk").state).toBe("open");
    expect(parsed("- [/] buy milk").state).toBe("doing");
    expect(parsed("- [x] buy milk").state).toBe("done");
    expect(parsed("- [X] buy milk").state).toBe("done");
    expect(parsed("- [b] buy milk").state).toBe("blocked");
    expect(parsed("- [-] buy milk").state).toBe("rejected");
  });

  // One row of the spec's table each, alone on an otherwise bare line, so a
  // field that leaks into the words is named by the case that put it there.
  const FIELDS: [string, Partial<Todo>][] = [
    ["📅 2026-08-14", { due: "2026-08-14" }],
    ["⏳ 2026-08-12", { scheduled: "2026-08-12" }],
    ["🛫 2026-08-11", { start: "2026-08-11" }],
    ["➕ 2026-08-09", { created: "2026-08-09" }],
    ["✅ 2026-08-10", { done: "2026-08-10" }],
    ["❌ 2026-08-10", { cancelled: "2026-08-10" }],
    ["🔺", { priority: "highest" }],
    ["⏫", { priority: "high" }],
    ["🔼", { priority: "medium" }],
    ["🔽", { priority: "low" }],
    ["⏬", { priority: "lowest" }],
    ["🔁 every week", { recurrence: "every week" }],
    ["🆔 kt-3f9a2c", { id: "kt-3f9a2c" }],
    ["⛔ kt-8b1e04", { blockedBy: ["kt-8b1e04"] }],
    ["⏲ 2h", { estimate: "2h" }],
    ["⏱ 1h20m", { worked: "1h20m" }],
    ["#health", { text: "buy milk #health", tags: ["#health"] }],
  ];

  for (const [field, expected] of FIELDS) {
    it(`reads ${field}`, () => {
      expect(parsed(`- [ ] buy milk ${field}`)).toMatchObject({ text: "buy milk", ...expected });
    });
  }

  it("reads the whole of the spec's line", () => {
    expect(parsed(EXAMPLE)).toEqual({
      indent: 0,
      state: "doing",
      text: "wire up the pane #kasten",
      tags: ["#kasten"],
      due: "2026-08-14",
      scheduled: "2026-08-12",
      start: "2026-08-11",
      priority: "high",
      recurrence: "every week",
      created: "2026-08-09",
      estimate: "2h",
      worked: "1h20m",
      id: "kt-3f9a2c",
      blockedBy: ["kt-8b1e04"],
    });
  });

  it("leaves a marker whose value does not parse in the words", () => {
    expect(parsed("- [ ] buy milk 📅 someday")).toMatchObject({
      text: "buy milk 📅 someday",
      due: undefined,
    });
  });

  it("refuses a line that is not a todo", () => {
    expect(parseTodo("- [[borges]] and prose")).toBeNull();
    expect(parseTodo("1. [ ] ordered")).toBeNull();
    expect(parseTodo("- [z] unknown state")).toBeNull();
    expect(parseTodo("plain prose")).toBeNull();
  });

  it("reads 📆 and 🗓 as due, as obsidian-tasks does", () => {
    expect(parsed("- [ ] a 📆 2026-10-20")).toMatchObject({ text: "a", due: "2026-10-20" });
    expect(parsed("- [ ] a 🗓 2026-10-20")).toMatchObject({ text: "a", due: "2026-10-20" });
    // The variation selector the glyph is often typed with.
    expect(parsed("- [ ] a 🗓️ 2026-10-20")).toMatchObject({ text: "a", due: "2026-10-20" });
  });

  it("reads 🏁 as a field, so words added to the line land before it", () => {
    expect(parsed("- [ ] a 🏁 delete 📅 2026-10-20")).toMatchObject({
      text: "a",
      onCompletion: "delete",
      due: "2026-10-20",
    });
    expect(parsed("- [ ] a 🔁 every week 🏁 keep")).toMatchObject({
      recurrence: "every week",
      onCompletion: "keep",
    });
    expect(formatTodo(parsed("- [ ] a 🏁 keep 🔁 every week ➕ 2026-10-01"))).toBe(
      "- [ ] a 🔁 every week 🏁 keep ➕ 2026-10-01",
    );
  });

  it("leaves 🏁 with a value that runs on in the words", () => {
    expect(parsed("- [ ] a 🏁 keep-it")).toMatchObject({
      text: "a 🏁 keep-it",
      onCompletion: undefined,
    });
  });

  it("reads no field from inside a link or a code span", () => {
    for (const words of [
      "see [[notes 📅 2026-10-20]]",
      "see [notes 📅 2026-10-20](notes.md)",
      "see `📅 2026-10-20`",
    ]) {
      expect(parsed(`- [ ] ${words}`)).toMatchObject({ text: words, due: undefined });
    }
    // A field outside the span still reads, with its value off the words.
    expect(parsed("- [ ] see [[a 🆔 x]] 📅 2026-10-20 🆔 kt-1")).toMatchObject({
      text: "see [[a 🆔 x]]",
      due: "2026-10-20",
      id: "kt-1",
    });
  });

  it("leaves a ⛔ whose value would start a code span in the words", () => {
    expect(parsed("\t- [ ] a zzq ⛔ `c d` x ^blk1")).toMatchObject({
      text: "a zzq ⛔ `c d` x ^blk1",
      blockedBy: [],
    });
  });

  it("reads a later ⛔ past one that stands before a code span", () => {
    expect(parsed("\t- [ ] a zzq ⛔ `c d` x ⛔ e ^blk1")).toMatchObject({
      text: "a zzq ⛔ `c d` x ^blk1",
      blockedBy: ["e"],
    });
  });

  it("reads a blocker with an underscore in it", () => {
    expect(parsed("\t- [ ] a zzq ⛔ a_b ^blk1").blockedBy).toEqual(["a_b"]);
  });

  it("reads ⏱ typed with the variation selector", () => {
    expect(parsed("\t- [ ] a zzq ⏱️ 1h ^blk1")).toMatchObject({
      text: "a zzq ^blk1",
      worked: "1h",
    });
  });

  it("reads ⏲ typed with the variation selector", () => {
    expect(parsed("\t- [ ] a zzq ⏲️ 2h ^blk1")).toMatchObject({
      text: "a zzq ^blk1",
      estimate: "2h",
    });
  });

  it("reads ⏳ typed with the variation selector as scheduled", () => {
    expect(parsed("\t- [ ] call zork-qux ⏳️ 2026-10-20 ^blk9")).toMatchObject({
      text: "call zork-qux ^blk9",
      scheduled: "2026-10-20",
    });
  });

  it("reads every field marker the same with the variation selector after it", () => {
    const fields = [
      "📅 2026-10-20",
      "📆 2026-10-20",
      "🗓 2026-10-20",
      "🛫 2026-10-20",
      "➕ 2026-10-20",
      "✅ 2026-10-20",
      "❌ 2026-10-20",
      "🔺",
      "⏫",
      "🔼",
      "🔽",
      "⏬",
      "🔁 every week",
      "🏁 keep",
      "🆔 kt-1",
      "⛔ a",
      "⏲ 2h",
      "⏱ 1h",
      "👤 2026-10-01 ada",
    ];
    for (const field of fields) {
      const glyph = [...field][0] ?? "";
      const selected = `${glyph}️${field.slice(glyph.length)}`;
      const plain = parsed(`\t- [ ] call zork-qux ${field} ^blk9`);

      expect(parsed(`\t- [ ] call zork-qux ${selected} ^blk9`), selected).toEqual(plain);
      expect(plain.text, field).toBe("call zork-qux ^blk9");
    }
  });

  it("counts what the line is indented by, and writes it back", () => {
    expect(parsed("    - [ ] nested").indent).toBe(4);
    expect(formatTodo(parsed("    - [ ] nested"))).toBe("    - [ ] nested");
  });
});

describe("formatTodo", () => {
  it("gives a line already in canonical order back byte for byte", () => {
    const lines = [
      "- [x] wire up the pane #kasten 📅 2026-08-14 ⏳ 2026-08-12 🛫 2026-08-11 ⏫ 🔁 every week ➕ 2026-08-09 ✅ 2026-08-10 ⏲ 2h ⏱ 1h20m 🆔 kt-3f9a2c ⛔ kt-8b1e04",
      "  - [-] call the dentist ➕ 2026-08-09 ❌ 2026-08-10",
    ];

    for (const line of lines) {
      expect(formatTodo(parsed(line))).toBe(line);
    }
  });

  it("normalizes a line written in another order", () => {
    // The spec's own line puts `#kasten` after the fields. A tag belongs to the
    // words, so rebuilding moves it back in front of them and leaves every
    // field where it was.
    expect(formatTodo(parsed(EXAMPLE))).toBe(
      "- [/] wire up the pane #kasten 📅 2026-08-14 ⏳ 2026-08-12 🛫 2026-08-11 ⏫ 🔁 every week ➕ 2026-08-09 ⏲ 2h ⏱ 1h20m 🆔 kt-3f9a2c ⛔ kt-8b1e04",
    );
  });
});

describe("cycleLine", () => {
  it("walks a plain line forward through the work and back out", () => {
    // Each press reads what the one before it wrote, which is what the key
    // does, so a field dropped on the way is named by the step that dropped it.
    let line = press("call the dentist");
    expect(line).toBe("- [ ] call the dentist ➕ 2026-08-10");

    line = press(line);
    expect(line).toBe("- [/] call the dentist ➕ 2026-08-10");

    line = press(line);
    expect(line).toBe("- [x] call the dentist ➕ 2026-08-10 ✅ 2026-08-10 🆔 kt-000001");

    // Done is the last state the walk reaches, so a list of open work loses the
    // row at the end of the walk rather than in the middle of it.
    line = press(line);
    expect(line).toBe("call the dentist ➕ 2026-08-10 🆔 kt-000001");
  });

  it("walks a blocked line back into the work", () => {
    // Blocked and rejected are things that happen to work rather than steps in
    // it, so the walk does not stop at either. It picks a blocked line up where
    // the work left off and lets a rejected one go.
    expect(press("- [b] call the dentist ➕ 2026-08-09")).toBe(
      "- [/] call the dentist ➕ 2026-08-09",
    );
    expect(press("- [-] call the dentist ➕ 2026-08-09 ❌ 2026-08-10")).toBe(
      "call the dentist ➕ 2026-08-09",
    );
  });

  it("takes the bullet off the line it makes a todo of", () => {
    expect(press("- buy milk")).toBe("- [ ] buy milk ➕ 2026-08-10");
  });

  it("keeps every field but the stamp of the state it leaves, on the way to prose", () => {
    // The tag stays after the fields where it was typed: the line is patched,
    // not rebuilt.
    expect(
      press("- [-] call the dentist 📅 2026-08-14 ⏫ ➕ 2026-08-09 ❌ 2026-08-10 #health"),
    ).toBe("call the dentist 📅 2026-08-14 ⏫ ➕ 2026-08-09 #health");
    expect(
      press("- [x] call the dentist 📅 2026-08-14 ⏫ ➕ 2026-08-09 ✅ 2026-08-10 #health"),
    ).toBe("call the dentist 📅 2026-08-14 ⏫ ➕ 2026-08-09 #health");
  });

  it("stamps no second ➕ on a line that carries one", () => {
    expect(press("call the dentist ➕ 2026-08-09")).toBe("- [ ] call the dentist ➕ 2026-08-09");
  });

  it("keeps the id a todo entering done already carries", () => {
    expect(press("- [/] call the dentist 🆔 kt-abc123")).toBe(
      "- [x] call the dentist ✅ 2026-08-10 🆔 kt-abc123",
    );
  });
});

describe("setStateOn", () => {
  function set(line: string, state: TodoState): string {
    return setStateOn(line, state, TODAY, FRESH);
  }

  it("stamps what the state it enters is worth, wherever it comes from", () => {
    expect(set("- [ ] call the dentist", "done")).toBe(
      "- [x] call the dentist ✅ 2026-08-10 🆔 kt-000001",
    );
    expect(set("- [ ] call the dentist", "rejected")).toBe("- [-] call the dentist ❌ 2026-08-10");
    expect(set("- [ ] call the dentist", "blocked")).toBe("- [b] call the dentist");
  });

  it("strips the stamp of the state it leaves", () => {
    expect(set("- [x] call the dentist ✅ 2026-08-10 🆔 kt-abc123", "blocked")).toBe(
      "- [b] call the dentist 🆔 kt-abc123",
    );
    expect(set("- [-] call the dentist ❌ 2026-08-10", "open")).toBe("- [ ] call the dentist");
  });

  it("keeps the id a todo already carries", () => {
    expect(set("- [/] call the dentist 🆔 kt-abc123", "done")).toBe(
      "- [x] call the dentist ✅ 2026-08-10 🆔 kt-abc123",
    );
  });

  it("makes a todo of a plain line, stamping the created date the cycle stamps", () => {
    expect(set("call the dentist", "blocked")).toBe("- [b] call the dentist ➕ 2026-08-10");
  });

  it("gives a line already in that state back as it was", () => {
    const line = "- [b] call the dentist ➕ 2026-08-09";
    expect(set(line, "blocked")).toBe(line);
  });
});

describe("a state change keeps the line", () => {
  function set(line: string, state: TodoState): string {
    return setStateOn(line, state, TODAY, FRESH);
  }

  it("keeps a tab indent a tab", () => {
    const part = "\t- [ ] part 📅 2026-10-20";

    expect(press(part)).toBe("\t- [/] part 📅 2026-10-20");
    expect(set(part, "done")).toBe(`\t- [x] part 📅 2026-10-20 ✅ ${TODAY} 🆔 ${FRESH}`);
  });

  it("keeps a block id at the end of the line", () => {
    const line = "- [ ] a 📅 2026-10-20 ^blk1";

    expect(set(line, "done")).toBe(`- [x] a 📅 2026-10-20 ✅ ${TODAY} 🆔 ${FRESH} ^blk1`);
    expect(set(`- [x] a 📅 2026-10-20 ✅ ${TODAY} 🆔 kt-abc123 ^blk1`, "open")).toBe(
      "- [ ] a 📅 2026-10-20 🆔 kt-abc123 ^blk1",
    );
    expect(set(line, "waiting")).toBe(`- [w] a 👤 ${TODAY} 📅 2026-10-20 ^blk1`);
    // Neither free-text field runs into the id.
    expect(parsed(`- [w] a 👤 ${TODAY} ^blk1`)).toMatchObject({ waitingOn: undefined });
    expect(parsed("- [ ] a 🔁 every week ^blk1")).toMatchObject({ recurrence: "every week" });
  });

  it("keeps words and unknown text byte for byte, each stamp at its place in the order", () => {
    expect(press("- [/] call  the dentist 📅 someday ⏫ ➕ 2026-08-09 ⏲ 2h")).toBe(
      `- [x] call  the dentist 📅 someday ⏫ ➕ 2026-08-09 ✅ ${TODAY} ⏲ 2h 🆔 ${FRESH}`,
    );
    expect(set("- [ ] call  the dentist ⏲ 2h", "rejected")).toBe(
      `- [-] call  the dentist ❌ ${TODAY} ⏲ 2h`,
    );
  });

  it("never fuses a stamp onto the text after a field", () => {
    expect(set("- [/] a ⏫urgent", "done")).toBe(`- [x] a ⏫ ✅ ${TODAY} 🆔 ${FRESH} urgent`);
    expect(set("- [x] a ⏫urgent ✅ 2026-01-01", "rejected")).toBe(`- [-] a ⏫ ❌ ${TODAY} urgent`);
    expect(set("- [/] a 📅 2026-01-01,b", "done")).toBe(
      `- [x] a 📅 2026-01-01 ✅ ${TODAY} 🆔 ${FRESH} ,b`,
    );
  });

  it("puts a stamp after a marker whose value is words, not into them", () => {
    expect(set("- [/] a 📅 friday", "done")).toBe(`- [x] a 📅 friday ✅ ${TODAY} 🆔 ${FRESH}`);
    expect(set("- [ ] a 📅 friday ⏫", "waiting")).toBe(`- [w] a 📅 friday 👤 ${TODAY} ⏫`);
  });

  it("reorders nothing on a line whose fields sit out of order", () => {
    expect(press("- [ ] a ⏫ 🆔 kt-abc123 📅 2026-10-20 #tag")).toBe(
      "- [/] a ⏫ 🆔 kt-abc123 📅 2026-10-20 #tag",
    );
    expect(set("- [/] a ⏲ 2h 📅 2026-10-20 #tag", "done")).toBe(
      `- [x] a ⏲ 2h 📅 2026-10-20 ✅ ${TODAY} 🆔 ${FRESH} #tag`,
    );
  });

  it("keeps indent, words and block id into the cycle and out of it", () => {
    expect(press("\t- buy  milk ^blk1")).toBe(`\t- [ ] buy  milk ➕ ${TODAY} ^blk1`);
    expect(press(`\t- [x] buy  milk ✅ ${TODAY} 🆔 kt-abc123 ^blk1`)).toBe(
      "\tbuy  milk 🆔 kt-abc123 ^blk1",
    );
    expect(press(`\t- [-] buy  milk ❌ ${TODAY} ^blk1`)).toBe("\tbuy  milk ^blk1");
  });

  it("keeps 📆 and 🗓 as written, and reads them as due afterwards", () => {
    const waiting = set("- [ ] a 📆 2026-10-20", "waiting");
    expect(waiting).toBe(`- [w] a 👤 ${TODAY} 📆 2026-10-20`);

    const done = set("- [/] a 🗓️ 2026-10-20", "done");
    expect(done).toBe(`- [x] a 🗓️ 2026-10-20 ✅ ${TODAY} 🆔 ${FRESH}`);
    expect(parsed(done).due).toBe("2026-10-20");
  });
});

describe("a todo waiting on somebody", () => {
  function set(line: string, state: TodoState): string {
    return setStateOn(line, state, TODAY, FRESH);
  }

  it("reads the box, the day the wait began and who it is on", () => {
    const todo = parsed("- [w] decision record 👤 2026-08-03 [[Ada Lovelace]] #adr");

    expect(todo.state).toBe("waiting");
    expect(todo.waitingSince).toBe("2026-08-03");
    expect(todo.waitingOn).toBe("[[Ada Lovelace]]");
    expect(todo.text).toBe("decision record #adr");
  });

  it("reads a name alone, a date alone, and a name written as plain words", () => {
    expect(parsed("- [w] a 👤 [[Ada]]")).toMatchObject({ waitingOn: "[[Ada]]" });
    expect(parsed("- [w] a 👤 [[Ada]]").waitingSince).toBeUndefined();
    expect(parsed("- [w] a 👤 2026-08-03")).toMatchObject({ waitingSince: "2026-08-03" });
    expect(parsed("- [w] a 👤 2026-08-03").waitingOn).toBeUndefined();
    expect(parsed("- [w] a 👤 2026-08-03 the tax office")).toMatchObject({
      waitingSince: "2026-08-03",
      waitingOn: "the tax office",
    });
  });

  it("ends the name at the next field, and keeps the anchor of a link", () => {
    const todo = parsed("- [w] a 👤 2026-08-03 [[people/ada#notes|Ada]] 📅 2026-08-14");

    expect(todo.waitingOn).toBe("[[people/ada#notes|Ada]]");
    expect(todo.due).toBe("2026-08-14");
  });

  it("leaves a marker with nothing after it in the words", () => {
    expect(parsed("- [w] a 👤").text).toBe("a 👤");
  });

  it("does not let a recurrence run into it", () => {
    const todo = parsed("- [w] a 🔁 every week 👤 2026-08-03 Ada");

    expect(todo.recurrence).toBe("every week");
    expect(todo.waitingOn).toBe("Ada");
  });

  it("writes the field ahead of every other, the date before the name", () => {
    // obsidian-tasks reads a line back from its end and stops at what it does
    // not know, so a marker of ours has to sit before the ones it reads.
    const line =
      "- [w] decision record #adr 👤 2026-08-03 [[Ada]] 📅 2026-08-14 🆔 kt-3f9a2c ⛔ kt-8b1e04";

    expect(formatTodo(parsed(line))).toBe(line);
    expect(formatTodo(parsed("- [w] a 📅 2026-08-14 👤 2026-08-03 Ada"))).toBe(
      "- [w] a 👤 2026-08-03 Ada 📅 2026-08-14",
    );
  });

  it("says where the name goes on a waiting line that names nobody", () => {
    const line = "- [w] decision record 👤 2026-08-10 📅 2026-08-14";

    expect(line.slice(0, nameAt(line) ?? 0)).toBe("- [w] decision record 👤 2026-08-10");
    expect(nameAt("- [w] decision record 👤 2026-08-10 Ada 📅 2026-08-14")).toBeNull();
    expect(nameAt("- [ ] decision record 👤 2026-08-10")).toBeNull();
    expect(nameAt("- [w] decision record")).toBeNull();
  });

  it("says where the name goes after a 👤 typed with the variation selector", () => {
    const line = "\t- [w] decision zork-qux 👤️ 2026-08-10 📅 2026-08-14 ^blk9";

    expect(line.slice(0, nameAt(line) ?? 0)).toBe("\t- [w] decision zork-qux 👤️ 2026-08-10");
  });

  it("stamps the day on entering, and keeps one the line already carries", () => {
    expect(set("- [ ] decision record", "waiting")).toBe("- [w] decision record 👤 2026-08-10");
    expect(set("- [ ] decision record 📅 2026-08-14", "waiting")).toBe(
      "- [w] decision record 👤 2026-08-10 📅 2026-08-14",
    );
    expect(set("- [ ] decision record 👤 [[Ada]]", "waiting")).toBe(
      "- [w] decision record 👤 2026-08-10 [[Ada]]",
    );
    expect(set("- [/] decision record 👤 2026-08-03 Ada", "waiting")).toBe(
      "- [w] decision record 👤 2026-08-03 Ada",
    );
  });

  it("drops the whole field on leaving, whichever key leaves", () => {
    const line = "- [w] decision record 📅 2026-08-14 👤 2026-08-03 [[Ada]]";

    expect(set(line, "open")).toBe("- [ ] decision record 📅 2026-08-14");
    expect(set(line, "blocked")).toBe("- [b] decision record 📅 2026-08-14");
    expect(set(line, "done")).toBe(
      "- [x] decision record 📅 2026-08-14 ✅ 2026-08-10 🆔 kt-000001",
    );
  });

  it("keeps a 👤 typed onto a line that was never waiting", () => {
    expect(set("- [ ] decision record 👤 [[Ada]]", "doing")).toBe(
      "- [/] decision record 👤 [[Ada]]",
    );
  });

  it("is off the walk, which picks it up at doing and drops the field", () => {
    expect(press("- [w] decision record 👤 2026-08-03 [[Ada]]")).toBe("- [/] decision record");
    // The walk never arrives at it.
    expect(press("- [ ] decision record")).toBe("- [/] decision record");
  });

  it("is open work", () => {
    expect(isOpen(parsed("- [w] decision record"))).toBe(true);
  });
});

describe("a marker typed with the variation selector", () => {
  function set(line: string, state: TodoState): string {
    return setStateOn(line, state, TODAY, FRESH);
  }

  it("keeps the marker as typed when a value is written over it", () => {
    const line = "\t- [/] call zork-qux ⏱️ 1h ^blk9";
    expect(patchLine(line, { ...parsed(line), worked: "2h" })).toBe(
      "\t- [/] call zork-qux ⏱️ 2h ^blk9",
    );
    expect(set("\t- [/] call zork-qux 👤️ ada ^blk9", "waiting")).toBe(
      `\t- [w] call zork-qux 👤️ ${TODAY} ada ^blk9`,
    );
  });

  it("adds a picked blocker after one typed with the selector, and reads both", () => {
    const line = "\t- [b] call zork-qux ⛔️ a ^blk9";
    const written = patchLine(line, { ...parsed(line), blockedBy: ["a", "b"] });

    expect(written).toBe("\t- [b] call zork-qux ⛔️ a ⛔ b ^blk9");
    expect(parsed(written).blockedBy).toEqual(["a", "b"]);
  });

  it("takes the selector off with a stamp it takes off", () => {
    const done = "\t- [x] call zork-qux ✅️ 2026-10-01 🆔 kt-1 ^blk9";
    expect(set(done, "open")).toBe("\t- [ ] call zork-qux 🆔 kt-1 ^blk9");
    expect(press(done)).toBe("\tcall zork-qux 🆔 kt-1 ^blk9");
    expect(set("\t- [w] call zork-qux 👤️ 2026-10-01 ada ^blk9", "open")).toBe(
      "\t- [ ] call zork-qux ^blk9",
    );
  });
});

describe("a todo waiting for review", () => {
  function set(line: string, state: TodoState): string {
    return setStateOn(line, state, TODAY, FRESH);
  }

  it("reads [r] as review, and [R] as no todo at all", () => {
    expect(parsed("- [r] ship it").state).toBe("review");
    // Case is kept, as obsidian-tasks keeps it: `R` is nobody's state.
    expect(parseTodo("- [R] ship it")).toBeNull();
  });

  it("is open work, like doing", () => {
    expect(isOpen(parsed("- [r] ship it"))).toBe(true);
  });

  it("goes to done on one press, and no press of the walk reaches it", () => {
    expect(press("- [r] ship it")).toBe(`- [x] ship it ✅ ${TODAY} 🆔 ${FRESH}`);
    expect(press("- [r] ship it 🆔 kt-abc123")).toBe(`- [x] ship it ✅ ${TODAY} 🆔 kt-abc123`);

    // Twice round the walk from a plain line, so every step of it is seen.
    let line = "ship it";
    for (let step = 0; step < 8; step += 1) {
      line = press(line);
      expect(line).not.toContain("[r]");
    }
  });

  it("drops the stamp of the state it was entered from", () => {
    expect(set("- [x] ship it ✅ 2026-08-01 🆔 kt-abc123", "review")).toBe(
      "- [r] ship it 🆔 kt-abc123",
    );
    expect(set("- [-] ship it ❌ 2026-08-01", "review")).toBe("- [r] ship it");
    expect(set("- [w] ship it 👤 2026-08-03 [[Ada]] 📅 2026-10-20", "review")).toBe(
      "- [r] ship it 📅 2026-10-20",
    );
  });

  it("keeps a review line byte for byte through a field write and a press", () => {
    // Two fields a write puts on a line in place: the timer's total and a picked blocker.
    const line = "\t- [r] ship  it ^abc";
    expect(patchLine(line, { ...parsed(line), worked: "2h" })).toBe("\t- [r] ship  it ⏱ 2h ^abc");
    expect(patchLine(line, { ...parsed(line), blockedBy: ["kt-000002"] })).toBe(
      "\t- [r] ship  it ⛔ kt-000002 ^abc",
    );

    const due = "\t- [r] ship  it 📅 2026-10-20 ^abc";
    expect(press(due)).toBe(`\t- [x] ship  it 📅 2026-10-20 ✅ ${TODAY} 🆔 ${FRESH} ^abc`);
    expect(set(due, "rejected")).toBe(`\t- [-] ship  it 📅 2026-10-20 ❌ ${TODAY} ^abc`);
    expect(set("\t- [/] ship  it 📅 2026-10-20 ^abc", "review")).toBe(due);
  });
});

describe("isOpen", () => {
  it("counts everything but done and rejected", () => {
    expect(isOpen(parsed("- [ ] buy milk"))).toBe(true);
    expect(isOpen(parsed("- [/] buy milk"))).toBe(true);
    expect(isOpen(parsed("- [b] buy milk"))).toBe(true);
    expect(isOpen(parsed("- [x] buy milk"))).toBe(false);
    expect(isOpen(parsed("- [-] buy milk"))).toBe(false);
  });
});

describe("newId", () => {
  it("is kt- and six hex characters", () => {
    expect(newId()).toMatch(/^kt-[0-9a-f]{6}$/);
  });

  it("takes the prefix it is given", () => {
    expect(newId("hl-")).toMatch(/^hl-[0-9a-f]{6}$/);
  });
});

describe("#617 a hash in a span or an address is no tag", () => {
  it("#617 A1 reads no tag in a code span", () => {
    expect(parsed("- [ ] run `grep #client log`").tags).toEqual([]);
  });

  it("#617 A2 reads no tag in a markdown link, its address or its label", () => {
    expect.soft(parsed("- [ ] [see](https://a.io/p#next)").tags).toEqual([]);
    expect(parsed("- [ ] [#next](x)").tags).toEqual([]);
  });

  it("#617 A3 reads no tag in a bare web address", () => {
    expect.soft(parsed("- [ ] see https://a.io/p#next").tags).toEqual([]);
    expect(parsed("- [ ] see https://a.io/#next").tags).toEqual([]);
  });

  it("#617 I1 still reads a real tag beside a span or an address", () => {
    expect.soft(parsed("- [ ] `grep x` #client").tags).toEqual(["#client"]);
    expect.soft(parsed("- [ ] see https://a.io #next").tags).toEqual(["#next"]);
    expect.soft(parsed("- [ ] run `grep #client log` #client").tags).toEqual(["#client"]);
    expect(parsed("- [ ] see https://a.io/p#top #next").tags).toEqual(["#next"]);
  });

  it("#617 I2 keeps the span and the address in the words byte for byte, only the tags change", () => {
    expect(parsed("- [ ] run `grep #client log` see https://a.io/p#next")).toMatchObject({
      text: "run `grep #client log` see https://a.io/p#next",
      tags: [],
    });
  });

  it("#617 I4 reads no tag in a wikilink anchor", () => {
    expect(parsed("- [ ] read [[note#p/x]]").tags).toEqual([]);
  });
});

describe("#627 a tag ends where the editor's tag ends", () => {
  it("#627 A1 a bracket, comma, stop, colon or bang after a tag ends it", () => {
    expect.soft(parsed("- [ ] see (#next)").tags).toEqual(["#next"]);
    expect.soft(parsed("- [ ] see #next, then").tags).toEqual(["#next"]);
    expect.soft(parsed("- [ ] see #next.").tags).toEqual(["#next"]);
    expect.soft(parsed("- [ ] see #next: now").tags).toEqual(["#next"]);
    expect(parsed("- [ ] see #next!").tags).toEqual(["#next"]);
  });

  // The backend's test_tags.py holds the same table, so the pane and the
  // endpoint agree on what a line is tagged.
  it.each([
    ["#123", []],
    ["note#2", []],
    ["https://a.io/p#x", []],
    ["#p/fde.", ["#p/fde"]],
    ["#café", ["#café"]],
    ["#a-b/c", ["#a-b/c"]],
    ["#x#y", ["#x"]],
  ])("#627 I1 reads the backend's tags off %s", (words, tags) => {
    expect(parsed(`- [ ] ${words}`).tags).toEqual(tags);
  });
});
