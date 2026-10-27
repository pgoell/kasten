import { addTodoWrites, insertSubtask } from "@/lib/todo/todo-write";
import { DAILY_PATH, FRESH_DAILY, todo } from "./todo-write-fixture";

describe("addTodoWrites", () => {
  const ADDED = "- [ ] call the dentist #health 📅 2026-08-14 ⏫ ➕ 2026-08-10";

  it("puts the todo at the end of the section the daily note already has", () => {
    const daily = [
      "# 2026-08-10 Monday",
      "",
      "[[01 Periodic/00 Daily/2026-08-09]]",
      "",
      "## TODOs",
      "- [ ] buy milk",
      "",
    ].join("\n");

    expect(addTodoWrites({ dailyPath: DAILY_PATH, dailyText: daily, todo: todo(ADDED) })).toEqual([
      {
        path: DAILY_PATH,
        text: [
          "# 2026-08-10 Monday",
          "",
          "[[01 Periodic/00 Daily/2026-08-09]]",
          "",
          "## TODOs",
          "- [ ] buy milk",
          ADDED,
          "",
        ].join("\n"),
      },
    ]);
  });

  it("makes the section in a daily note that has none", () => {
    // A note written before this feature landed, or one somebody wrote by hand.
    expect(
      addTodoWrites({ dailyPath: DAILY_PATH, dailyText: FRESH_DAILY, todo: todo(ADDED) }),
    ).toEqual([
      {
        path: DAILY_PATH,
        text: [
          "# 2026-08-10 Monday",
          "",
          "[[01 Periodic/00 Daily/2026-08-09]] | [[01 Periodic/00 Daily/2026-08-11]]",
          "",
          "## TODOs",
          ADDED,
          "",
        ].join("\n"),
      },
    ]);
  });
});

describe("insertSubtask", () => {
  const PART = "- [ ] book the flight ➕ 2026-08-10";

  it("puts the part one step in under the todo it belongs to", () => {
    const note = ["## TODOs", "- [ ] go to japan", "- [ ] buy milk", ""].join("\n");

    expect(insertSubtask(note, 2, todo(PART))).toBe(
      ["## TODOs", "- [ ] go to japan", `  ${PART}`, "- [ ] buy milk", ""].join("\n"),
    );
  });

  it("puts it after the parts the todo already has, however deep they run", () => {
    const note = [
      "- [ ] go to japan",
      "  - [ ] pack",
      "    - [ ] the passport",
      "- [ ] buy milk",
    ].join("\n");

    expect(insertSubtask(note, 1, todo(PART))).toBe(
      [
        "- [ ] go to japan",
        "  - [ ] pack",
        "    - [ ] the passport",
        `  ${PART}`,
        "- [ ] buy milk",
      ].join("\n"),
    );
  });

  it("counts the parent's own indent, so a part of a part goes in two steps", () => {
    const note = ["- [ ] go to japan", "  - [ ] pack"].join("\n");

    expect(insertSubtask(note, 2, todo(PART))).toBe(
      ["- [ ] go to japan", "  - [ ] pack", `    ${PART}`].join("\n"),
    );
  });

  it("answers nothing where the line is not a todo", () => {
    expect(insertSubtask(["# Kasten", "some prose"].join("\n"), 2, todo(PART))).toBeNull();
  });
});
