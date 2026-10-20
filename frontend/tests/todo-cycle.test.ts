import { press } from "./todo-fixture";

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
