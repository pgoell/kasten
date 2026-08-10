import {
  cycleLine,
  formatTodo,
  isOpen,
  newId,
  parseTodo,
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
    expect(
      press("- [-] call the dentist 📅 2026-08-14 ⏫ ➕ 2026-08-09 ❌ 2026-08-10 #health"),
    ).toBe("call the dentist #health 📅 2026-08-14 ⏫ ➕ 2026-08-09");
    expect(
      press("- [x] call the dentist 📅 2026-08-14 ⏫ ➕ 2026-08-09 ✅ 2026-08-10 #health"),
    ).toBe("call the dentist #health 📅 2026-08-14 ⏫ ➕ 2026-08-09");
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
});
