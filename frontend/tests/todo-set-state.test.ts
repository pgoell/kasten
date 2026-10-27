import { setStateOn, type TodoState } from "@/lib/todo/todo";
import { FRESH, TODAY } from "./todo-fixture";

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
