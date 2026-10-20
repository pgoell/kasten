import { formatTodo, isOpen, nameAt, setStateOn, type TodoState } from "@/lib/todo";
import { FRESH, parsed, press, TODAY } from "./todo-fixture";

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
