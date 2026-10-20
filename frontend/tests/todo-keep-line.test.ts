import { setStateOn, type TodoState } from "@/lib/todo";
import { FRESH, parsed, press, TODAY } from "./todo-fixture";

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
