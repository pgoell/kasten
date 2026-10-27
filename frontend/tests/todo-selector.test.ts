import { patchLine, setStateOn, type TodoState } from "@/lib/todo/todo";
import { FRESH, parsed, press, TODAY } from "./todo-fixture";

describe("a marker typed with the variation selector", () => {
  function set(line: string, state: TodoState): string {
    return setStateOn(line, state, TODAY, FRESH);
  }

  it("keeps the marker as typed when a value is written over it", () => {
    const line = "\t- [/] call zork-qux ⏱️ 1h ^blk9";
    expect(patchLine(line, { ...parsed(line), worked: "2h" })).toBe(
      "\t- [/] call zork-qux ⏱️ 2h ^blk9",
    );
    // An undated `👤️ ada` is the assignee now, and the wait is stamped after it (#809).
    expect(set("\t- [/] call zork-qux 👤️ ada ^blk9", "waiting")).toBe(
      `\t- [w] call zork-qux 👤️ ada 👤 ${TODAY} ^blk9`,
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
