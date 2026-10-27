import { formatTodo, parseTodo, type Todo } from "@/lib/todo/todo";
import { EXAMPLE, parsed } from "./todo-fixture";

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
