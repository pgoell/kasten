import { isOpen, parseTodo, patchLine, setStateOn, type TodoState } from "@/lib/todo/todo";
import { FRESH, parsed, press, TODAY } from "./todo-fixture";

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
