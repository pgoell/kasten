import { formatTodo } from "@/lib/todo";
import { EXAMPLE, parsed } from "./todo-fixture";

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
